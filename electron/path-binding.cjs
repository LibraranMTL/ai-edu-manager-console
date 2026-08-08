const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const GENERATED_NAMES = new Set(['.git', 'node_modules', '.edu-manager', '.ai-manager']);

function canonicalPath(value) {
  const resolved = path.resolve(String(value || ''));
  try { return fs.realpathSync.native(resolved); } catch { return resolved; }
}

function pathInside(root, candidate) {
  const relative = path.relative(canonicalPath(root), canonicalPath(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function classifyStudentBindingSelection(selectedPath, current = {}) {
  const selected = canonicalPath(selectedPath);
  const name = path.basename(selected).toLowerCase();
  const samePath = (left, right) => Boolean(left && right)
    && canonicalPath(left).toLowerCase() === canonicalPath(right).toLowerCase();
  const summarySelected = samePath(selected, current.summaryPath)
    || /(?:学情分析汇总|学情汇总|summary|reports?|wiki)/i.test(name);
  const rawSelected = samePath(selected, current.rawPath)
    || /(?:原始资料库|原始资料|raw|materials?)/i.test(name);
  if (summarySelected && !rawSelected) {
    return { selectedPath: selected, rootPath: path.dirname(selected), summaryPath: selected, rawPath: '', selectedRole: 'summary' };
  }
  if (rawSelected && !summarySelected) {
    return { selectedPath: selected, rootPath: path.dirname(selected), summaryPath: '', rawPath: selected, selectedRole: 'raw' };
  }
  return { selectedPath: selected, rootPath: selected, summaryPath: '', rawPath: '', selectedRole: 'root' };
}

function commonBindingRoot(paths) {
  const values = (paths || []).filter(Boolean).map((value) => canonicalPath(value));
  if (!values.length) return '';
  let candidate = path.dirname(values[0]);
  while (candidate && !values.every((value) => pathInside(candidate, value))) {
    const parent = path.dirname(candidate);
    if (!parent || parent === candidate) return '';
    candidate = parent;
  }
  if (!candidate || candidate === path.parse(candidate).root) return '';
  return candidate;
}

function inspectBindingDirectory(rootPath, options = {}) {
  const root = canonicalPath(rootPath);
  const limit = Math.max(1, Number(options.limit || 20_000));
  const errors = [];
  if (!String(rootPath || '').trim() || !fs.existsSync(root)) {
    return { ok: false, rootPath: root, errors: ['所选目录不存在。'], fileCount: 0, totalBytes: 0, substantiveFileCount: 0, keyFiles: [] };
  }
  if (!fs.statSync(root).isDirectory()) {
    return { ok: false, rootPath: root, errors: ['所选路径不是文件夹。'], fileCount: 0, totalBytes: 0, substantiveFileCount: 0, keyFiles: [] };
  }
  try { fs.accessSync(root, fs.constants.R_OK); } catch { errors.push('所选目录不可读取。'); }
  const stack = [root];
  let fileCount = 0;
  let substantiveFileCount = 0;
  let totalBytes = 0;
  const keyFiles = [];
  const fingerprintParts = [];
  while (stack.length && fileCount < limit) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (GENERATED_NAMES.has(entry.name.toLowerCase())) continue;
        stack.push(target);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat;
      try { stat = fs.statSync(target); } catch { continue; }
      const relativePath = path.relative(root, target).replace(/\\/g, '/');
      fileCount += 1;
      totalBytes += stat.size;
      if (stat.size > 0 && !/^(?:thumbs\.db|desktop\.ini)$/i.test(entry.name) && !/\.bak(?:-|$)/i.test(entry.name)) substantiveFileCount += 1;
      if (/^(?:AGENT|index|log)\.md$/i.test(entry.name) || /(?:growth-index|education-archive|knowledge-space)\.json$/i.test(entry.name)) keyFiles.push(relativePath);
      fingerprintParts.push(`${relativePath.toLowerCase()}:${stat.size}:${Math.trunc(stat.mtimeMs)}`);
      if (fileCount >= limit) break;
    }
  }
  return {
    ok: errors.length === 0,
    rootPath: root,
    errors,
    fileCount,
    substantiveFileCount,
    totalBytes,
    keyFiles: keyFiles.slice(0, 100),
    limited: fileCount >= limit && stack.length > 0,
    fingerprint: crypto.createHash('sha256').update(fingerprintParts.sort().join('\n')).digest('hex'),
  };
}

function validateExistingBinding(options = {}) {
  const inventory = inspectBindingDirectory(options.rootPath, { limit: options.limit });
  const errors = [...(inventory.errors || [])];
  const requiredPaths = (options.requiredPaths || []).filter(Boolean).map((item) => canonicalPath(item));
  for (const requiredPath of requiredPaths) {
    if (!pathInside(inventory.rootPath, requiredPath)) errors.push(`路径不在所选知识库根目录内：${requiredPath}`);
    else if (!fs.existsSync(requiredPath)) errors.push(`所选知识库缺少必要目录或文件：${requiredPath}`);
  }
  if (options.rejectEmpty !== false && inventory.substantiveFileCount === 0) errors.push('所选目录没有可识别的现有资料；如需新建空知识库，请使用“新建学生档案”。');
  return { ...inventory, ok: errors.length === 0, errors };
}

function replaceManagedBlock(content, markerId, body) {
  const id = String(markerId || '').replace(/[^A-Z0-9_-]/gi, '').toUpperCase();
  if (!id) throw new Error('Managed block marker is required.');
  const start = `<!-- EDU-MANAGER-${id}:START -->`;
  const end = `<!-- EDU-MANAGER-${id}:END -->`;
  const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = `${start}\n${String(body || '').trim()}\n${end}`;
  const pattern = new RegExp(`${escaped(start)}[\\s\\S]*?${escaped(end)}\\s*`, 'g');
  const without = String(content || '').replace(pattern, '').trimEnd();
  return `${without}${without ? '\n\n' : ''}${block}\n`;
}

function appendPathChangeLog(content, entry = {}) {
  const at = String(entry.at || new Date().toISOString());
  const scope = String(entry.scope || '知识库');
  const oldPath = String(entry.oldPath || '未记录');
  const newPath = String(entry.newPath || '未记录');
  const line = `- ${at}：${scope}路径绑定由 \`${oldPath}\` 调整为 \`${newPath}\`；原文件未移动或删除。`;
  const current = String(content || '').trimEnd();
  if (current.includes(line)) return `${current}\n`;
  return `${current}${current ? '\n\n' : ''}## 教育管家路径变更\n\n${line}\n`;
}

module.exports = {
  appendPathChangeLog,
  canonicalPath,
  classifyStudentBindingSelection,
  commonBindingRoot,
  inspectBindingDirectory,
  pathInside,
  replaceManagedBlock,
  validateExistingBinding,
};
