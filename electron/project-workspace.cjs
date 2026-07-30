const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

async function collectWorkspaceFiles(rootPath, options = {}) {
  const root = canonicalPath(rootPath);
  const excludedRoots = (options.excludedRoots || []).map(canonicalPath);
  const limit = Math.max(1, Number(options.limit || 5000));
  const files = [];
  const stack = [root];
  let visited = 0;
  let skippedLinks = 0;
  let skippedUnavailable = 0;
  let skippedGenerated = 0;
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
  while (stack.length && files.length < limit) {
    if (options.isCancelled?.()) return { cancelled: true, files, visited, skippedLinks, skippedUnavailable, skippedGenerated, limitReached: false };
    const dir = stack.pop();
    let entries = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (options.isCancelled?.()) return { cancelled: true, files, visited, skippedLinks, skippedUnavailable, skippedGenerated, limitReached: false };
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) { skippedLinks += 1; continue; }
      if (entry.isDirectory()) {
        if (entry.name === '.edu-manager' || excludedDirectoryNames.has(entry.name.toLocaleLowerCase('en-US'))) {
          skippedGenerated += 1;
          continue;
        }
        if (excludedRoots.some((excluded) => isPathInside(excluded, fullPath))) continue;
        stack.push(fullPath);
      } else if (entry.isFile()) {
        let stat;
        try {
          stat = await fs.promises.stat(fullPath);
        } catch {
          // Build tools, cloud drives and editors can replace a file between
          // readdir and stat. One volatile file must not abort the workspace.
          skippedUnavailable += 1;
          continue;
        }
        files.push({ filename: entry.name, path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs, relativePath: path.relative(root, fullPath).replace(/\\/g, '/') });
        visited += 1;
        if (visited % 25 === 0) options.onProgress?.({ phase: 'listing', visited, currentPath: fullPath, percent: 0 });
        if (files.length >= limit) break;
      }
    }
  }
  return {
    cancelled: false,
    files,
    visited,
    skippedLinks,
    skippedUnavailable,
    skippedGenerated,
    limitReached: files.length >= limit && stack.length > 0,
  };
}

module.exports = { canonicalPath, samePath, isPathInside, inspectWorkspacePath, validateWorkspaceRebind, sha1FileAsync, collectWorkspaceFiles };
