const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  canonicalize,
  catalogChecksum,
  catalogSignaturePayload,
  compareVersions,
  validateCatalogPackage,
} = require('./course-catalog.cjs');

const COURSE_PACKAGE_SCHEMA = 'edu-manager.course-package.v3';
const LEGACY_COURSE_PACKAGE_SCHEMA = 'edu-manager.course-package.v2';
const COURSE_PACKAGE_SIGNATURE_SCHEMA = 'edu-manager.course-package-signature.v1';
const MAX_PACKAGE_BYTES = 250 * 1024 * 1024;
const MAX_PACKAGE_FILES = 1000;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function imageExtension(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return '';
}

function safeEntryName(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) return '';
  if (!/^(manifest\.json|catalog\.json|signature\.json|assets\/[a-f0-9]{64}\.(png|jpg|jpeg|webp))$/i.test(normalized)) return '';
  return normalized;
}

function runTar(args, cwd) {
  const result = spawnSync('tar.exe', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`课程签名包处理失败：${String(result.stderr || result.stdout || `tar exit ${result.status}`).trim()}`);
  return String(result.stdout || '');
}

function assertInside(target, parent) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  if (resolvedTarget !== resolvedParent && !resolvedTarget.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error('课程签名包临时路径越界。');
  }
}

function nextCatalogVersion(baseVersion = '', date = new Date()) {
  const prefix = `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${String(date.getUTCDate()).padStart(2, '0')}`;
  const match = String(baseVersion || '').match(new RegExp(`^${prefix.replaceAll('.', '\\.')}\\.(\\d+)$`));
  return `${prefix}.${match ? Number(match[1]) + 1 : 1}`;
}

