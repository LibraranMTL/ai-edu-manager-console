const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
const { rebaseStoragePath, remapStorageTree } = require('./storage-root.cjs');

const PACKAGE_SCHEMA = 'edu-manager.migration-package.v1';
const MANIFEST_SCHEMA = 'edu-manager.migration-manifest.v1';
const REPORT_SCHEMA = 'edu-manager.migration-report.v1';
const DEFAULT_EXCLUDES = new Set(['.edu-migration-staging', '$RECYCLE.BIN', 'System Volume Information']);

function safeId(value, fallback = 'item') {
  const clean = String(value || '').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return clean || fallback;
}

function portableRelative(value) {
  const clean = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..' || part.includes('\0'))) throw new Error(`迁移包路径无效：${value}`);
  return parts.join('/');
}

function targetInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...portableRelative(relativePath).split('/'));
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`迁移包目标路径越界：${relativePath}`);
  return target;
}

function isSameOrInside(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function walkFiles(rootPath, options = {}) {
  const root = path.resolve(rootPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const excludes = new Set([...DEFAULT_EXCLUDES, ...(options.excludeNames || [])]);
  const files = [];
  const queue = [''];
  while (queue.length) {
    const relativeDir = queue.shift();
    const absoluteDir = relativeDir ? path.join(root, relativeDir) : root;
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    for (const entry of entries) {
      if (excludes.has(entry.name)) continue;
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const absolutePath = path.join(root, relativePath);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) queue.push(relativePath);
      else if (stat.isFile()) files.push({ absolutePath, relativePath: relativePath.replace(/\\/g, '/'), size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return files;
}

function inspectMigrationSources(sources = []) {
  const inspected = [];
  let fileCount = 0;
  let totalBytes = 0;
  for (const source of sources) {
    const files = walkFiles(source.rootPath, source);
    const bytes = files.reduce((sum, item) => sum + item.size, 0);
    fileCount += files.length;
    totalBytes += bytes;
    inspected.push({
      id: safeId(source.id),
      kind: source.kind,
      label: String(source.label || source.id || ''),
      rootPath: path.resolve(source.rootPath),
      fileCount: files.length,
      totalBytes: bytes,
      exists: fs.existsSync(source.rootPath),
    });
  }
  return { fileCount, totalBytes, sources: inspected };
}

async function compareSourceSnapshot(source, expectedFiles = [], expectedHashes = new Map()) {
  const currentFiles = walkFiles(source.rootPath, source);
  const expectedByPath = new Map(expectedFiles.map((item) => [item.relativePath, item]));
  const currentByPath = new Map(currentFiles.map((item) => [item.relativePath, item]));
  const added = currentFiles.filter((item) => !expectedByPath.has(item.relativePath)).map((item) => item.relativePath);
  const removed = expectedFiles.filter((item) => !currentByPath.has(item.relativePath)).map((item) => item.relativePath);
  const modified = [];
  const metadataOnly = [];
  for (const expected of expectedFiles) {
    const current = currentByPath.get(expected.relativePath);
    if (!current) continue;
    if (current.size !== expected.size) {
      modified.push(expected.relativePath);
      continue;
    }
    if (current.mtimeMs === expected.mtimeMs) continue;
    const expectedHash = expectedHashes.get(expected.relativePath);
    if (!expectedHash || await sha256File(current.absolutePath) !== expectedHash) modified.push(expected.relativePath);
    else metadataOnly.push(expected.relativePath);
  }
  return { added, removed, modified, metadataOnly };
}

function snapshotChangeWarning(source, comparison) {
  const examples = [...comparison.added, ...comparison.removed, ...comparison.modified].slice(0, 3);
  return {
    scopeId: safeId(source.id),
    kind: String(source.kind || 'managed'),
    label: String(source.label || source.id || ''),
    added: comparison.added.length,
    removed: comparison.removed.length,
    modified: comparison.modified.length,
    examples,
  };
}

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
}

async function copyPlain(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  await pipeline(fs.createReadStream(sourcePath), fs.createWriteStream(targetPath, { flags: 'wx' }));
  return {};
}

async function copyEncrypted(sourcePath, targetPath, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  await pipeline(fs.createReadStream(sourcePath), cipher, fs.createWriteStream(targetPath, { flags: 'wx' }));
  return { iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

async function writeVirtual(content, targetPath, key) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (!key) {
    await pipeline(Readable.from([buffer]), fs.createWriteStream(targetPath, { flags: 'wx' }));
    return { size: buffer.length, sha256: sha256Buffer(buffer) };
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  await pipeline(Readable.from([buffer]), cipher, fs.createWriteStream(targetPath, { flags: 'wx' }));
  return { size: buffer.length, sha256: sha256Buffer(buffer), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

function packageStem(date = new Date()) {
  const compactTimestamp = date.toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return `AI-Edu-Migrate-${compactTimestamp}`;
}

function payloadObjectRelativePath(category, scopeId, relativePath, encrypted = false) {
  const objectId = sha256Buffer(Buffer.from(`${category}\0${scopeId}\0${portableRelative(relativePath)}`, 'utf8'));
  return `objects/${objectId.slice(0, 2)}/${objectId}.${encrypted ? 'enc' : 'bin'}`;
}

function progressEmitter(callback, state) {
  if (typeof callback === 'function') callback({ schema: 'edu-manager.migration-progress.v1', ...state });
}

async function createMigrationPackage(options = {}) {
  const destinationParent = path.resolve(options.destinationParent || '');
  if (!destinationParent || !fs.existsSync(destinationParent) || !fs.statSync(destinationParent).isDirectory()) throw new Error('请选择有效的迁移包保存目录。');
  const password = String(options.password || '');
  if (password && password.length < 8) throw new Error('迁移包密码至少需要 8 个字符。');
  const migrationId = `migration-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const finalRoot = path.join(destinationParent, `${packageStem()}-${migrationId.slice(-8)}`);
  const writingRoot = `${finalRoot}.writing`;
  const destinationReal = fs.realpathSync.native(destinationParent);
  for (const source of Array.isArray(options.sources) ? options.sources : []) {
    if (!source?.rootPath || !fs.existsSync(source.rootPath)) continue;
    const sourceReal = fs.realpathSync.native(source.rootPath);
    if (isSameOrInside(sourceReal, path.join(destinationReal, path.basename(finalRoot)))) {
      throw new Error(`迁移包不能保存在正在迁移的资料目录内：${source.label || source.rootPath}。请选择 U 盘、移动硬盘或其他独立目录。`);
    }
  }
  if (fs.existsSync(finalRoot) || fs.existsSync(writingRoot)) throw new Error('迁移包目标目录已存在，请重新选择保存位置。');
  fs.mkdirSync(path.join(writingRoot, 'payload'), { recursive: true });
  const salt = password ? crypto.randomBytes(16) : null;
  const key = password ? deriveKey(password, salt) : null;
  const sources = Array.isArray(options.sources) ? options.sources : [];
  const virtualFiles = Array.isArray(options.virtualFiles) ? options.virtualFiles : [];
  const sourceFiles = sources.flatMap((source) => walkFiles(source.rootPath, source).map((file) => ({ source, file })));
  const sourceSnapshots = new Map(sources.map((source) => [source, sourceFiles.filter((item) => item.source === source).map((item) => item.file)]));
  const sourceHashes = new Map(sources.map((source) => [source, new Map()]));
  const totalFiles = sourceFiles.length + virtualFiles.length;
  let completedFiles = 0;
  let completedBytes = 0;
  const manifestFiles = [];
  const sourceChangeWarnings = [];
  try {
    progressEmitter(options.onProgress, { phase: 'exporting', totalFiles, completedFiles, completedBytes });
    for (const item of sourceFiles) {
      const scopeId = safeId(item.source.id);
      const category = String(item.source.kind || 'managed');
      const relativePath = portableRelative(item.file.relativePath);
      const destinationRelativePath = category === 'state'
        ? portableRelative(`${item.source.destinationPrefix || scopeId}/${relativePath}`)
        : relativePath;
      const payloadRelativePath = payloadObjectRelativePath(category, scopeId, relativePath, Boolean(key));
      const payloadPath = targetInside(path.join(writingRoot, 'payload'), payloadRelativePath);
      const plainSha256 = await sha256File(item.file.absolutePath);
      const cryptoMeta = key ? await copyEncrypted(item.file.absolutePath, payloadPath, key) : await copyPlain(item.file.absolutePath, payloadPath);
      if (await sha256File(item.file.absolutePath) !== plainSha256) throw new Error(`导出期间源文件发生变化，请停止相关 Agent 或采集任务后重试：${relativePath}`);
      const storedSha256 = await sha256File(payloadPath);
      sourceHashes.get(item.source).set(relativePath, plainSha256);
      manifestFiles.push({ category, scopeId, relativePath, destinationRelativePath, payloadRelativePath, size: item.file.size, sha256: plainSha256, storedSha256, mtimeMs: item.file.mtimeMs, ...cryptoMeta });
      completedFiles += 1;
      completedBytes += item.file.size;
      progressEmitter(options.onProgress, { phase: 'exporting', totalFiles, completedFiles, completedBytes, current: relativePath });
    }
    for (const virtual of virtualFiles) {
      const category = String(virtual.kind || 'state');
      const scopeId = safeId(virtual.id || 'host-state');
      const relativePath = portableRelative(virtual.relativePath);
      const payloadRelativePath = payloadObjectRelativePath(category, scopeId, relativePath, Boolean(key));
      const payloadPath = targetInside(path.join(writingRoot, 'payload'), payloadRelativePath);
      const meta = await writeVirtual(virtual.content, payloadPath, key);
      manifestFiles.push({ category, scopeId, relativePath, destinationRelativePath: relativePath, payloadRelativePath, size: meta.size, sha256: meta.sha256, storedSha256: await sha256File(payloadPath), virtual: true, ...meta });
      completedFiles += 1;
      completedBytes += meta.size;
      progressEmitter(options.onProgress, { phase: 'exporting', totalFiles, completedFiles, completedBytes, current: relativePath });
    }
    for (const source of sources) {
      const comparison = await compareSourceSnapshot(source, sourceSnapshots.get(source), sourceHashes.get(source));
      if (comparison.added.length || comparison.removed.length || comparison.modified.length) sourceChangeWarnings.push(snapshotChangeWarning(source, comparison));
    }
    const manifest = {
      schema: MANIFEST_SCHEMA,
      migrationId,
      appVersion: String(options.appVersion || ''),
      createdAt: new Date().toISOString(),
      source: {
        managedRoot: path.resolve(options.managedRoot || ''),
        userDataRoot: options.userDataRoot ? path.resolve(options.userDataRoot) : '',
        hostDisplayName: String(options.hostDisplayName || ''),
      },
      encrypted: Boolean(key),
      encryption: key ? { algorithm: 'aes-256-gcm', kdf: 'scrypt', salt: salt.toString('base64') } : null,
      identityPolicy: 'new-host-identity-and-license-reactivation',
      payloadLayout: 'flat-sha256-v2',
      files: manifestFiles,
      externalSources: sources.filter((item) => item.kind === 'external').map((item) => ({ id: safeId(item.id), label: String(item.label || ''), sourceRoot: path.resolve(item.rootPath) })),
      unresolvedExternalSources: (options.unresolvedExternalSources || []).map((item) => ({ id: safeId(item.id), label: String(item.label || ''), sourceRoot: path.resolve(item.rootPath || '') })),
      sourceChangesDuringExport: sourceChangeWarnings,
      excludedSensitiveData: ['host-identity', 'license', 'api-token', 'collaboration-direct-secrets', 'platform-private-keys'],
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    fs.writeFileSync(path.join(writingRoot, 'manifest.json'), manifestText, 'utf8');
    fs.writeFileSync(path.join(writingRoot, 'manifest.sha256'), `${sha256Buffer(Buffer.from(manifestText, 'utf8'))}  manifest.json\n`, 'utf8');
    const descriptor = { schema: PACKAGE_SCHEMA, migrationId, appVersion: manifest.appVersion, createdAt: manifest.createdAt, encrypted: Boolean(key), payloadLayout: manifest.payloadLayout, fileCount: manifestFiles.length, totalBytes: manifestFiles.reduce((sum, item) => sum + item.size, 0) };
    atomicJson(path.join(writingRoot, 'migration.json'), descriptor);
    const report = [
      '# AI教育管家迁移包导出报告', '',
      `- 迁移 ID：${migrationId}`,
      `- 创建时间：${manifest.createdAt}`,
      `- 文件数量：${descriptor.fileCount}`,
      `- 原始容量：${descriptor.totalBytes} 字节`,
      `- 密码加密：${descriptor.encrypted ? '是' : '否'}`,
      `- 外部目录：${manifest.externalSources.length} 个`, '',
      ...(sourceChangeWarnings.length ? [
        `- 导出期间后台变化目录：${sourceChangeWarnings.length} 个`,
        ...sourceChangeWarnings.map((item) => `  - ${item.label || item.scopeId}：新增 ${item.added}、删除 ${item.removed}、修改 ${item.modified}${item.examples.length ? `；示例：${item.examples.join('、')}` : ''}`),
        '- 说明：迁移包保留每个文件复制时通过前后 SHA-256 校验的稳定版本；导出开始后新增或再次更新的内容可能不在本包内。', '',
      ] : []),
      'License、API Token、主机身份、协作直传密钥和平台私钥未进入迁移包；新电脑需要重新激活和连接。',
    ].join('\n');
    fs.writeFileSync(path.join(writingRoot, 'migration-report.md'), `${report}\n`, 'utf8');
    fs.renameSync(writingRoot, finalRoot);
    progressEmitter(options.onProgress, { phase: 'completed', totalFiles, completedFiles, completedBytes, packagePath: finalRoot });
    return { ok: true, packagePath: finalRoot, ...descriptor, externalCount: manifest.externalSources.length, sourceChangeWarnings };
  } catch (error) {
    const failedRoot = `${finalRoot}.failed-${Date.now()}`;
    if (fs.existsSync(writingRoot)) fs.renameSync(writingRoot, failedRoot);
    progressEmitter(options.onProgress, { phase: 'failed', totalFiles, completedFiles, completedBytes, message: error.message, recoveryPath: fs.existsSync(failedRoot) ? failedRoot : '' });
    throw error;
  }
}

function readAndVerifyManifest(packageRoot) {
  const root = path.resolve(packageRoot || '');
  const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'migration.json'), 'utf8'));
  if (descriptor.schema !== PACKAGE_SCHEMA) throw new Error('不支持的教育管家迁移包。');
  const manifestText = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
  const expected = fs.readFileSync(path.join(root, 'manifest.sha256'), 'utf8').trim().split(/\s+/)[0].toLowerCase();
  if (sha256Buffer(Buffer.from(manifestText, 'utf8')) !== expected) throw new Error('迁移包清单校验失败，文件可能已损坏或被修改。');
  const manifest = JSON.parse(manifestText);
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.migrationId !== descriptor.migrationId || !Array.isArray(manifest.files)) throw new Error('迁移包清单结构无效。');
  return { root, descriptor, manifest };
}

async function inspectMigrationPackage(packageRoot) {
  const checked = readAndVerifyManifest(packageRoot);
  let storedVerified = 0;
  for (const entry of checked.manifest.files) {
    const payloadPath = targetInside(path.join(checked.root, 'payload'), entry.payloadRelativePath);
    if (!fs.existsSync(payloadPath) || !fs.statSync(payloadPath).isFile()) throw new Error(`迁移包缺少文件：${entry.relativePath}`);
    if (await sha256File(payloadPath) !== String(entry.storedSha256 || '').toLowerCase()) throw new Error(`迁移包文件校验失败：${entry.relativePath}`);
    storedVerified += 1;
  }
  return {
    ok: true,
    packagePath: checked.root,
    migrationId: checked.manifest.migrationId,
    appVersion: checked.manifest.appVersion,
    createdAt: checked.manifest.createdAt,
    encrypted: checked.manifest.encrypted,
    requiresPassword: checked.manifest.encrypted,
    fileCount: checked.manifest.files.length,
    totalBytes: checked.manifest.files.reduce((sum, item) => sum + Number(item.size || 0), 0),
    externalSources: checked.manifest.externalSources || [],
    storedVerified,
    sourceManagedRoot: checked.manifest.source?.managedRoot || '',
  };
}

function hashingTransform(hash) {
  return new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } });
}

async function restorePayloadEntry(packageInfo, entry, targetPath, key) {
  const payloadPath = targetInside(path.join(packageInfo.root, 'payload'), entry.payloadRelativePath);
  if (await sha256File(payloadPath) !== String(entry.storedSha256 || '').toLowerCase()) throw new Error(`迁移包载荷损坏：${entry.relativePath}`);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const hash = crypto.createHash('sha256');
  if (packageInfo.manifest.encrypted) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(entry.authTag, 'base64'));
    await pipeline(fs.createReadStream(payloadPath), decipher, hashingTransform(hash), fs.createWriteStream(targetPath, { flags: 'wx' }));
  } else {
    await pipeline(fs.createReadStream(payloadPath), hashingTransform(hash), fs.createWriteStream(targetPath, { flags: 'wx' }));
  }
  const actual = hash.digest('hex');
  if (actual !== String(entry.sha256 || '').toLowerCase()) throw new Error(`恢复文件内容校验失败：${entry.relativePath}`);
  if (Number.isFinite(Number(entry.mtimeMs))) fs.utimesSync(targetPath, new Date(), new Date(Number(entry.mtimeMs)));
}

function directoryIsEmpty(directoryPath) {
  return !fs.existsSync(directoryPath) || (fs.statSync(directoryPath).isDirectory() && fs.readdirSync(directoryPath).length === 0);
}

function versionParts(value) {
  return String(value || '').split('.').slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function versionIsNewer(source, target) {
  const left = versionParts(source);
  const right = versionParts(target);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

function remapAllStorageStrings(input, sourceRoot, targetRoot) {
  const visit = (value) => {
    if (typeof value === 'string') return rebaseStoragePath(value, sourceRoot, targetRoot, { platform: process.platform });
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
  };
  return visit(input);
}

function remapJsonFile(filePath, sourceManagedRoot, targetManagedRoot, sourceUserDataRoot, targetUserDataRoot, externalMappings, allStorageStrings = false) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const remap = (value, source, target) => allStorageStrings
    ? remapAllStorageStrings(value, source, target)
    : remapStorageTree(value, source, target, { platform: process.platform }).value;
  let next = remap(parsed, sourceManagedRoot, targetManagedRoot);
  if (sourceUserDataRoot && targetUserDataRoot) next = remap(next, sourceUserDataRoot, targetUserDataRoot);
  for (const mapping of externalMappings) next = remap(next, mapping.sourceRoot, mapping.targetRoot);
  if (path.basename(filePath).toLowerCase() === 'settings.json') {
    next.studentBaseDir = targetManagedRoot;
    next.archiveRoot = targetManagedRoot;
    delete next.license;
    delete next.apiToken;
  }
  if (path.basename(filePath).toLowerCase() === 'projects.json' && Array.isArray(next)) {
    next = {
      version: 1,
      updatedAt: new Date().toISOString(),
      projects: next,
    };
  }
  atomicJson(filePath, next);
}

function isPortableMetadataJson(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/gu, '/').toLowerCase();
  const name = path.posix.basename(normalized);
  return normalized.startsWith('.edu-manager/')
    || normalized.includes('/.edu-manager/')
    || normalized.startsWith('.ai-manager/')
    || normalized.includes('/.ai-manager/')
    || ['growth-index.json', '成长证据审核.json'].includes(name);
}

function installStateFiles(stateStage, userDataDir, rollbackRoot) {
  const files = walkFiles(stateStage);
  const installed = [];
  for (const item of files) {
    const target = targetInside(userDataDir, item.relativePath);
    const backup = targetInside(rollbackRoot, item.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(target, backup);
    }
    const temporary = `${target}.${process.pid}.migration`;
    fs.copyFileSync(item.absolutePath, temporary);
    fs.renameSync(temporary, target);
    installed.push({ target, backup: fs.existsSync(backup) ? backup : '', existed: fs.existsSync(backup) });
  }
  return installed;
}

function rollbackStateFiles(installed) {
  for (const item of [...installed].reverse()) {
    if (item.existed && fs.existsSync(item.backup)) fs.copyFileSync(item.backup, item.target);
    else if (!item.existed && fs.existsSync(item.target)) fs.rmSync(item.target, { force: true });
  }
}

async function restoreMigrationPackage(options = {}) {
  const checked = readAndVerifyManifest(options.packageRoot);
  const targetRoot = path.resolve(options.targetRoot || '');
  const userDataDir = path.resolve(options.userDataDir || '');
  if (!targetRoot || path.parse(targetRoot).root === targetRoot) throw new Error('不能把磁盘根目录作为迁移目标。');
  if (!directoryIsEmpty(targetRoot)) throw new Error('迁移目标目录必须为空，避免覆盖当前电脑已有资料。');
  if (options.currentAppVersion && versionIsNewer(checked.manifest.appVersion, options.currentAppVersion)) {
    throw new Error(`迁移包来自较新的主机端 ${checked.manifest.appVersion}，请先升级当前主机端 ${options.currentAppVersion}。`);
  }
  const requiredBytes = checked.manifest.files.filter((item) => item.category !== 'state').reduce((sum, item) => sum + Number(item.size || 0), 0);
  const volumeRoot = fs.existsSync(path.dirname(targetRoot)) ? path.dirname(targetRoot) : path.parse(targetRoot).root;
  if (typeof fs.statfsSync === 'function' && fs.existsSync(volumeRoot)) {
    const volume = fs.statfsSync(volumeRoot);
    const availableBytes = Number(volume.bavail) * Number(volume.bsize);
    if (Number.isFinite(availableBytes) && availableBytes < Math.ceil(requiredBytes * 1.1)) throw new Error(`目标磁盘空间不足：至少需要 ${Math.ceil(requiredBytes * 1.1)} 字节可用空间。`);
  }
  const password = String(options.password || '');
  if (checked.manifest.encrypted && !password) throw new Error('该迁移包已加密，请输入迁移密码。');
  const key = checked.manifest.encrypted ? deriveKey(password, Buffer.from(checked.manifest.encryption.salt, 'base64')) : null;
  const migrationId = safeId(checked.manifest.migrationId, `migration-${Date.now()}`);
  const stageRoot = path.join(path.dirname(targetRoot), `.${path.basename(targetRoot)}.${migrationId}.staging`);
  const stateStage = path.join(stageRoot, '.migration-state');
  const managedStage = path.join(stageRoot, 'managed');
  const rollbackRoot = path.join(userDataDir, 'migration-rollbacks', migrationId);
  if (fs.existsSync(stageRoot)) throw new Error('发现同名未完成迁移暂存目录，请先查看迁移诊断记录。');
  fs.mkdirSync(managedStage, { recursive: true });
  fs.mkdirSync(stateStage, { recursive: true });
  const externalMappings = [];
  let completedFiles = 0;
  let completedBytes = 0;
  const totalFiles = checked.manifest.files.length;
  let installed = [];
  let activatedRoot = false;
  try {
    progressEmitter(options.onProgress, { phase: 'restoring', totalFiles, completedFiles, completedBytes });
    for (const entry of checked.manifest.files) {
      let target;
      if (entry.category === 'managed') target = targetInside(managedStage, entry.relativePath);
      else if (entry.category === 'external') target = targetInside(path.join(managedStage, '.edu-manager', 'migrated-external', safeId(entry.scopeId)), entry.relativePath);
      else if (entry.category === 'state') target = targetInside(stateStage, entry.destinationRelativePath || entry.relativePath);
      else throw new Error(`迁移包包含未知数据类别：${entry.category}`);
      await restorePayloadEntry(checked, entry, target, key);
      completedFiles += 1;
      completedBytes += Number(entry.size || 0);
      progressEmitter(options.onProgress, { phase: 'restoring', totalFiles, completedFiles, completedBytes, current: entry.relativePath });
    }
    for (const external of checked.manifest.externalSources || []) {
      externalMappings.push({ sourceRoot: external.sourceRoot, targetRoot: path.join(targetRoot, '.edu-manager', 'migrated-external', safeId(external.id)) });
    }
    for (const item of walkFiles(stateStage)) {
      if (path.extname(item.absolutePath).toLowerCase() !== '.json') continue;
      try { remapJsonFile(item.absolutePath, checked.manifest.source?.managedRoot || '', targetRoot, checked.manifest.source?.userDataRoot || '', userDataDir, externalMappings); } catch (error) { throw new Error(`迁移状态文件无法重映射：${item.relativePath}（${error.message}）`); }
    }
    const studentStatePath = path.join(stateStage, 'students.json');
    const maxActiveStudents = Number(options.maxActiveStudents || 0);
    if (maxActiveStudents && fs.existsSync(studentStatePath)) {
      const restoredStudents = JSON.parse(fs.readFileSync(studentStatePath, 'utf8'));
      const activeCount = (Array.isArray(restoredStudents) ? restoredStudents : []).filter((student) => student?.archived !== true && String(student?.status || '').toLowerCase() !== 'archived').length;
      if (activeCount > maxActiveStudents) throw new Error(`迁移包包含 ${activeCount} 名活跃学生，超过当前授权上限 ${maxActiveStudents} 名。请升级授权后再恢复。`);
    }
    const dataFiles = walkFiles(managedStage);
    for (const item of dataFiles) {
      const expected = checked.manifest.files.find((entry) => entry.category !== 'state' && (
        entry.category === 'managed'
          ? entry.relativePath === item.relativePath
          : item.relativePath.replace(/\\/g, '/').endsWith(`/${safeId(entry.scopeId)}/${entry.relativePath}`)
      ));
      if (expected && await sha256File(item.absolutePath) !== expected.sha256) throw new Error(`暂存数据复核失败：${item.relativePath}`);
    }
    let remappedMetadataFiles = 0;
    for (const item of dataFiles) {
      if (path.extname(item.absolutePath).toLowerCase() !== '.json' || !isPortableMetadataJson(item.relativePath)) continue;
      try {
        remapJsonFile(item.absolutePath, checked.manifest.source?.managedRoot || '', targetRoot, checked.manifest.source?.userDataRoot || '', userDataDir, externalMappings, true);
        remappedMetadataFiles += 1;
      } catch (error) {
        throw new Error(`迁移知识元数据无法重映射：${item.relativePath}（${error.message}）`);
      }
    }
    if (fs.existsSync(targetRoot)) fs.rmdirSync(targetRoot);
    fs.renameSync(managedStage, targetRoot);
    activatedRoot = true;
    const currentSettingsPath = path.join(userDataDir, 'settings.json');
    const currentSettings = fs.existsSync(currentSettingsPath) ? JSON.parse(fs.readFileSync(currentSettingsPath, 'utf8')) : {};
    installed = installStateFiles(stateStage, userDataDir, rollbackRoot);
    const existingSettingsPath = path.join(userDataDir, 'settings.json');
    const restoredSettings = fs.existsSync(existingSettingsPath) ? JSON.parse(fs.readFileSync(existingSettingsPath, 'utf8')) : {};
    atomicJson(existingSettingsPath, {
      ...restoredSettings,
      ...(currentSettings.license ? { license: currentSettings.license } : {}),
      ...(currentSettings.apiToken ? { apiToken: currentSettings.apiToken } : {}),
      studentBaseDir: targetRoot,
      archiveRoot: targetRoot,
    });
    const unresolvedExternal = (checked.manifest.unresolvedExternalSources || []).map((item) => ({ ...item, action: 'needs_relocation' }));
    const report = {
      schema: REPORT_SCHEMA,
      migrationId: checked.manifest.migrationId,
      restoredAt: new Date().toISOString(),
      packagePath: checked.root,
      sourceManagedRoot: checked.manifest.source?.managedRoot || '',
      targetRoot,
      fileCount: totalFiles,
      totalBytes: completedBytes,
      remappedMetadataFiles,
      externalMappings,
      unresolvedExternal,
      sensitiveDataRestored: false,
      nextActions: ['重新激活 License', '重新连接学生终端', '重新授权跨主机协作', ...(unresolvedExternal.length ? ['重新定位未打包的外部目录'] : [])],
    };
    atomicJson(path.join(targetRoot, '.edu-manager', 'migration-report.json'), report);
    if (fs.existsSync(stateStage)) fs.rmSync(stateStage, { recursive: true, force: true });
    if (fs.existsSync(stageRoot) && fs.readdirSync(stageRoot).length === 0) fs.rmdirSync(stageRoot);
    progressEmitter(options.onProgress, { phase: 'completed', totalFiles, completedFiles, completedBytes, targetRoot });
    return { ok: true, ...report, rollbackPath: rollbackRoot };
  } catch (error) {
    if (installed.length) rollbackStateFiles(installed);
    let recoveryPath = stageRoot;
    if (activatedRoot && fs.existsSync(targetRoot)) {
      recoveryPath = `${targetRoot}.migration-unactivated-${Date.now()}`;
      fs.renameSync(targetRoot, recoveryPath);
    }
    progressEmitter(options.onProgress, { phase: 'failed', totalFiles, completedFiles, completedBytes, message: error.message, recoveryPath });
    throw Object.assign(new Error(error.message), { recoveryPath });
  }
}

module.exports = {
  MANIFEST_SCHEMA,
  PACKAGE_SCHEMA,
  REPORT_SCHEMA,
  createMigrationPackage,
  inspectMigrationPackage,
  inspectMigrationSources,
  isPortableMetadataJson,
  compareSourceSnapshot,
  isSameOrInside,
  portableRelative,
  restoreMigrationPackage,
  sha256File,
  walkFiles,
};
