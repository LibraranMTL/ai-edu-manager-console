const crypto = require('node:crypto');

const MATERIAL_SCHEMA = 'edu-manager.project-materials.v1';
const MATERIAL_PROTOCOL = 'edu-manager.project-material-api.v1';
const ADOPTION_STATES = Object.freeze(['candidate', 'accepted', 'excluded']);
const PROCESSING_STATES = Object.freeze([
  'pending', 'running', 'completed',
  'skipped_unsupported', 'failed_retryable', 'failed_terminal',
  'execution_unknown', 'needs_user_action',
  // One-cycle compatibility for registries written by older candidates.
  'failed', 'unsupported',
]);
const MATERIAL_LOCATIONS = Object.freeze(['workspace', 'legacy_raw', 'external']);
const MATERIAL_CAPABILITIES = Object.freeze([
  'upload', 'read', 'export', 'suggestClassification', 'classify', 'adopt',
  'readKnowledge', 'readEvidence', 'confirmEvidence', 'manageTasks',
]);

class MaterialError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MaterialError';
    this.code = code;
    this.details = details;
  }
}

function invariant(condition, code, message, details) {
  if (!condition) throw new MaterialError(code, message, details);
}

function identifier(value, label = 'ID') {
  invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= 256
    && !/[\x00-\x1f\x7f]/.test(value), 'invalid_identity', `${label}无效。`);
  return value;
}

// The transport never accepts absolute paths, drive-relative paths, ADS or
// Windows aliases. Use this on every platform so imported manifests stay safe.
function relativeMaterialPath(value) {
  invariant(typeof value === 'string' && value.length > 0 && value.length <= 2048,
    'invalid_path', '资料路径无效。');
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/');
  invariant(parts.every((part) => part && part !== '.' && part !== '..'
    && !/[<>:"|?*\x00-\x1f\x7f]/.test(part) && !/[. ]$/.test(part)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)),
  'invalid_path', '资料路径必须是安全的相对路径。');
  return parts.join('/');
}

function positiveVersion(value) {
  invariant(Number.isSafeInteger(value) && value > 0, 'invalid_version', '资料版本无效。');
  return value;
}

function sha256(value) {
  invariant(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'invalid_hash', '资料校验值无效。');
  return value;
}

function newMaterialId() { return `material-${crypto.randomUUID()}`; }

function sourceVersionKey(projectId, materialId, version) {
  return JSON.stringify([identifier(projectId, '项目ID'), identifier(materialId, '资料ID'), positiveVersion(version)]);
}

function requestIdentity({ authorityId, principalId, projectId, clientRequestId }) {
  return crypto.createHash('sha256').update(JSON.stringify([
    identifier(authorityId, '主机ID'), identifier(principalId, '用户ID'),
    identifier(projectId, '项目ID'), identifier(clientRequestId, '请求ID'),
  ])).digest('hex');
}

function digestIdentity({ projectId, materialId, version, ruleVersion, taskKind = 'digest' }) {
  return crypto.createHash('sha256').update(JSON.stringify([
    identifier(projectId), identifier(materialId), positiveVersion(version),
    identifier(ruleVersion, '规则版本'), identifier(taskKind, '任务类型'),
  ])).digest('hex');
}

function validateMaterial(record, projectId) {
  invariant(record && typeof record === 'object' && !Array.isArray(record), 'invalid_material', '资料记录无效。');
  identifier(record.materialId, '资料ID');
  invariant(record.projectId === identifier(projectId, '项目ID'), 'scope_mismatch', '资料不属于当前项目。');
  positiveVersion(record.version);
  sha256(record.sha256);
  invariant(Number.isSafeInteger(record.size) && record.size >= 0, 'invalid_size', '资料大小无效。');
  invariant(MATERIAL_LOCATIONS.includes(record.location?.kind), 'invalid_location', '资料位置类型无效。');
  invariant(record.availability === undefined || ['available', 'missing', 'unavailable'].includes(record.availability),
    'invalid_availability', '资料可用状态无效。');
  identifier(record.location.rootId, '资料根ID');
  relativeMaterialPath(record.location.relativePath);
  invariant(ADOPTION_STATES.includes(record.adoption?.state), 'invalid_adoption', '资料采用状态无效。');
  invariant(PROCESSING_STATES.includes(record.processing?.state), 'invalid_processing', '资料处理状态无效。');
  if (record.processing.state === 'completed') {
    invariant(record.processing.processedVersion === record.version,
      'stale_processing', '旧版本处理结果不能结算新版本。');
  }
  if (record.classification?.categoryId) identifier(record.classification.categoryId, '分类ID');
  return record;
}

function requireCapability(grant, projectId, capability, { writable = false } = {}) {
  invariant(MATERIAL_CAPABILITIES.includes(capability), 'unknown_capability', '未知资料操作。');
  invariant(grant?.projectId === projectId && grant?.capabilities?.[capability] === true,
    'forbidden', '无权执行此项目资料操作。');
  invariant(!writable || grant.writable === true, 'project_readonly', '当前项目不可写。');
}

function adoptionForImport({ intent = 'active', inManagedScope = false, autoAdopt = false } = {}) {
  if (intent === 'later') return 'candidate';
  if (intent === 'active' || intent === 'core') return 'accepted';
  if (intent === 'discovered' || intent === 'capture') return inManagedScope && autoAdopt ? 'accepted' : 'candidate';
  throw new MaterialError('invalid_intent', '未知资料导入意图。');
}

module.exports = {
  MATERIAL_SCHEMA, MATERIAL_PROTOCOL, ADOPTION_STATES, PROCESSING_STATES, MATERIAL_LOCATIONS,
  MATERIAL_CAPABILITIES, MaterialError, invariant, identifier, relativeMaterialPath,
  positiveVersion, sha256, newMaterialId, sourceVersionKey, requestIdentity, digestIdentity,
  validateMaterial, requireCapability, adoptionForImport,
};
