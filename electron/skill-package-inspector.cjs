'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 8,
  maxEntries: 2000,
  maxFiles: 500,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxManifestBytes: 256 * 1024,
});

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'cache', 'caches', 'logs', 'log',
  'tmp', 'temp', '.cache', '__pycache__', 'dist', 'build', 'coverage',
]);
const SECRET_FILENAMES = /^(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials?(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|p12|pfx|key))$/i;
const SCRIPT_EXTENSIONS = new Set(['.ps1', '.bat', '.cmd', '.sh', '.bash', '.zsh', '.py', '.js', '.cjs', '.mjs', '.ts']);
const BINARY_EXTENSIONS = new Set(['.exe', '.dll', '.com', '.msi', '.node', '.so', '.dylib']);
const DEPENDENCY_FILES = new Set(['package.json', 'requirements.txt', 'pyproject.toml', 'cargo.toml', 'go.mod', 'gemfile']);
const LOCK_FILES = /(?:^|\.)(?:lock|lockb)$/i;
const PLUGIN_MANIFESTS = new Set(['.codebuddy-plugin/plugin.json', '.workbuddy-plugin/plugin.json', '.claude-plugin/plugin.json', 'plugin.json']);
const TOKEN_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{16,}/i,
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedRelative(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative === '.' || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) {
    throw Error('文件路径越出 Skill 根目录');
  }
  return relative.split(path.sep).join('/');
}

