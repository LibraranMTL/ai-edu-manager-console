'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CONTRACT_ID = 'edu-manager.public-course-mvp.v1';
const SCHEMA_VERSION = 1;
const SIGNATURE_ALGORITHM = 'RSA-SHA256';
const ALLOWED_LOCALES = new Set(['zh-CN', 'zh-TW', 'en-US', 'en-GB', 'fr', 'es', 'es-419', 'ja', 'ko', 'vi', 'ms']);
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const SYNC_CLIENT_TYPES = new Set(['windows_host', 'windows_student', 'android_student', 'android_standalone']);
const SYNC_OUTCOMES = new Set(['applied', 'not_modified', 'network_failed', 'blocked_signature', 'blocked_hash', 'blocked_revocation', 'lease_expired', 'incompatible_client']);

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function canonicalize(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function detectedImageMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return '';
}

function cleanText(value, maximum, label, required = true) {
  const output = String(value ?? '').trim();
  if ((required && !output) || output.length > maximum) fail(400, `${label}无效`);
  return output;
}

function validId(value, prefix) {
  return new RegExp(`^${prefix}[A-Za-z0-9._:-]{2,160}$`).test(String(value || ''));
}

function normalizeDate(value, label, required = true) {
  if (!value && !required) return null;
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) fail(400, `${label}无效`);
  return new Date(timestamp).toISOString();
}

function normalizeHost(value) {
  const host = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..')) fail(400, '课程允许域名无效');
  return host;
}

function normalizeCourse(input = {}) {
  const courseId = cleanText(input.courseId, 160, '课程ID');
  if (!/^(platform|tenant):[a-z0-9][a-z0-9-]{2,120}$/.test(courseId)) fail(400, '课程ID无效');
  const courseRevision = cleanText(input.courseRevision || `course-rev-${sha256(canonicalize(input)).slice(0, 20)}`, 120, '课程修订');
  const locale = cleanText(input.locale, 20, '课程语言');
  if (!ALLOWED_LOCALES.has(locale)) fail(400, '课程语言不在允许的11种locale中');
  const launchUrl = cleanText(input.launchUrl, 2048, '课程入口');
  let url;
  try { url = new URL(launchUrl); } catch { fail(400, '课程入口无效'); }
  if (url.protocol !== 'https:' || url.username || url.password) fail(400, '课程入口必须为无账号信息的HTTPS URL');
  const allowedHosts = [...new Set((Array.isArray(input.allowedHosts) ? input.allowedHosts : []).map(normalizeHost))];
  if (!allowedHosts.length || !allowedHosts.includes(normalizeHost(url.hostname))) fail(400, '课程入口域名不在允许列表');
  const coverAssetRevisionId = cleanText(input.coverAssetRevisionId, 180, '封面资源修订');
  const offlineOpenTtlSeconds = Number(input.offlineOpenTtlSeconds ?? 21600);
  if (!Number.isInteger(offlineOpenTtlSeconds) || offlineOpenTtlSeconds < 0 || offlineOpenTtlSeconds > 21600) {
    fail(400, '离线打开期限必须为0至21600秒');
  }
  return {
    courseId,
    courseRevision,
    sourceCategory: cleanText(input.sourceCategory || (courseId.startsWith('tenant:') ? 'tenant_curated' : 'platform_curated'), 60, '课程来源'),
    localizationRevision: cleanText(input.localizationRevision || `loc-rev-${sha256(`${courseId}:${locale}:${courseRevision}`).slice(0, 20)}`, 120, '本地化修订'),
    locale,
    title: cleanText(input.title, 160, '课程标题'),
    summary: cleanText(input.summary, 1600, '课程简介'),
    provider: cleanText(input.provider, 160, '课程提供方'),
    launchUrl: url.toString(),
    allowedHosts,
    coverAssetRevisionId,
    gradeBands: [...new Set((Array.isArray(input.gradeBands) ? input.gradeBands : []).map(item => cleanText(item, 40, '年级', false)).filter(Boolean))],
    ageRange: cleanText(input.ageRange || '', 80, '年龄范围', false),
    legalNotice: cleanText(input.legalNotice, 2000, '法律说明'),
    accountRequirement: cleanText(input.accountRequirement || '', 320, '账号要求', false),
    defaultEnabled: input.defaultEnabled !== false,
    offlineOpenTtlSeconds,
    minClientVersions: input.minClientVersions && typeof input.minClientVersions === 'object' ? input.minClientVersions : {},
  };
}

function unsigned(value) {
  const output = { ...value };
  delete output.signature;
  return output;
}

