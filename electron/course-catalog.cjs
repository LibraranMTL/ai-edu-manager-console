const crypto = require('crypto');

const COURSE_CATALOG_SCHEMA_VERSION = 1;
const COURSE_POLICY_SCHEMA_VERSION = 1;
const COURSE_CAPTURE_SCHEMA = 'edu-manager.course-capture.v1';
const COURSE_ALLOWED_TYPES = new Set(['platform_standard', 'tenant_custom']);
const COURSE_ALLOWED_STATUS = new Set(['active', 'withdrawn']);
const HTTP_ONLY_COURSE_HOSTS = new Set(['jinbangxueba.com', 'www.jinbangxueba.com']);

function text(value, max = 4000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function unsignedCatalogPayload(input = {}) {
  const { checksum: _checksum, signature: _signature, ...payload } = input || {};
  return payload;
}

function catalogChecksum(input = {}) {
  return crypto.createHash('sha256').update(canonicalize(unsignedCatalogPayload(input))).digest('hex');
}

function catalogSignaturePayload(input = {}) {
  const payload = canonicalize(unsignedCatalogPayload(input));
  return `${catalogChecksum(input)}\n${payload}`;
}

function compareVersions(left, right) {
  const normalize = (value) => text(value, 80).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const a = normalize(left);
  const b = normalize(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

function normalizeAllowedHost(value) {
  const host = text(value, 253).toLowerCase().replace(/\.$/, '');
  if (!host || host.includes('/') || host.includes(':') || !/^[a-z0-9.-]+$/.test(host)) {
    throw new Error(`无效课程域名：${value}`);
  }
  return host;
}

function normalizeCourseUrl(value, allowedHosts = []) {
  let parsed;
  try {
    parsed = new URL(text(value, 2048));
  } catch {
    throw new Error('课程链接不是有效 URL。');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('课程链接必须使用 HTTP 或 HTTPS。');
  if (parsed.username || parsed.password) throw new Error('课程链接不能包含用户名或密码。');
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  if (HTTP_ONLY_COURSE_HOSTS.has(parsed.hostname)) parsed.protocol = 'http:';
  const normalizedHosts = allowedHosts.map(normalizeAllowedHost);
  if (!normalizedHosts.includes(parsed.hostname)) throw new Error(`课程链接域名 ${parsed.hostname} 不在允许列表。`);
  return parsed.toString();
}

function safeCourseNavigation(value, allowedHosts = []) {
  try {
    return { ok: true, url: normalizeCourseUrl(value, allowedHosts) };
  } catch (error) {
    return { ok: false, code: 'COURSE_NAVIGATION_BLOCKED', message: error.message };
  }
}

function normalizeCourseItem(input = {}) {
  const courseId = text(input.courseId, 160);
  if (!/^(platform|tenant):[a-z0-9][a-z0-9-]{2,120}$/.test(courseId)) throw new Error(`无效 courseId：${courseId || '空'}`);
  const type = text(input.type, 40);
  if (!COURSE_ALLOWED_TYPES.has(type)) throw new Error(`不支持的课程类型：${type}`);
  const declaredHosts = [...new Set((Array.isArray(input.allowedHosts) ? input.allowedHosts : []).map(normalizeAllowedHost))];
  const allowedHosts = type === 'tenant_custom'
    ? [...new Set(declaredHosts.flatMap(relatedCourseHosts))]
    : declaredHosts;
  if (!allowedHosts.length) throw new Error('课程必须声明至少一个允许域名。');
  if (type === 'platform_standard' && !courseId.startsWith('platform:')) throw new Error('平台课程 courseId 必须以 platform: 开头。');
  if (type === 'tenant_custom' && !courseId.startsWith('tenant:')) throw new Error('机构课程 courseId 必须以 tenant: 开头。');
  const status = text(input.status || 'active', 40);
  if (!COURSE_ALLOWED_STATUS.has(status)) throw new Error(`不支持的课程状态：${status}`);
  const item = {
    courseId,
    type,
    name: text(input.name, 120),
    provider: text(input.provider, 120),
    url: normalizeCourseUrl(input.url, allowedHosts),
    allowedHosts,
    coverAsset: text(input.coverAsset, 240),
    summary: text(input.summary, 1200),
    subjects: [...new Set((Array.isArray(input.subjects) ? input.subjects : []).map((item) => text(item, 80)).filter(Boolean))],
    gradeRange: [...new Set((Array.isArray(input.gradeRange) ? input.gradeRange : []).map((item) => text(item, 40)).filter(Boolean))],
    languages: [...new Set((Array.isArray(input.languages) ? input.languages : []).map((item) => text(item, 20)).filter(Boolean))],
    accountRequirement: text(input.accountRequirement, 240),
    effectiveAt: text(input.effectiveAt, 80),
    expiresAt: input.expiresAt ? text(input.expiresAt, 80) : null,
    legalNotice: text(input.legalNotice, 1600),
    status,
  };
  if (!item.name || !item.provider || !item.summary || !item.coverAsset || !item.legalNotice) {
    throw new Error(`课程 ${courseId} 缺少名称、提供方、简介、封面或法律声明。`);
  }
  if (!item.effectiveAt || Number.isNaN(Date.parse(item.effectiveAt))) throw new Error(`课程 ${courseId} 生效时间无效。`);
  if (item.expiresAt && Number.isNaN(Date.parse(item.expiresAt))) throw new Error(`课程 ${courseId} 到期时间无效。`);
  return item;
}

function validateCatalogPackage(input = {}, options = {}) {
  try {
    if (Number(input.schemaVersion) !== COURSE_CATALOG_SCHEMA_VERSION) throw new Error('课程目录 Schema 版本不受支持。');
    if (!text(input.catalogVersion, 80)) throw new Error('课程目录缺少 catalogVersion。');
    if (!input.issuedAt || Number.isNaN(Date.parse(input.issuedAt))) throw new Error('课程目录 issuedAt 无效。');
    if (compareVersions(options.hostVersion || '0.0.0', input.minHostVersion || '0.0.0') < 0) {
      throw new Error(`当前主机版本低于目录要求的 ${input.minHostVersion}。`);
    }
    const expectedChecksum = catalogChecksum(input);
    if (!/^[a-f0-9]{64}$/.test(text(input.checksum, 64)) || !crypto.timingSafeEqual(Buffer.from(expectedChecksum), Buffer.from(input.checksum))) {
      throw new Error('课程目录校验值不匹配。');
    }
    if (options.requireSignature === true) {
      const publicKey = text(options.publicKey || '', 20_000);
      if (!publicKey) throw new Error('缺少课程目录签名公钥。');
      const signature = Buffer.from(text(input.signature, 10_000), 'base64');
      if (!signature.length || !crypto.verify('RSA-SHA256', Buffer.from(catalogSignaturePayload(input)), publicKey, signature)) {
        throw new Error('课程目录签名验证失败。');
      }
    }
    const courses = (Array.isArray(input.courses) ? input.courses : []).map(normalizeCourseItem);
    const ids = new Set();
    for (const course of courses) {
      if (ids.has(course.courseId)) throw new Error(`课程 ID 重复：${course.courseId}`);
      ids.add(course.courseId);
    }
    return {
      ok: true,
      catalog: {
        schemaVersion: COURSE_CATALOG_SCHEMA_VERSION,
        catalogVersion: text(input.catalogVersion, 80),
        issuedAt: new Date(input.issuedAt).toISOString(),
        minHostVersion: text(input.minHostVersion || '0.0.0', 80),
        keyId: text(input.keyId || '', 120),
        checksum: text(input.checksum, 64),
        signature: text(input.signature, 10_000),
        courses,
      },
    };
  } catch (error) {
    return { ok: false, code: 'COURSE_CATALOG_REJECTED', message: error.message };
  }
}

function relatedCourseHosts(hostInput) {
  const host = normalizeAllowedHost(hostInput);
  const related = new Set([host]);
  if (host.startsWith('www.')) related.add(host.slice(4));
  else related.add(`www.${host}`);
  return [...related];
}

function normalizeInstitutionPolicy(input = {}, catalog = { courses: [] }) {
  const knownIds = new Set((catalog.courses || []).map((course) => course.courseId));
  const courseRules = {};
  for (const [courseId, rawRule] of Object.entries(input.courseRules || {})) {
    if (!knownIds.has(courseId)) continue;
    const rule = rawRule && typeof rawRule === 'object' ? rawRule : {};
    courseRules[courseId] = {
      enabled: rule.enabled !== false,
      order: Number.isFinite(Number(rule.order)) ? Math.max(0, Math.floor(Number(rule.order))) : null,
      gradeRange: [...new Set((Array.isArray(rule.gradeRange) ? rule.gradeRange : []).map((item) => text(item, 40)).filter(Boolean))],
      studentIds: [...new Set((Array.isArray(rule.studentIds) ? rule.studentIds : []).map((item) => text(item, 160)).filter(Boolean))],
    };
  }
  return {
    schemaVersion: COURSE_POLICY_SCHEMA_VERSION,
    policyVersion: text(input.policyVersion || new Date().toISOString(), 80),
    showTenantCustom: input.showTenantCustom !== false,
    courseRules,
    updatedAt: text(input.updatedAt || new Date().toISOString(), 80),
  };
}

function effectiveCourses(catalog = { courses: [] }, policyInput = {}, student = {}, now = new Date()) {
  const policy = normalizeInstitutionPolicy(policyInput, catalog);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const studentId = text(student.id, 160);
  const grade = text(student.grade, 40).toLowerCase();
  return (catalog.courses || [])
    .filter((course) => {
      if (course.status !== 'active') return false;
      if (Date.parse(course.effectiveAt) > nowMs) return false;
      if (course.expiresAt && Date.parse(course.expiresAt) <= nowMs) return false;
      if (course.type === 'tenant_custom' && !policy.showTenantCustom) return false;
      const rule = policy.courseRules[course.courseId];
      if (rule?.enabled === false) return false;
      if (rule?.studentIds?.length && !rule.studentIds.includes(studentId)) return false;
      if (rule?.gradeRange?.length && !rule.gradeRange.map((item) => item.toLowerCase()).includes(grade)) return false;
      return true;
    })
    .map((course, index) => ({ ...course, order: policy.courseRules[course.courseId]?.order ?? index }))
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, 'zh-CN'));
}

function applyCatalogCandidate(candidate, state = {}, options = {}) {
  const checked = validateCatalogPackage(candidate, options);
  if (!checked.ok) {
    return {
      ok: false,
      rolledBack: Boolean(state.lastGood),
      code: checked.code,
      message: checked.message,
      catalog: state.lastGood || null,
    };
  }
  if (state.lastGood && compareVersions(checked.catalog.catalogVersion, state.lastGood.catalogVersion) < 0 && !options.allowRollback) {
    return {
      ok: false,
      rolledBack: true,
      code: 'COURSE_CATALOG_DOWNGRADE_BLOCKED',
      message: '较旧课程目录不能覆盖最后可用版本；如需回滚必须明确执行回滚操作。',
      catalog: state.lastGood,
    };
  }
  return { ok: true, rolledBack: false, catalog: checked.catalog, lastGood: checked.catalog };
}

function courseCaptureFingerprint(input = {}) {
  const fields = [
    text(input.studentId, 160),
    text(input.courseId, 160),
    text(input.provider, 160),
    text(input.url, 2048),
    text(input.targetType, 40),
    text(input.targetId, 160),
    text(input.captureSessionId, 200),
    text(input.fileHash || input.filePath, 500),
  ];
  return crypto.createHash('sha256').update(fields.join('\n')).digest('hex');
}

function normalizeCourseCapture(input = {}) {
  const record = {
    schema: COURSE_CAPTURE_SCHEMA,
    studentId: text(input.studentId, 160),
    courseId: text(input.courseId, 160),
    provider: text(input.provider, 160),
    url: text(input.url, 2048),
    targetType: text(input.targetType, 40),
    targetId: text(input.targetId, 160),
    captureSessionId: text(input.captureSessionId, 200),
    startedAt: text(input.startedAt, 80),
    completedAt: text(input.completedAt, 80),
    submittedAt: text(input.submittedAt || new Date().toISOString(), 80),
    filePath: text(input.filePath, 1000),
    fileHash: text(input.fileHash, 128),
  };
  if (!record.studentId || !record.courseId || !record.provider || !record.url || !record.captureSessionId) {
    throw new Error('课程采集记录缺少学生、课程、提供方、URL 或采集会话。');
  }
  record.idempotencyKey = courseCaptureFingerprint(record);
  return record;
}

function mergeCourseCaptureRecords(records = [], incoming = []) {
  const merged = [];
  const seen = new Set();
  for (const raw of [...records, ...incoming]) {
    const item = normalizeCourseCapture(raw);
    if (seen.has(item.idempotencyKey)) continue;
    seen.add(item.idempotencyKey);
    merged.push(item);
  }
  return merged;
}

module.exports = {
  COURSE_ALLOWED_STATUS,
  COURSE_ALLOWED_TYPES,
  COURSE_CAPTURE_SCHEMA,
  COURSE_CATALOG_SCHEMA_VERSION,
  COURSE_POLICY_SCHEMA_VERSION,
  HTTP_ONLY_COURSE_HOSTS,
  applyCatalogCandidate,
  canonicalize,
  catalogChecksum,
  catalogSignaturePayload,
  compareVersions,
  courseCaptureFingerprint,
  effectiveCourses,
  mergeCourseCaptureRecords,
  normalizeAllowedHost,
  normalizeCourseCapture,
  normalizeCourseItem,
  normalizeCourseUrl,
  normalizeInstitutionPolicy,
  relatedCourseHosts,
  safeCourseNavigation,
  unsignedCatalogPayload,
  validateCatalogPackage,
};
