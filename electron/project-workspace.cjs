const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { relativeMaterialPath } = require('./project-material-contract.cjs');

function canonicalPath(value) {
  const resolved = path.resolve(String(value || ''));
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function samePath(left, right) {
  return canonicalPath(left).toLocaleLowerCase('zh-CN') === canonicalPath(right).toLocaleLowerCase('zh-CN');
}

function isPathInside(root, candidate) {
  const relative = path.relative(canonicalPath(root), canonicalPath(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function inspectWorkspacePath(rootPath, resourcesPath = '') {
  const resolved = canonicalPath(rootPath);
  const normalized = resolved.replace(/\//g, '\\').toLocaleLowerCase('en-US');
  const resources = resourcesPath ? canonicalPath(resourcesPath).replace(/\//g, '\\').toLocaleLowerCase('en-US') : '';
  const runtimeArtifact = normalized.endsWith('\\app.asar')
    || normalized.includes('\\resources\\app.asar\\')
    || (resources && isPathInside(resources, resolved));
  if (runtimeArtifact) {
    return { ok: false, path: resolved, code: 'runtime_artifact', message: '工作空间被错误绑定到程序安装包内部。' };
  }
  if (!fs.existsSync(resolved)) {
    return { ok: false, path: resolved, code: 'missing', message: '工作空间文件夹不存在。' };
  }
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      return { ok: false, path: resolved, code: 'not_directory', message: '工作空间路径不是文件夹。' };
    }
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    return { ok: false, path: resolved, code: 'unreadable', message: '工作空间文件夹不可读取。' };
  }
  return { ok: true, path: resolved, code: 'ready', message: '工作空间可读取。' };
}

function validateWorkspaceRebind(project, targetPath, projects = []) {
  const target = canonicalPath(targetPath);
  const errors = [];
  const warnings = [];
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) errors.push('所选工作空间不存在或不是文件夹。');
  if (fs.existsSync(target)) {
    try { fs.accessSync(target, fs.constants.R_OK); } catch { errors.push('所选工作空间不可读取。'); }
    try { fs.accessSync(target, fs.constants.W_OK); } catch { warnings.push('所选工作空间不可写；可扫描，但项目文件需要在其他位置维护。'); }
  }
  const conflict = projects.find((item) => String(item.id) !== String(project.id) && samePath(item.workspacePath, target));
  if (conflict) errors.push(`该文件夹已绑定项目“${conflict.name}”。`);
  const protectedPaths = [project.projectRootPath, project.knowledgeRootPath, project.managerPath, project.rawPath].filter(Boolean);
  if (protectedPaths.some((item) => isPathInside(item, target) || isPathInside(target, item))) {
    errors.push('工作空间不能与项目知识空间、管理目录或项目根目录相互包含。');
  }
  if (samePath(project.workspacePath, target)) warnings.push('新旧工作空间路径相同，无需重新绑定。');
  return { ok: errors.length === 0, targetPath: target, errors, warnings };
}

function sha1FileAsync(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function compareTraversalPath(left, right) {
  const a = left.split('/');
  const b = right.split('/');
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return Math.sign(a.length - b.length);
}

async function collectWorkspaceFiles(rootPath, options = {}) {
  const root = canonicalPath(rootPath);
  const excludedRoots = (options.excludedRoots || []).map(canonicalPath);
  const limit = Math.min(10000, Math.max(1, Math.floor(Number(options.limit || 5000))));
  const afterRelativePath = options.afterRelativePath
    ? relativeMaterialPath(options.afterRelativePath) : '';
  const files = [];
  const stack = [{ dir: root, entries: null, index: 0 }];
  let visited = 0;
  let skippedLinks = 0;
  let skippedUnavailable = 0;
  let skippedDirectories = 0;
  let skippedGenerated = 0;
  let limitReached = false;
  let nextCursor = '';
  const excludedDirectoryNames = new Set((options.excludedDirectoryNames || [
    '.git',
    '.cache',
    '.vite',
    'node_modules',
    'dist',
    'build',
    'out',
    'win-unpacked',
  ]).map((item) => String(item).toLocaleLowerCase('en-US')));
  while (stack.length) {
    if (options.isCancelled?.()) return { cancelled: true, files, visited, skippedLinks,
      skippedUnavailable, skippedDirectories, skippedGenerated, limitReached: false, nextCursor: '' };
    const frame = stack[stack.length - 1];
    if (!frame.entries) {
      try {
        frame.entries = (await fs.promises.readdir(frame.dir, { withFileTypes: true }))
          .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      } catch { skippedDirectories += 1; stack.pop(); continue; }
    }
    if (frame.index >= frame.entries.length) { stack.pop(); continue; }
    const entry = frame.entries[frame.index++];
    const fullPath = path.join(frame.dir, entry.name);
    if (entry.isSymbolicLink()) { skippedLinks += 1; continue; }
    if (entry.isDirectory()) {
      if (entry.name === '.edu-manager' || excludedDirectoryNames.has(entry.name.toLocaleLowerCase('en-US'))) {
        skippedGenerated += 1;
        continue;
      }
      if (excludedRoots.some((excluded) => isPathInside(excluded, fullPath))) continue;
      stack.push({ dir: fullPath, entries: null, index: 0 });
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
    if (afterRelativePath && compareTraversalPath(relativePath, afterRelativePath) <= 0) continue;
    let stat;
    try { stat = await fs.promises.stat(fullPath); }
    catch {
      // A volatile file does not abort this page. The next fresh scan may find it.
      skippedUnavailable += 1;
      continue;
    }
    if (!stat.isFile()) { skippedUnavailable += 1; continue; }
    if (files.length >= limit) { limitReached = true; break; }
    files.push({ filename: entry.name, path: fullPath, size: stat.size,
      mtimeMs: stat.mtimeMs, fileKey: `${stat.dev}:${stat.ino}`, nlink: stat.nlink,
      relativePath });
    nextCursor = relativePath;
    visited += 1;
    if (visited % 25 === 0) options.onProgress?.({ phase: 'listing', visited,
      currentPath: fullPath, percent: 0 });
  }
  return {
    cancelled: false,
    files,
    visited,
    skippedLinks,
    skippedUnavailable,
    skippedDirectories,
    skippedGenerated,
    limitReached,
    nextCursor: limitReached ? nextCursor : '',
  };
}

module.exports = { canonicalPath, samePath, isPathInside, inspectWorkspacePath, validateWorkspaceRebind, sha1FileAsync, collectWorkspaceFiles };
