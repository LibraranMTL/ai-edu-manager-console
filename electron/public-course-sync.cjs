const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CONTRACT_ID = 'edu-manager.public-course-mvp.v1';

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'w', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function publicKeyFor(value, publicKeys) {
  const keyId = String(value?.keyId || '');
  const key = publicKeys?.get?.(keyId);
  if (!key) throw new Error(`公共课程签名密钥不受信任：${keyId || '空'}`);
  return key;
}

function verifySigned(value, publicKeys) {
  if (value?.contractId !== CONTRACT_ID || value?.signatureAlgorithm !== 'RSA-SHA256' || !value?.signature) throw new Error('公共课程签名合同无效。');
  const unsigned = { ...value }; delete unsigned.signature;
  if (!crypto.verify('RSA-SHA256', Buffer.from(canonicalize(unsigned)), publicKeyFor(value, publicKeys), Buffer.from(value.signature, 'base64'))) {
    throw new Error('公共课程发布者签名验证失败。');
  }
  return value;
}

function extensionForMime(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  throw new Error(`公共课程资源类型不受支持：${mimeType}`);
}

function imageMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return '';
}

function endpointUrl(baseUrl, endpointPath) {
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith('/')) base.pathname = `${base.pathname}/`;
  return new URL(String(endpointPath || '').replace(/^\/+/, ''), base);
}

function manifestToCatalog(manifest, assetFiles) {
  return {
    schemaVersion: 1,
    catalogVersion: manifest.manifestRevision,
    manifestRevision: manifest.manifestRevision,
    issuedAt: manifest.issuedAt,
    minHostVersion: String(manifest.minClientVersions?.windowsHost || '0.0.0'),
    keyId: manifest.keyId,
    cloudFreshUntil: manifest.expiresAt,
    tombstones: Array.isArray(manifest.tombstones) ? manifest.tombstones : [],
    courses: manifest.courses.map(course => ({
      courseId: course.courseId,
      type: course.courseId.startsWith('tenant:') ? 'tenant_custom' : 'platform_standard',
      name: course.title,
      provider: course.provider,
      url: course.launchUrl,
      allowedHosts: course.allowedHosts,
      coverAsset: assetFiles.get(course.coverAssetRevisionId),
      summary: course.summary,
      subjects: [],
      gradeRange: course.gradeBands || [],
      languages: [course.locale],
      accountRequirement: course.accountRequirement || '',
      effectiveAt: manifest.effectiveAt,
      expiresAt: null,
      legalNotice: course.legalNotice,
      status: 'active',
      offlineOpenTtlSeconds: course.offlineOpenTtlSeconds,
    })),
  };
}

async function syncPublicCourses(options = {}) {
  const baseUrl = new URL(String(options.baseUrl || ''));
  if (baseUrl.protocol !== 'https:' && options.allowHttpForTests !== true) throw new Error('公共课程同步地址必须使用HTTPS。');
  const cacheDir = path.resolve(options.cacheDir);
  const assetsDir = path.join(cacheDir, 'assets');
  const activePath = path.join(cacheDir, 'active.json');
  const metadataPath = path.join(cacheDir, 'sync-metadata.json');
  const metadata = readJson(metadataPath, {});
  const fetchImpl = options.fetchImpl || fetch;
  const headers = metadata.manifestEtag ? { 'If-None-Match': metadata.manifestEtag } : {};
  const response = await fetchImpl(endpointUrl(baseUrl, 'v2/public-content/manifest'), { headers, signal: AbortSignal.timeout(options.timeoutMs || 15_000) });
  if (response.status === 304) {
    const cached = readJson(activePath);
    if (!cached) throw new Error('服务端返回304但本机没有最后可用公共课程清单。');
    verifySigned(cached.manifest, options.publicKeys);
    return { ok: true, notModified: true, ...cached };
  }
  if (!response.ok) throw new Error(`公共课程清单读取失败：HTTP ${response.status}`);
  const manifest = verifySigned(await response.json(), options.publicKeys);
  const now = Number(options.now?.() ?? Date.now());
  if (Date.parse(manifest.effectiveAt) > now || Date.parse(manifest.expiresAt) <= now) throw new Error('公共课程清单尚未生效或已经过期。');
  if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.courses)) throw new Error('公共课程清单资源结构无效。');

  fs.mkdirSync(assetsDir, { recursive: true });
  const assetFiles = new Map();
  for (const asset of manifest.assets) {
    const extension = extensionForMime(asset.mimeType);
    const filename = `${asset.sha256}.${extension}`;
    const target = path.join(assetsDir, filename);
    let bytes = fs.existsSync(target) ? fs.readFileSync(target) : null;
    if (!bytes || bytes.length !== Number(asset.bytes) || sha256(bytes) !== asset.sha256 || imageMime(bytes) !== asset.mimeType) {
      const assetResponse = await fetchImpl(endpointUrl(baseUrl, asset.downloadPath), { signal: AbortSignal.timeout(options.timeoutMs || 15_000) });
      if (!assetResponse.ok) throw new Error(`公共课程资源读取失败：${asset.assetRevisionId} HTTP ${assetResponse.status}`);
      bytes = Buffer.from(await assetResponse.arrayBuffer());
      if (bytes.length !== Number(asset.bytes) || sha256(bytes) !== asset.sha256 || imageMime(bytes) !== asset.mimeType) throw new Error(`公共课程资源校验失败：${asset.assetRevisionId}`);
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, bytes, { flag: 'w', mode: 0o600 });
      fs.renameSync(temporary, target);
    }
    assetFiles.set(asset.assetRevisionId, `cloud-assets/${filename}`);
  }
  const catalog = manifestToCatalog(manifest, assetFiles);
  catalog.synchronizedAt = new Date(now).toISOString();
  const active = { schema: 'edu-manager.public-course-cache.v1', manifest, catalog, synchronizedAt: catalog.synchronizedAt };
  atomicJson(path.join(cacheDir, `manifest-${manifest.manifestRevision}.json`), active);
  atomicJson(activePath, active);
  atomicJson(metadataPath, { manifestEtag: response.headers.get('etag') || `"${manifest.manifestRevision}"`, manifestRevision: manifest.manifestRevision, synchronizedAt: active.synchronizedAt });
  return { ok: true, notModified: false, ...active };
}

module.exports = { canonicalize, endpointUrl, manifestToCatalog, syncPublicCourses, verifySigned };
