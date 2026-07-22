const crypto = require('crypto');

const KNOWLEDGE_ENGINE_CONTRACT_VERSION = 'edu-manager.knowledge-engine.v1';

const REQUIRED_METHODS = Object.freeze([
  'health',
  'importAsset',
  'upsertClaim',
  'getClaim',
  'search',
  'appendEvent',
  'upsertRelationship',
  'exportSnapshot',
]);

const CLAIM_STATUSES = new Set(['candidate', 'confirmed', 'rejected', 'superseded']);

class KnowledgeEngineContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'KnowledgeEngineContractError';
    this.code = code;
    this.details = details;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function assertPortableId(value, fieldName = 'id') {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
    throw new KnowledgeEngineContractError(
      'INVALID_ID',
      `${fieldName} 必须是 1-128 位稳定 ID，只能包含字母、数字、点、下划线、冒号和连字符。`,
      { fieldName, value },
    );
  }
  return id;
}

function normalizeEvidence(evidence, index) {
  if (!evidence || typeof evidence !== 'object') {
    throw new KnowledgeEngineContractError('INVALID_EVIDENCE', `evidence[${index}] 必须是对象。`);
  }
  const id = assertPortableId(evidence.id, `evidence[${index}].id`);
  const sourceUri = String(evidence.sourceUri || '').trim();
  if (!sourceUri) {
    throw new KnowledgeEngineContractError('MISSING_SOURCE', `evidence[${index}].sourceUri 不能为空。`);
  }
  return {
    ...evidence,
    id,
    sourceUri,
    excerpt: String(evidence.excerpt || ''),
    observedAt: String(evidence.observedAt || ''),
  };
}

function normalizeClaim(input = {}) {
  const id = assertPortableId(input.id, 'claim.id');
  const subjectId = assertPortableId(input.subjectId, 'claim.subjectId');
  const predicate = String(input.predicate || '').trim();
  if (!predicate) throw new KnowledgeEngineContractError('MISSING_PREDICATE', 'claim.predicate 不能为空。');
  if (typeof input.value === 'undefined') throw new KnowledgeEngineContractError('MISSING_VALUE', 'claim.value 不能为空。');
  const status = String(input.status || 'candidate');
  if (!CLAIM_STATUSES.has(status)) {
    throw new KnowledgeEngineContractError('INVALID_STATUS', `不支持的 Claim 状态：${status}。`, { status });
  }
  const evidence = Array.isArray(input.evidence) ? input.evidence.map(normalizeEvidence) : [];
  if (status === 'confirmed' && evidence.length === 0) {
    throw new KnowledgeEngineContractError('CONFIRMED_WITHOUT_EVIDENCE', '已确认 Claim 必须至少包含一条 Evidence。');
  }
  const now = new Date().toISOString();
  return {
    schema: 'edu-manager.claim.v1',
    ...input,
    id,
    subjectId,
    predicate,
    value: input.value,
    status,
    evidence,
    confidence: String(input.confidence || 'unknown'),
    createdAt: String(input.createdAt || now),
    updatedAt: String(input.updatedAt || now),
  };
}

function assertKnowledgeEngine(engine) {
  if (!engine || typeof engine !== 'object') {
    throw new KnowledgeEngineContractError('INVALID_ENGINE', 'KnowledgeEngine 必须是对象。');
  }
  if (engine.contractVersion !== KNOWLEDGE_ENGINE_CONTRACT_VERSION) {
    throw new KnowledgeEngineContractError(
      'CONTRACT_VERSION_MISMATCH',
      `KnowledgeEngine 合同版本不兼容：${engine.contractVersion || 'missing'}。`,
      { expected: KNOWLEDGE_ENGINE_CONTRACT_VERSION, actual: engine.contractVersion || '' },
    );
  }
  assertPortableId(engine.engineId, 'engine.engineId');
  if (!String(engine.engineVersion || '').trim()) {
    throw new KnowledgeEngineContractError('MISSING_ENGINE_VERSION', 'engine.engineVersion 不能为空。');
  }
  const missing = REQUIRED_METHODS.filter((name) => typeof engine[name] !== 'function');
  if (missing.length) {
    throw new KnowledgeEngineContractError('MISSING_METHODS', `KnowledgeEngine 缺少方法：${missing.join('、')}。`, { missing });
  }
  return engine;
}

module.exports = {
  CLAIM_STATUSES,
  KNOWLEDGE_ENGINE_CONTRACT_VERSION,
  KnowledgeEngineContractError,
  REQUIRED_METHODS,
  assertKnowledgeEngine,
  assertPortableId,
  contentHash,
  normalizeClaim,
  stableJson,
};