function scalar(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    if (text.startsWith('"')) {
      try { return JSON.parse(text); } catch { throw Error('YAML 字符串转义无效'); }
    }
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (/^(?:true|false|null|~)$/i.test(text)) return text.toLowerCase();
  if (/^[\[\]{},&*!]|:\s|\s#/.test(text)) throw Error('YAML 字段包含首版不支持的复杂结构');
  return text.replace(/\s+#.*$/, '').trim();
}

function parseFrontmatter(markdown) {
  const source = String(markdown || '').replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') throw Error('SKILL.md 缺少起始 YAML frontmatter');
  const end = lines.slice(1).findIndex(line => line.trim() === '---');
  if (end < 0) throw Error('SKILL.md 的 YAML frontmatter 未闭合');
  const yamlLines = lines.slice(1, end + 1);
  const metadata = {};
  const rawFields = {};
  for (let index = 0; index < yamlLines.length; index++) {
    const line = yamlLines[index];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^\s/.test(line)) throw Error('YAML 顶层缩进结构超出首版严格解析范围');
    const match = /^([A-Za-z][A-Za-z0-9_-]{0,63}):(?:\s*(.*))?$/.exec(line);
    if (!match) throw Error(`YAML 字段格式无效（第 ${index + 2} 行）`);
    const key = match[1];
    if (Object.hasOwn(rawFields, key)) throw Error(`YAML 字段重复：${key}`);
    let value = match[2] || '';
    if (/^[>|][+-]?$/.test(value.trim())) {
      const folded = value.trim().startsWith('>');
      const block = [];
      while (index + 1 < yamlLines.length && (/^\s+/.test(yamlLines[index + 1]) || !yamlLines[index + 1].trim())) {
        index++;
        block.push(yamlLines[index].replace(/^ {1,4}/, ''));
      }
      value = folded ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim();
    } else if (!value.trim()) {
      const list = [];
      while (index + 1 < yamlLines.length && /^\s+-\s+/.test(yamlLines[index + 1])) {
        index++;
        list.push(scalar(yamlLines[index].replace(/^\s+-\s+/, '')));
      }
      if (list.length) value = list;
      else throw Error(`YAML 字段 ${key} 使用了首版不支持的嵌套结构`);
    } else value = scalar(value);
    rawFields[key] = value;
    metadata[key] = value;
  }
  return { metadata, body: lines.slice(end + 2).join('\n'), rawFrontmatter: yamlLines.join('\n') };
}

function validateMetadata(metadata, directoryName) {
  const name = String(metadata.name || directoryName || '').trim();
  const description = String(metadata.description || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) throw Error('Skill name 必须为 1—128 位字母、数字、点、下划线或连字符');
  if (!description || description.length > 4000) throw Error('Skill description 必须为 1—4000 个字符');
  const declaredVersion = String(metadata.version || metadata['skill-version'] || 'unversioned').trim();
  if (declaredVersion.length > 128) throw Error('Skill version 过长');
  return {
    name,
    displayName: String(metadata.displayName || metadata['display-name'] || name).slice(0, 160),
    description,
    publisher: String(metadata.publisher || metadata.author || '').trim().slice(0, 160),
    declaredVersion,
    license: String(metadata.license || '').trim().slice(0, 160),
  };
}

function inspectDirectory(rootPath, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const root = path.resolve(String(rootPath || ''));
  if (!root || root === path.parse(root).root) throw Error('Skill 根目录无效');
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('Skill 根必须是普通目录，不能是符号链接');
  const realRoot = fs.realpathSync.native(root);
  const files = [];
  const findings = [];
  let entries = 0;
  let totalBytes = 0;
  let manifestPath = '';
  let manifestCount = 0;

  function walk(current, depth) {
    if (depth > limits.maxDepth) throw Error('Skill 目录层级超过限制');
    const dirents = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const dirent of dirents) {
      entries++;
      if (entries > limits.maxEntries) throw Error('Skill 目录项数量超过限制');
      const absolute = path.join(current, dirent.name);
      const relative = normalizedRelative(root, absolute);
      if (dirent.isSymbolicLink()) {
        findings.push({ id: 'symbolic_link', severity: 'block', path: relative, message: '包含符号链接或 junction，未读取目标内容' });
        continue;
      }
      if (dirent.isDirectory()) {
        if (EXCLUDED_DIRS.has(dirent.name.toLowerCase())) {
          findings.push({ id: 'excluded_directory', severity: 'info', path: relative, message: '已排除缓存、依赖或构建目录' });
          continue;
        }
        const real = fs.realpathSync.native(absolute);
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
          findings.push({ id: 'path_escape', severity: 'block', path: relative, message: '目录真实路径越出允许根目录' });
          continue;
        }
        walk(absolute, depth + 1);
        continue;
      }
      if (!dirent.isFile()) {
        findings.push({ id: 'special_file', severity: 'block', path: relative, message: '包含不支持的特殊文件' });
        continue;
      }
      const stat = fs.statSync(absolute);
      if (stat.size > limits.maxFileBytes) throw Error(`单文件超过限制：${relative}`);
      totalBytes += stat.size;
      if (totalBytes > limits.maxTotalBytes) throw Error('Skill 总大小超过限制');
      if (files.length >= limits.maxFiles) throw Error('Skill 文件数量超过限制');
      const lower = relative.toLowerCase();
      if (lower === 'skill.md') { manifestPath = absolute; manifestCount++; }
      else if (path.basename(lower) === 'skill.md') manifestCount++;
      const ext = path.extname(lower);
      if (SECRET_FILENAMES.test(path.basename(relative))) findings.push({ id: 'secret_filename', severity: 'block', path: relative, message: '包含疑似凭据或私钥文件名' });
      if (SCRIPT_EXTENSIONS.has(ext)) findings.push({ id: 'script', severity: 'warn', path: relative, message: '包含可执行脚本，安装前需要额外确认' });
      if (BINARY_EXTENSIONS.has(ext)) findings.push({ id: 'binary', severity: 'block', path: relative, message: '包含二进制或动态库' });
      if (DEPENDENCY_FILES.has(path.basename(lower)) || LOCK_FILES.test(path.basename(lower))) findings.push({ id: 'dependencies', severity: 'warn', path: relative, message: '包含依赖或锁文件' });
      if (/^(?:\.mcp\.json|mcp\.json|hooks?\.json)$/i.test(path.basename(relative))) findings.push({ id: /hook/i.test(relative) ? 'hook' : 'mcp', severity: 'warn', path: relative, message: '包含 MCP 或 Hook 配置' });
      const buffer = fs.readFileSync(absolute);
      if (buffer.length <= 1024 * 1024 && !BINARY_EXTENSIONS.has(ext)) {
        const text = buffer.toString('utf8');
        if (TOKEN_PATTERNS.some(pattern => pattern.test(text))) findings.push({ id: 'suspected_secret', severity: 'block', path: relative, message: '内容疑似包含私钥或访问令牌，未保存匹配值' });
        if (/https?:\/\//i.test(text)) findings.push({ id: 'network_reference', severity: 'info', path: relative, message: '内容包含网络地址引用' });
      }
      files.push({ relativePath: relative, absolutePath: absolute, size: stat.size, sha256: sha256(buffer) });
    }
  }

  walk(root, 0);
  if (manifestCount !== 1 || !manifestPath) throw Error(manifestCount ? 'Skill 包必须只有一个根级 SKILL.md' : 'Skill 包缺少根级 SKILL.md');
  const manifestBuffer = fs.readFileSync(manifestPath);
  if (manifestBuffer.length > limits.maxManifestBytes) throw Error('SKILL.md 超过大小限制');
  const manifestText = manifestBuffer.toString('utf8');
  if (manifestText.includes('\uFFFD')) throw Error('SKILL.md 不是有效 UTF-8 文本');
  const parsed = parseFrontmatter(manifestText);
  const identity = validateMetadata(parsed.metadata, path.basename(root));
  const normalizedPaths = files.map(file => `${file.relativePath}\0${file.size}\0${file.sha256}`).sort();
  const treeSha256 = sha256(Buffer.from(normalizedPaths.join('\n'), 'utf8'));
  const manifestSha256 = sha256(manifestBuffer);
  const normalizedFileNames = new Set(files.map(file => file.relativePath.toLowerCase()));
  const kind = [...PLUGIN_MANIFESTS].some(name => normalizedFileNames.has(name)) ? 'plugin' : 'skill';
  if (kind === 'plugin') findings.push({ id: 'plugin_package', severity: 'block', path: '', message: '检测到插件清单；本轮只允许存档浏览，不开放插件安装' });
  const inspectionStatus = findings.some(item => item.severity === 'block') ? 'quarantined' : 'ready_to_archive';
  return {
    schema: 'edu-manager.skill-inspection.v1',
    rootPath: root,
    realRoot,
    kind,
    identity,
    metadata: parsed.metadata,
    manifestSha256,
    treeSha256,
    fileCount: files.length,
    totalBytes,
    entryPoint: 'SKILL.md',
    files,
    riskFindings: findings,
    inspectionStatus,
    observedCapabilities: [...new Set(findings.filter(item => ['script', 'binary', 'dependencies', 'mcp', 'hook', 'network_reference'].includes(item.id)).map(item => item.id))],
    inspectedAt: new Date().toISOString(),
  };
}

function fingerprintDirectory(rootPath, options = {}) {
  if (!fs.existsSync(rootPath)) return '';
  return inspectDirectory(rootPath, options).treeSha256;
}

module.exports = {
  DEFAULT_LIMITS,
  EXCLUDED_DIRS,
  inspectDirectory,
  fingerprintDirectory,
  parseFrontmatter,
  sha256,
};