function createCoursePackage(options = {}) {
  const privateKey = String(options.privateKey || '').trim();
  const keyId = String(options.keyId || '').trim();
  if (!privateKey || !/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(keyId)) throw new Error('发布 v3 课程包必须提供部署侧 RSA 私钥和有效 keyId。');
  const publicKey = String(options.publicKey || crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }));
  const drafts = Array.isArray(options.drafts) ? options.drafts : [];
  const deletedCourseIds = [...new Set((Array.isArray(options.deletedCourseIds) ? options.deletedCourseIds : []).map((item) => String(item || '').trim()).filter(Boolean))];
  if (!drafts.length && !deletedCourseIds.length) throw new Error('没有可发布的平台课程变更。');
  const invalid = drafts.filter((draft) => draft?.validation?.ok !== true);
  if (invalid.length) throw new Error(`仍有 ${invalid.length} 门平台课程草稿未通过发布前校验。`);
  const baseCatalog = options.baseCatalog || { courses: [], catalogVersion: '' };
  const byId = new Map((Array.isArray(baseCatalog.courses) ? baseCatalog.courses : [])
    .filter((course) => course.type === 'platform_standard')
    .map((course) => [course.courseId, course]));
  for (const draft of drafts) byId.set(draft.courseId, draft.course);
  for (const courseId of deletedCourseIds) {
    if (!byId.has(courseId)) throw new Error(`待删除的平台课程不存在：${courseId}`);
    if (drafts.some((draft) => draft.courseId === courseId)) throw new Error(`平台课程不能同时编辑和删除：${courseId}`);
    byId.delete(courseId);
  }

  const assets = new Map();
  const courses = [...byId.values()].map((course) => {
    const sourcePath = String(options.resolveAssetPath?.(course.coverAsset) || '');
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error(`课程 ${course.name} 的封面资源不存在。`);
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ASSET_BYTES) throw new Error(`课程 ${course.name} 的封面为空或超过 5 MB。`);
    const buffer = fs.readFileSync(sourcePath);
    const extension = imageExtension(buffer);
    if (!extension) throw new Error(`课程 ${course.name} 的封面格式不受支持。`);
    const digest = sha256File(sourcePath);
    const filename = `${digest}${extension}`;
    assets.set(filename, sourcePath);
    return { ...course, coverAsset: `platform-assets/${filename}` };
  });

  const issuedAt = String(options.issuedAt || new Date().toISOString());
  const catalogVersion = String(options.catalogVersion || nextCatalogVersion(baseCatalog.catalogVersion, new Date(issuedAt)));
  if (baseCatalog.catalogVersion && compareVersions(catalogVersion, baseCatalog.catalogVersion) <= 0) {
    throw new Error('新平台目录版本必须高于当前最后可用版本。');
  }
  const unsignedCatalog = {
    schemaVersion: 1,
    catalogVersion,
    issuedAt,
    minHostVersion: String(options.minHostVersion || '0.15.7'),
    keyId,
    courses,
  };
  const catalogToSign = {
    ...unsignedCatalog,
    checksum: catalogChecksum(unsignedCatalog),
    signature: '',
  };
  const catalog = {
    ...catalogToSign,
    signature: crypto.sign('RSA-SHA256', Buffer.from(catalogSignaturePayload(catalogToSign)), privateKey).toString('base64'),
  };
  const checked = validateCatalogPackage(catalog, { hostVersion: options.hostVersion || '999.0.0', publicKey, requireSignature: true });
  if (!checked.ok) throw new Error(`平台课程目录完整性回验失败：${checked.message}`);

  const tempBase = path.resolve(options.tempRoot || path.join(os.tmpdir(), 'ai-edu-course-packages'));
  fs.mkdirSync(tempBase, { recursive: true });
  const stage = path.join(tempBase, `publish-${process.pid}-${crypto.randomUUID()}`);
  assertInside(stage, tempBase);
  fs.mkdirSync(path.join(stage, 'assets'), { recursive: true });
  try {
    const catalogPath = path.join(stage, 'catalog.json');
    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    const files = [{ path: 'catalog.json', bytes: fs.statSync(catalogPath).size, sha256: sha256File(catalogPath) }];
    for (const [filename, sourcePath] of assets.entries()) {
      const target = path.join(stage, 'assets', filename);
      fs.copyFileSync(sourcePath, target);
      files.push({ path: `assets/${filename}`, bytes: fs.statSync(target).size, sha256: sha256File(target) });
    }
    files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    const manifest = {
      schema: COURSE_PACKAGE_SCHEMA,
      catalogVersion,
      baseCatalogVersion: String(baseCatalog.catalogVersion || ''),
      issuedAt,
      minHostVersion: unsignedCatalog.minHostVersion,
      releaseIntent: String(options.releaseIntent || 'publish'),
      releaseNotes: String(options.releaseNotes || '').trim().slice(0, 2000),
      files,
    };
    const manifestPath = path.join(stage, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const manifestCanonical = canonicalize(manifest);
    const packageSignature = {
      schema: COURSE_PACKAGE_SIGNATURE_SCHEMA,
      keyId,
      algorithm: 'RSA-SHA256',
      manifestSha256: sha256Buffer(Buffer.from(manifestCanonical)),
      signature: crypto.sign('RSA-SHA256', Buffer.from(manifestCanonical), privateKey).toString('base64'),
    };
    fs.writeFileSync(path.join(stage, 'signature.json'), `${JSON.stringify(packageSignature, null, 2)}\n`, 'utf8');
    const outputPath = path.resolve(options.outputPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    // Windows bsdtar uses the output extension to select the archive format.
    // Keep the staging suffix after `.zip`, then copy the verified artifact to
    // the product-specific `.edu-coursepkg` name.
    const temporary = `${outputPath}.new.zip`;
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    runTar(['-a', '-c', '-f', temporary, 'manifest.json', 'signature.json', 'catalog.json', 'assets'], stage);
    if (!fs.existsSync(temporary) || fs.statSync(temporary).size <= 0) throw new Error('课程签名包没有生成有效文件。');
    fs.copyFileSync(temporary, outputPath);
    fs.rmSync(temporary, { force: true });
    return { ok: true, outputPath, catalog, manifest, sha256: sha256File(outputPath), bytes: fs.statSync(outputPath).size };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function verifyCoursePackage(packagePath, options = {}) {
  const stat = fs.statSync(packagePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PACKAGE_BYTES) return { ok: false, code: 'COURSE_PACKAGE_SIZE_INVALID', message: '课程签名包为空或超过 250 MB。' };
  const tempBase = path.resolve(options.tempRoot || path.join(os.tmpdir(), 'ai-edu-course-packages'));
  fs.mkdirSync(tempBase, { recursive: true });
  const stage = path.join(tempBase, `verify-${process.pid}-${crypto.randomUUID()}`);
  assertInside(stage, tempBase);
  fs.mkdirSync(stage, { recursive: true });
  try {
    const entries = runTar(['-tf', path.resolve(packagePath)], stage).split(/\r?\n/).map((item) => item.trim().replace(/\/$/, '')).filter(Boolean);
    const files = entries.filter((entry) => entry !== 'assets');
    if (!files.length || files.length > MAX_PACKAGE_FILES) throw new Error('课程签名包文件数量无效。');
    if (new Set(files).size !== files.length) throw new Error('课程签名包包含重复文件。');
    if (files.some((entry) => !safeEntryName(entry))) throw new Error('课程签名包包含未知或越界文件。');
    if (!['manifest.json', 'catalog.json'].every((required) => files.includes(required))) throw new Error('课程包缺少必要文件。');
    const verboseLines = runTar(['-tvf', path.resolve(packagePath)], stage).split(/\r?\n/).filter(Boolean);
    let expandedBytes = 0;
    for (const entry of entries) {
      const line = verboseLines.find((candidate) => candidate.trimEnd().endsWith(entry) || candidate.trimEnd().endsWith(`${entry}/`));
      const match = line?.match(/^\S+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+/);
      if (!match) throw new Error(`无法读取课程签名包文件大小：${entry}`);
      const bytes = Number(match[1]);
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`课程签名包文件大小无效：${entry}`);
      if (entry.startsWith('assets/') && bytes > MAX_ASSET_BYTES) throw new Error(`课程签名包图片超过 5 MB：${entry}`);
      if (!entry.startsWith('assets/') && bytes > 5 * 1024 * 1024) throw new Error(`课程签名包清单文件超过 5 MB：${entry}`);
      expandedBytes += bytes;
      if (expandedBytes > MAX_PACKAGE_BYTES) throw new Error('课程签名包展开后超过 250 MB。');
    }
    runTar(['-xf', path.resolve(packagePath)], stage);
    const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8'));
    if (![COURSE_PACKAGE_SCHEMA, LEGACY_COURSE_PACKAGE_SCHEMA].includes(manifest.schema)) throw new Error('课程包 Schema 不受支持。');
    const signaturePath = path.join(stage, 'signature.json');
    if (manifest.schema === COURSE_PACKAGE_SCHEMA && !fs.existsSync(signaturePath)) throw new Error('v3 课程包缺少发布者签名。');
    if (manifest.schema === LEGACY_COURSE_PACKAGE_SCHEMA && !fs.existsSync(signaturePath) && options.allowLegacyUnsigned !== true) {
      throw new Error('旧版无签名课程包默认禁止导入。');
    }
    let trustedPublicKey = '';
    if (fs.existsSync(signaturePath)) {
      const signatureRecord = JSON.parse(fs.readFileSync(signaturePath, 'utf8'));
      if (signatureRecord.schema !== COURSE_PACKAGE_SIGNATURE_SCHEMA || signatureRecord.algorithm !== 'RSA-SHA256') throw new Error('课程包签名格式不受支持。');
      const keyId = String(signatureRecord.keyId || '');
      trustedPublicKey = String(options.publicKeys?.get?.(keyId) || (String(options.keyId || '') === keyId ? options.publicKey : '') || '');
      if (!trustedPublicKey) throw new Error(`课程包发布密钥不受信任：${keyId || '空'}`);
      const manifestCanonical = canonicalize(manifest);
      if (sha256Buffer(Buffer.from(manifestCanonical)) !== String(signatureRecord.manifestSha256 || '')) throw new Error('课程包清单签名哈希不匹配。');
      const signature = Buffer.from(String(signatureRecord.signature || ''), 'base64');
      if (!signature.length || !crypto.verify('RSA-SHA256', Buffer.from(manifestCanonical), trustedPublicKey, signature)) throw new Error('课程包发布者签名验证失败。');
    }
    const declared = Array.isArray(manifest.files) ? manifest.files : [];
    if (new Set(declared.map((file) => String(file?.path || ''))).size !== declared.length) throw new Error('课程签名包文件清单包含重复路径。');
    const archivedPayloadFiles = files.filter((entry) => !['manifest.json', 'signature.json'].includes(entry)).sort();
    const declaredPaths = declared.map((file) => String(file?.path || '')).sort();
    if (declaredPaths.length !== archivedPayloadFiles.length || declaredPaths.some((entry, index) => entry !== archivedPayloadFiles[index])) {
      throw new Error('课程签名包文件清单与归档内容不一致。');
    }
    for (const file of declared) {
      const entry = safeEntryName(file.path);
      if (!entry || ['manifest.json', 'signature.json'].includes(entry)) throw new Error('课程签名包文件清单包含非法路径。');
      const target = path.resolve(stage, ...entry.split('/'));
      if (!target.startsWith(`${path.resolve(stage)}${path.sep}`) || !fs.existsSync(target)) throw new Error(`课程签名包缺少 ${entry}。`);
      const targetStat = fs.statSync(target);
      if (!targetStat.isFile() || targetStat.size !== Number(file.bytes) || sha256File(target) !== String(file.sha256 || '')) throw new Error(`课程签名包文件校验失败：${entry}`);
      if (entry.startsWith('assets/') && imageExtension(fs.readFileSync(target)) !== path.extname(entry).toLowerCase().replace('.jpeg', '.jpg')) {
        throw new Error(`课程签名包图片格式与扩展名不一致：${entry}`);
      }
    }
    const catalog = JSON.parse(fs.readFileSync(path.join(stage, 'catalog.json'), 'utf8'));
    const checked = validateCatalogPackage(catalog, {
      hostVersion: options.hostVersion || '0.0.0',
      publicKey: trustedPublicKey,
      requireSignature: manifest.schema === COURSE_PACKAGE_SCHEMA,
    });
    if (!checked.ok) throw new Error(checked.message);
    if (checked.catalog.catalogVersion !== manifest.catalogVersion) throw new Error('课程目录版本与签名包清单不一致。');
    const assets = [];
    for (const course of checked.catalog.courses) {
      if (!/^platform-assets\/[a-f0-9]{64}\.(png|jpg|jpeg|webp)$/i.test(course.coverAsset)) throw new Error(`课程 ${course.courseId} 的发布图片路径无效。`);
      const filename = path.basename(course.coverAsset);
      const sourcePath = path.join(stage, 'assets', filename);
      if (!fs.existsSync(sourcePath)) throw new Error(`课程 ${course.courseId} 的发布图片缺失。`);
      assets.push({ filename, buffer: fs.readFileSync(sourcePath), sha256: sha256File(sourcePath) });
    }
    return { ok: true, manifest, catalog: checked.catalog, assets };
  } catch (error) {
    return { ok: false, code: 'COURSE_PACKAGE_REJECTED', message: error.message };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

// Compatibility aliases keep older callers and previously written tests usable
// while the product now publishes and verifies integrity-only packages.
const createSignedCoursePackage = createCoursePackage;
const verifySignedCoursePackage = verifyCoursePackage;

module.exports = {
  COURSE_PACKAGE_SCHEMA,
  COURSE_PACKAGE_SIGNATURE_SCHEMA,
  MAX_ASSET_BYTES,
  MAX_PACKAGE_BYTES,
  createCoursePackage,
  createSignedCoursePackage,
  imageExtension,
  nextCatalogVersion,
  safeEntryName,
  sha256Buffer,
  sha256File,
  verifyCoursePackage,
  verifySignedCoursePackage,
};