function signObject(value, privateKey, keyId) {
  if (!privateKey) fail(503, '公共内容签名密钥尚未配置');
  const payloadObject = { ...unsigned(value), keyId, signatureAlgorithm: SIGNATURE_ALGORITHM };
  const payload = canonicalize(payloadObject);
  return {
    ...payloadObject,
    signature: crypto.sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64'),
  };
}

function verifySignedObject(value, publicKey) {
  if (!value?.signature || value.signatureAlgorithm !== SIGNATURE_ALGORITHM || !publicKey) return false;
  return crypto.verify('RSA-SHA256', Buffer.from(canonicalize(unsigned(value))), publicKey, Buffer.from(value.signature, 'base64'));
}

function createPublicContentService(options = {}) {
  const { db, dataDir, isAdmin, now = () => Date.now() } = options;
  if (!db || !dataDir || typeof isAdmin !== 'function') throw new Error('public content service requires db, dataDir and isAdmin');
  const keyId = cleanText(options.keyId || 'course-catalog-primary-2026', 120, '签名密钥ID');
  const privateKey = options.privateKey
    ? (options.privateKey.type === 'private' ? options.privateKey : crypto.createPrivateKey(options.privateKey))
    : null;
  const publicKey = options.publicKey
    ? (options.publicKey.type === 'public' ? options.publicKey : crypto.createPublicKey(options.publicKey))
    : privateKey ? crypto.createPublicKey(privateKey) : null;
  const objectDir = path.join(dataDir, 'public-content-objects');
  fs.mkdirSync(objectDir, { recursive: true });

  db.exec(`
    CREATE TABLE IF NOT EXISTS public_content_assets (
      asset_revision_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, sha256 TEXT NOT NULL,
      byte_size INTEGER NOT NULL, mime_type TEXT NOT NULL, object_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS public_content_assets_digest ON public_content_assets(sha256,mime_type);
    CREATE TABLE IF NOT EXISTS public_course_drafts (
      course_id TEXT PRIMARY KEY, draft_json TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public_content_releases (
      release_id TEXT PRIMARY KEY, manifest_revision TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
      manifest_json TEXT NOT NULL, manifest_sha256 TEXT NOT NULL,
      created_at INTEGER NOT NULL, effective_at INTEGER NOT NULL, activated_at INTEGER,
      previous_revision TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS public_content_state (
      channel TEXT PRIMARY KEY, active_manifest_revision TEXT NOT NULL DEFAULT '',
      revocation_revision TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public_content_revocations (
      revocation_id TEXT PRIMARY KEY, release_id TEXT NOT NULL UNIQUE, course_id TEXT NOT NULL,
      withdrawn_at INTEGER NOT NULL, reason_code TEXT NOT NULL, severity TEXT NOT NULL,
      replacement_course_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public_content_delivery_metrics (
      bucket_start INTEGER NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL,
      target_id TEXT NOT NULL DEFAULT '', request_count INTEGER NOT NULL DEFAULT 0,
      byte_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(bucket_start,action,status,target_id)
    );
    CREATE INDEX IF NOT EXISTS public_content_delivery_metrics_time ON public_content_delivery_metrics(bucket_start);
    CREATE TABLE IF NOT EXISTS public_content_sync_receipts (
      receipt_id TEXT PRIMARY KEY, client_hash TEXT NOT NULL, client_type TEXT NOT NULL,
      client_version TEXT NOT NULL, outcome TEXT NOT NULL, manifest_revision TEXT NOT NULL DEFAULT '',
      revocation_revision TEXT NOT NULL DEFAULT '', detail_code TEXT NOT NULL DEFAULT '',
      attempt_count INTEGER NOT NULL DEFAULT 1, disposition TEXT NOT NULL,
      observed_at INTEGER NOT NULL, received_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS public_content_sync_receipts_time ON public_content_sync_receipts(received_at);
    CREATE INDEX IF NOT EXISTS public_content_sync_receipts_disposition ON public_content_sync_receipts(disposition,received_at);
    INSERT OR IGNORE INTO public_content_state(channel,updated_at) VALUES('stable',0);
    INSERT OR IGNORE INTO schema_migrations(id,applied_at,detail_json)
      VALUES('cloud-public-content-v1',${Number(now())},'{"contractId":"${CONTRACT_ID}","separateObjectRoot":true}');
    INSERT OR IGNORE INTO schema_migrations(id,applied_at,detail_json)
      VALUES('cloud-public-content-observability-v1',${Number(now())},'{"privacy":"hashed-client-id","studentData":false,"receiptAttestation":"unverified"}');
  `);
  let lastMetricsPruneAt = 0;

  function requireAdmin(token) {
    if (!isAdmin(token)) fail(401, '管理员会话无效');
  }

  function audit(action, targetId = '') {
    db.prepare('INSERT INTO audit_events(occurred_at,actor_id,action,student_id,target_id) VALUES(?,?,?,?,?)')
      .run(now(), 'admin_local', action, null, targetId || null);
  }

  function schemaStatus() {
    return { migrationId: 'cloud-public-content-v1', observabilityMigrationId: 'cloud-public-content-observability-v1',
      applied: true, contractId: CONTRACT_ID, signingReady: Boolean(privateKey), keyId };
  }

  function pruneObservability(timestamp) {
    if (timestamp - lastMetricsPruneAt < 6 * 60 * 60 * 1000) return;
    lastMetricsPruneAt = timestamp;
    db.prepare('DELETE FROM public_content_delivery_metrics WHERE bucket_start<?').run(timestamp - 90 * 24 * 60 * 60 * 1000);
    db.prepare('DELETE FROM public_content_sync_receipts WHERE received_at<?').run(timestamp - 90 * 24 * 60 * 60 * 1000);
    db.prepare(`DELETE FROM public_content_sync_receipts WHERE rowid NOT IN
      (SELECT rowid FROM public_content_sync_receipts ORDER BY received_at DESC,rowid DESC LIMIT 100000)`).run();
  }

  function recordDelivery(action, status, targetId = '', bytes = 0) {
    const timestamp = now();
    const bucket = Math.floor(timestamp / 3600000) * 3600000;
    const normalizedAction = cleanText(action, 80, '公共内容指标动作');
    const normalizedStatus = cleanText(status, 40, '公共内容指标状态');
    const normalizedTarget = cleanText(targetId || '', 180, '公共内容指标对象', false);
    const byteCount = Number.isSafeInteger(Number(bytes)) && Number(bytes) >= 0 ? Number(bytes) : 0;
    db.prepare(`INSERT INTO public_content_delivery_metrics(bucket_start,action,status,target_id,request_count,byte_count)
      VALUES(?,?,?,?,1,?) ON CONFLICT(bucket_start,action,status,target_id) DO UPDATE SET
      request_count=request_count+1,byte_count=byte_count+excluded.byte_count`)
      .run(bucket, normalizedAction, normalizedStatus, normalizedTarget, byteCount);
    pruneObservability(timestamp);
  }

  function activeRevisionOrEmpty() {
    return String(db.prepare("SELECT active_manifest_revision AS value FROM public_content_state WHERE channel='stable'").get()?.value || '');
  }

  function revocationRevisionOrEmpty() {
    return String(db.prepare("SELECT revocation_revision AS value FROM public_content_state WHERE channel='stable'").get()?.value || '');
  }

  function receiptDisposition(input, currentManifestRevision, currentRevocationRevision) {
    if (input.outcome === 'blocked_revocation') return 'reconciled';
    if (input.outcome === 'blocked_signature' || input.outcome === 'blocked_hash' || input.outcome === 'incompatible_client') return 'needs_handling';
    if (input.outcome === 'network_failed') return input.attemptCount >= 5 ? 'needs_handling' : 'auto_retry';
    if (input.outcome === 'lease_expired') return 'auto_refresh';
    if (input.manifestRevision !== currentManifestRevision || (currentRevocationRevision && input.revocationRevision !== currentRevocationRevision)) return 'auto_refresh';
    return 'reconciled';
  }

  function recordSyncReceipt(input = {}) {
    const receiptId = cleanText(input.receiptId, 160, '同步回执ID');
    if (!/^receipt:[A-Za-z0-9._:-]{8,150}$/.test(receiptId)) fail(400, '同步回执ID无效');
    const prior = db.prepare(`SELECT receipt_id AS receiptId,disposition,outcome,received_at AS receivedAt
      FROM public_content_sync_receipts WHERE receipt_id=?`).get(receiptId);
    if (prior) return { ...prior, duplicate: true, attestation: 'unverified_telemetry' };
    const clientInstanceId = cleanText(input.clientInstanceId, 180, '客户端实例ID');
    if (!/^[A-Za-z0-9._:-]{8,180}$/.test(clientInstanceId)) fail(400, '客户端实例ID无效');
    const clientType = cleanText(input.clientType, 40, '客户端类型');
    if (!SYNC_CLIENT_TYPES.has(clientType)) fail(400, '客户端类型无效');
    const clientVersion = cleanText(input.clientVersion, 40, '客户端版本');
    const outcome = cleanText(input.outcome, 40, '同步结果');
    if (!SYNC_OUTCOMES.has(outcome)) fail(400, '同步结果无效');
    const manifestRevision = cleanText(input.manifestRevision || '', 180, '清单修订', false);
    const revocationRevision = cleanText(input.revocationRevision || '', 180, '撤回修订', false);
    const detailCode = cleanText(input.detailCode || '', 80, '同步详情代码', false);
    const attemptCount = Number(input.attemptCount || 1);
    if (!Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount > 100) fail(400, '同步尝试次数无效');
    const observedAt = normalizeDate(input.observedAt || new Date(now()).toISOString(), '同步观察时间');
    const receivedAt = now();
    if (Math.abs(receivedAt - Date.parse(observedAt)) > 7 * 24 * 60 * 60 * 1000) fail(400, '同步观察时间超出允许范围');
    const disposition = receiptDisposition({ outcome, manifestRevision, revocationRevision, attemptCount }, activeRevisionOrEmpty(), revocationRevisionOrEmpty());
    db.prepare(`INSERT INTO public_content_sync_receipts
      (receipt_id,client_hash,client_type,client_version,outcome,manifest_revision,revocation_revision,detail_code,attempt_count,disposition,observed_at,received_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(receiptId, sha256(clientInstanceId), clientType, clientVersion, outcome,
      manifestRevision, revocationRevision, detailCode, attemptCount, disposition, Date.parse(observedAt), receivedAt);
    pruneObservability(receivedAt);
    return { receiptId, outcome, disposition, receivedAt, duplicate: false, attestation: 'unverified_telemetry' };
  }

  function operations(token, windowHours = 24) {
    requireAdmin(token);
    const hours = Math.max(1, Math.min(24 * 30, Number(windowHours) || 24));
    const since = now() - hours * 60 * 60 * 1000;
    const deliveryRows = db.prepare(`SELECT action,status,SUM(request_count) AS requestCount,SUM(byte_count) AS byteCount
      FROM public_content_delivery_metrics WHERE bucket_start>=? GROUP BY action,status ORDER BY action,status`).all(since);
    const receiptRows = db.prepare(`SELECT client_type AS clientType,outcome,disposition,COUNT(*) AS count,
      MAX(received_at) AS lastReceivedAt FROM public_content_sync_receipts WHERE received_at>=?
      GROUP BY client_type,outcome,disposition ORDER BY client_type,outcome,disposition`).all(since);
    const currentManifestRevision = activeRevisionOrEmpty();
    const currentRevocationRevision = revocationRevisionOrEmpty();
    const summary = receiptRows.reduce((value, row) => {
      value.total += Number(row.count); value[row.disposition] = (value[row.disposition] || 0) + Number(row.count); return value;
    }, { total: 0, reconciled: 0, auto_refresh: 0, auto_retry: 0, needs_handling: 0 });
    const alerts = [];
    if (!privateKey) alerts.push({ severity: 'critical', code: 'signing_not_ready', message: '公共内容签名密钥未配置。' });
    if (!currentManifestRevision) alerts.push({ severity: 'critical', code: 'no_active_manifest', message: '尚无生效公共课程清单。' });
    if (summary.needs_handling) alerts.push({ severity: 'warning', code: 'sync_needs_handling', message: `${summary.needs_handling}条同步回执需要处理。` });
    const serverFailures = deliveryRows.filter(row => row.status === 'server_error').reduce((sum, row) => sum + Number(row.requestCount), 0);
    if (serverFailures) alerts.push({ severity: 'warning', code: 'delivery_server_error', message: `${serverFailures}次公共内容读取发生服务端错误。` });
    return { windowHours: hours, generatedAt: now(), currentManifestRevision, currentRevocationRevision,
      receiptAttestation: 'unverified_telemetry', delivery: deliveryRows, receipts: receiptRows, summary, alerts };
  }

  function putAsset(token, input = {}) {
    requireAdmin(token);
    const assetId = cleanText(input.assetId, 160, '资源ID');
    if (!validId(assetId, 'asset[:_-]?')) fail(400, '资源ID无效');
    const mimeType = cleanText(input.mimeType, 80, '资源类型');
    if (!ALLOWED_MIME.has(mimeType)) fail(400, '资源类型不受支持');
    let bytes;
    try { bytes = Buffer.from(String(input.contentBase64 || ''), 'base64'); } catch { fail(400, '资源内容无效'); }
    if (!bytes.length || bytes.length > MAX_ASSET_BYTES) fail(400, '资源为空或超过5MB');
    if (detectedImageMime(bytes) !== mimeType) fail(400, '资源内容与声明图片类型不一致');
    const digest = sha256(bytes);
    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const objectName = `${digest}.${extension}`;
    const assetRevisionId = `asset-rev-${digest}`;
    const target = path.join(objectDir, objectName);
    if (!fs.existsSync(target)) {
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temporary, bytes, { flag: 'wx' });
      try { fs.renameSync(temporary, target); } catch (error) {
        if (!fs.existsSync(target)) throw error;
        fs.rmSync(temporary, { force: true });
      }
    }
    db.prepare(`INSERT OR IGNORE INTO public_content_assets
      (asset_revision_id,asset_id,sha256,byte_size,mime_type,object_name,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(assetRevisionId, assetId, digest, bytes.length, mimeType, objectName, now());
    audit('public_content.asset.put', assetRevisionId);
    return { assetId, assetRevisionId, sha256: digest, bytes: bytes.length, mimeType };
  }

  function saveCourse(token, input = {}) {
    requireAdmin(token);
    const course = normalizeCourse(input);
    const asset = db.prepare('SELECT 1 FROM public_content_assets WHERE asset_revision_id=?').get(course.coverAssetRevisionId);
    if (!asset) fail(400, '课程封面资源修订不存在');
    db.prepare(`INSERT INTO public_course_drafts(course_id,draft_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(course_id) DO UPDATE SET draft_json=excluded.draft_json,updated_at=excluded.updated_at`)
      .run(course.courseId, JSON.stringify(course), now());
    audit('public_content.course.save', course.courseId);
    return { course, status: 'draft' };
  }

  function listAssets(token) {
    requireAdmin(token);
    return { assets: db.prepare(`SELECT asset_id AS assetId,asset_revision_id AS assetRevisionId,sha256,
      byte_size AS bytes,mime_type AS mimeType,created_at AS createdAt FROM public_content_assets
      ORDER BY created_at DESC,asset_revision_id DESC LIMIT 500`).all() };
  }

  function listCourses(token) {
    requireAdmin(token);
    return { courses: db.prepare(`SELECT course_id AS courseId,draft_json AS draftJson,updated_at AS updatedAt
      FROM public_course_drafts ORDER BY course_id LIMIT 500`).all()
      .map(row => ({ ...JSON.parse(row.draftJson), updatedAt: row.updatedAt })) };
  }

  function listReleases(token) {
    requireAdmin(token);
    const revoked = revokedCourseIds();
    return { releases: db.prepare(`SELECT release_id AS releaseId,manifest_revision AS manifestRevision,status,
      manifest_sha256 AS manifestSha256,created_at AS createdAt,effective_at AS effectiveAt,
      activated_at AS activatedAt,previous_revision AS previousRevision,manifest_json AS manifestJson FROM public_content_releases
      ORDER BY created_at DESC,release_id DESC LIMIT 200`).all()
      .map(row => {
        const manifest = JSON.parse(row.manifestJson);
        const containsRevokedCourse = (manifest.courses || []).some(course => revoked.has(course.courseId));
        const { manifestJson, ...release } = row;
        return { ...release, containsRevokedCourse };
      }) };
  }

  function revokedCourseIds() {
    return new Set(db.prepare('SELECT DISTINCT course_id AS courseId FROM public_content_revocations').all().map(row => row.courseId));
  }

  function rejectRevokedCourses(courses, action) {
    const revoked = revokedCourseIds();
    const blocked = (courses || []).map(course => course.courseId).filter(courseId => revoked.has(courseId));
    if (blocked.length) fail(409, `${action}包含已紧急撤回课程：${blocked.join('、')}；必须使用独立的解除撤回流程`);
  }

  function buildCandidate(input = {}) {
    const releaseId = cleanText(input.releaseId, 160, '发布ID');
    if (!validId(releaseId, 'release[:_-]?')) fail(400, '发布ID无效');
    const existing = db.prepare('SELECT * FROM public_content_releases WHERE release_id=?').get(releaseId);
    if (existing) return { existing, manifest: JSON.parse(existing.manifest_json), duplicate: true };
    const courseIds = [...new Set((Array.isArray(input.courseIds) ? input.courseIds : []).map(String))];
    if (!courseIds.length) fail(400, '发布必须包含课程');
    const courses = courseIds.map(courseId => {
      const row = db.prepare('SELECT draft_json FROM public_course_drafts WHERE course_id=?').get(courseId);
      if (!row) fail(400, `课程草稿不存在：${courseId}`);
      return normalizeCourse(JSON.parse(row.draft_json));
    }).sort((left, right) => left.courseId.localeCompare(right.courseId, 'en'));
    rejectRevokedCourses(courses, '候选清单');
    const assets = [...new Set(courses.map(course => course.coverAssetRevisionId))].map(assetRevisionId => {
      const row = db.prepare(`SELECT asset_id AS assetId,asset_revision_id AS assetRevisionId,sha256,
        byte_size AS bytes,mime_type AS mimeType FROM public_content_assets WHERE asset_revision_id=?`).get(assetRevisionId);
      if (!row) fail(400, `发布资源不存在：${assetRevisionId}`);
      return { ...row, downloadPath: `/v2/public-content/assets/${assetRevisionId}` };
    }).sort((left, right) => left.assetRevisionId.localeCompare(right.assetRevisionId, 'en'));
    const issuedAt = normalizeDate(input.issuedAt || new Date(now()).toISOString(), '签发时间');
    const effectiveAt = normalizeDate(input.effectiveAt || issuedAt, '生效时间');
    const expiresAt = normalizeDate(input.expiresAt || new Date(Date.parse(issuedAt) + 24 * 60 * 60 * 1000).toISOString(), '到期时间');
    if (Date.parse(expiresAt) <= Date.parse(issuedAt) || Date.parse(expiresAt) - Date.parse(issuedAt) > 24 * 60 * 60 * 1000) {
      fail(400, '清单有效期必须大于0且不超过24小时');
    }
    const state = db.prepare("SELECT active_manifest_revision AS activeManifestRevision FROM public_content_state WHERE channel='stable'").get();
    const manifestRevision = `manifest-rev-${sha256(`${releaseId}:${issuedAt}:${canonicalize(courses)}`).slice(0, 32)}`;
    const manifest = signObject({
      contractId: CONTRACT_ID,
      schemaVersion: SCHEMA_VERSION,
      manifestId: 'public-course-stable',
      manifestRevision,
      releaseId,
      audienceKey: cleanText(input.audienceKey || 'global', 120, '受众'),
      audienceRevision: cleanText(input.audienceRevision || 'audience-global-v1', 120, '受众修订'),
      selectionReason: cleanText(input.selectionReason || 'stable-public-course-release', 320, '选择原因'),
      issuedAt,
      effectiveAt,
      expiresAt,
      previousRevision: state?.activeManifestRevision || '',
      minClientVersions: input.minClientVersions && typeof input.minClientVersions === 'object' ? input.minClientVersions : {},
      courses,
      assets,
      tombstones: [],
    }, privateKey, keyId);
    return { manifest, manifestSha256: sha256(canonicalize(manifest)), duplicate: false };
  }

  function validateRelease(token, input = {}) {
    requireAdmin(token);
    const built = buildCandidate(input);
    if (built.duplicate) return { releaseId: input.releaseId, status: built.existing.status, manifest: built.manifest,
      manifestSha256: built.existing.manifest_sha256, duplicate: true };
    const manifestSha256 = built.manifestSha256;
    db.prepare(`INSERT INTO public_content_releases
      (release_id,manifest_revision,status,manifest_json,manifest_sha256,created_at,effective_at,previous_revision)
      VALUES(?,?,?,?,?,?,?,?)`).run(built.manifest.releaseId, built.manifest.manifestRevision, 'validated', JSON.stringify(built.manifest),
      manifestSha256, now(), Date.parse(built.manifest.effectiveAt), built.manifest.previousRevision);
    audit('public_content.release.validate', built.manifest.releaseId);
    return { releaseId: built.manifest.releaseId, status: 'validated', manifest: built.manifest, manifestSha256, duplicate: false };
  }

  function publishRelease(token, input = {}) {
    requireAdmin(token);
    const releaseId = cleanText(input.releaseId, 160, '发布ID');
    const row = db.prepare('SELECT * FROM public_content_releases WHERE release_id=?').get(releaseId);
    if (!row) fail(404, '发布单尚未校验');
    const expected = cleanText(input.expectedManifestSha256, 64, '候选清单哈希');
    if (expected !== row.manifest_sha256) fail(409, '候选清单已经变化，请重新校验');
    if (row.status === 'active') return { releaseId, status: 'active', manifestRevision: row.manifest_revision, duplicate: true };
    if (row.status !== 'validated') fail(409, '发布单状态不允许生效');
    rejectRevokedCourses(JSON.parse(row.manifest_json).courses, '待发布清单');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE public_content_releases SET status='superseded' WHERE status='active'").run();
      db.prepare("UPDATE public_content_releases SET status='active',activated_at=? WHERE release_id=?").run(now(), releaseId);
      db.prepare("UPDATE public_content_state SET active_manifest_revision=?,updated_at=? WHERE channel='stable'")
        .run(row.manifest_revision, now());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    audit('public_content.release.publish', releaseId);
    return { releaseId, status: 'active', manifestRevision: row.manifest_revision, duplicate: false };
  }

  function activeManifest() {
    const row = db.prepare(`SELECT r.* FROM public_content_releases r JOIN public_content_state s
      ON s.active_manifest_revision=r.manifest_revision WHERE s.channel='stable' AND r.status='active'`).get();
    if (!row) fail(404, '尚无已生效公共课程清单');
    return { manifest: JSON.parse(row.manifest_json), etag: `"${row.manifest_revision}"`, sha256: row.manifest_sha256 };
  }

  function releaseByRevision(revision) {
    const row = db.prepare(`SELECT release_id AS releaseId,manifest_revision AS manifestRevision,status,
      manifest_sha256 AS manifestSha256,created_at AS createdAt,effective_at AS effectiveAt,
      activated_at AS activatedAt,previous_revision AS previousRevision FROM public_content_releases WHERE manifest_revision=?`).get(revision);
    if (!row) fail(404, '发布修订不存在');
    return row;
  }

  function asset(revision) {
    const row = db.prepare(`SELECT asset_revision_id AS assetRevisionId,asset_id AS assetId,sha256,
      byte_size AS bytes,mime_type AS mimeType,object_name AS objectName FROM public_content_assets WHERE asset_revision_id=?`).get(revision);
    if (!row) fail(404, '公共资源不存在');
    const filePath = path.join(objectDir, row.objectName);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size !== row.bytes) fail(500, '公共资源对象校验失败');
    return { ...row, filePath };
  }

  function signedRevocations() {
    const rows = db.prepare(`SELECT course_id AS courseId,withdrawn_at AS withdrawnAt,reason_code AS reasonCode,
      severity,replacement_course_id AS replacementCourseId FROM public_content_revocations ORDER BY withdrawn_at,course_id`).all()
      .map(row => ({ ...row, withdrawnAt: new Date(row.withdrawnAt).toISOString() }));
    const state = db.prepare("SELECT revocation_revision AS revision FROM public_content_state WHERE channel='stable'").get();
    if (!state?.revision) fail(404, '尚无紧急撤回增量');
    const payload = signObject({ contractId: CONTRACT_ID, schemaVersion: SCHEMA_VERSION,
      revocationRevision: state.revision, issuedAt: rows.at(-1).withdrawnAt, tombstones: rows }, privateKey, keyId);
    return { payload, etag: `"${state.revision}"` };
  }

  function rollbackRelease(token, input = {}) {
    requireAdmin(token);
    const releaseId = cleanText(input.releaseId, 160, '回滚发布ID');
    if (!validId(releaseId, 'release[:_-]?')) fail(400, '回滚发布ID无效');
    const duplicate = db.prepare('SELECT * FROM public_content_releases WHERE release_id=?').get(releaseId);
    if (duplicate) return { releaseId, status: duplicate.status, manifestRevision: duplicate.manifest_revision, duplicate: true };
    const targetRevision = cleanText(input.targetManifestRevision, 180, '目标清单修订');
    const target = db.prepare('SELECT * FROM public_content_releases WHERE manifest_revision=?').get(targetRevision);
    if (!target) fail(404, '回滚目标不存在');
    const expected = cleanText(input.expectedTargetManifestSha256, 64, '回滚目标哈希');
    if (expected !== target.manifest_sha256) fail(409, '回滚目标已经变化');
    const current = activeManifest().manifest;
    const source = JSON.parse(target.manifest_json);
    rejectRevokedCourses(source.courses, '回滚目标');
    const timestamp = now();
    const issuedAt = new Date(timestamp).toISOString();
    const manifestRevision = `manifest-rev-${sha256(`${releaseId}:${targetRevision}:${timestamp}`).slice(0, 32)}`;
    const manifest = signObject({ ...unsigned(source), releaseId, manifestRevision, issuedAt, effectiveAt: issuedAt,
      expiresAt: new Date(timestamp + 24 * 60 * 60 * 1000).toISOString(), previousRevision: current.manifestRevision }, privateKey, keyId);
    const manifestSha256 = sha256(canonicalize(manifest));
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE public_content_releases SET status='superseded' WHERE status='active'").run();
      db.prepare(`INSERT INTO public_content_releases
        (release_id,manifest_revision,status,manifest_json,manifest_sha256,created_at,effective_at,activated_at,previous_revision)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(releaseId, manifestRevision, 'active', JSON.stringify(manifest), manifestSha256,
        timestamp, timestamp, timestamp, current.manifestRevision);
      db.prepare("UPDATE public_content_state SET active_manifest_revision=?,updated_at=? WHERE channel='stable'")
        .run(manifestRevision, timestamp);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    audit('public_content.release.rollback', releaseId);
    return { releaseId, status: 'active', manifestRevision, rolledBackTo: targetRevision, duplicate: false };
  }

  function emergencyWithdraw(token, input = {}) {
    requireAdmin(token);
    const releaseId = cleanText(input.releaseId, 160, '撤回发布ID');
    const courseId = cleanText(input.courseId, 160, '课程ID');
    const prior = db.prepare('SELECT * FROM public_content_revocations WHERE release_id=?').get(releaseId);
    if (prior) return { releaseId, status: 'active', duplicate: true, revocationRevision: db.prepare("SELECT revocation_revision AS value FROM public_content_state WHERE channel='stable'").get().value };
    const active = activeManifest().manifest;
    if (!active.courses.some(course => course.courseId === courseId)) fail(404, '当前清单不包含待撤回课程');
    const withdrawnAt = now();
    const reasonCode = cleanText(input.reasonCode || 'content_risk', 80, '撤回原因');
    const severity = cleanText(input.severity || 'high', 40, '撤回等级');
    const replacementCourseId = cleanText(input.replacementCourseId || '', 160, '替代课程', false);
    const revocationId = `revoke-${sha256(`${releaseId}:${courseId}`).slice(0, 32)}`;
    const revocationRevision = `revocations-${sha256(`${releaseId}:${withdrawnAt}`).slice(0, 32)}`;
    const issuedAt = new Date(withdrawnAt).toISOString();
    const manifestRevision = `manifest-rev-${sha256(`${releaseId}:${courseId}:${withdrawnAt}`).slice(0, 32)}`;
    const manifest = signObject({ ...unsigned(active), manifestRevision, releaseId, issuedAt, effectiveAt: issuedAt,
      expiresAt: new Date(withdrawnAt + 24 * 60 * 60 * 1000).toISOString(), previousRevision: active.manifestRevision,
      courses: active.courses.filter(course => course.courseId !== courseId),
      tombstones: [...(active.tombstones || []), { courseId, withdrawnAt: issuedAt, reasonCode, severity, replacementCourseId }] }, privateKey, keyId);
    const manifestSha256 = sha256(canonicalize(manifest));
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO public_content_revocations
        (revocation_id,release_id,course_id,withdrawn_at,reason_code,severity,replacement_course_id,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(revocationId, releaseId, courseId, withdrawnAt, reasonCode, severity, replacementCourseId, now());
      db.prepare("UPDATE public_content_releases SET status='superseded' WHERE status='active'").run();
      db.prepare(`INSERT INTO public_content_releases
        (release_id,manifest_revision,status,manifest_json,manifest_sha256,created_at,effective_at,activated_at,previous_revision)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(releaseId, manifestRevision, 'active', JSON.stringify(manifest), manifestSha256,
        now(), withdrawnAt, now(), active.manifestRevision);
      db.prepare("UPDATE public_content_state SET active_manifest_revision=?,revocation_revision=?,updated_at=? WHERE channel='stable'")
        .run(manifestRevision, revocationRevision, now());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    audit('public_content.release.emergency_withdraw', courseId);
    return { releaseId, status: 'active', manifestRevision, revocationRevision, duplicate: false };
  }

  return { schemaStatus, recordDelivery, recordSyncReceipt, operations, putAsset, saveCourse, listAssets, listCourses, listReleases, validateRelease, publishRelease, rollbackRelease, emergencyWithdraw,
    activeManifest, releaseByRevision, asset, signedRevocations, verifySignedObject: value => verifySignedObject(value, publicKey),
    publicKey: publicKey ? publicKey.export({ type: 'spki', format: 'pem' }).toString() : '' };
}

module.exports = { createPublicContentService, canonicalize, sha256, signObject, verifySignedObject,
  normalizeCourse, CONTRACT_ID, SCHEMA_VERSION, SIGNATURE_ALGORITHM, ALLOWED_LOCALES };
