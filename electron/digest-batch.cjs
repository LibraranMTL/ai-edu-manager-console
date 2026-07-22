const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DIGEST_BATCH_SCHEMA = 'edu-manager.digest-batch.v1';

function normalizeRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');
}

function stableMaterialId(scope, file) {
  const existing = String(file?.materialId || file?.id || file?.recordId || '').trim();
  if (existing) return existing;
  const seed = [scope?.type, scope?.id, normalizeRelativePath(file?.relativePath || file?.path), file?.sha1].join('|');
  return `material-${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 20)}`;
}

function normalizeDigestFile(scope, file) {
  const relativePath = normalizeRelativePath(file?.relativePath || file?.fileName || file?.filename || file?.path);
  return {
    materialId: stableMaterialId(scope, { ...file, relativePath }),
    relativePath,
    path: String(file?.path || file?.absolutePath || ''),
    sha1: String(file?.sha1 || '').toLowerCase(),
    size: Math.max(0, Number(file?.size || 0)),
  };
}

function digestIdempotencyKey(scope, files) {
  const normalized = (Array.isArray(files) ? files : [])
    .map((file) => normalizeDigestFile(scope, file))
    .sort((a, b) => `${a.relativePath}|${a.sha1}`.localeCompare(`${b.relativePath}|${b.sha1}`));
  const seed = `${scope?.type || ''}|${scope?.id || ''}|${normalized.map((file) => `${file.materialId}|${file.relativePath}|${file.sha1}`).join('\n')}`;
  return `digest:${scope?.type || 'scope'}:${scope?.id || 'unknown'}:${crypto.createHash('sha1').update(seed).digest('hex')}`;
}

function buildDigestBatch(options = {}) {
  const scope = {
    type: String(options.scope?.type || ''),
    id: String(options.scope?.id || ''),
    name: String(options.scope?.name || ''),
  };
  if (!['student', 'project'].includes(scope.type) || !scope.id) throw new Error('消化批次缺少有效 scope。');
  const files = (Array.isArray(options.files) ? options.files : []).map((file) => normalizeDigestFile(scope, file));
  if (!files.length) throw new Error('不能建立空消化批次。');
  const invalid = files.find((file) => !file.materialId || !file.relativePath || !/^[a-f0-9]{40}$/i.test(file.sha1));
  if (invalid) throw new Error(`消化资料缺少稳定 ID、相对路径或 SHA-1：${invalid.relativePath || invalid.materialId || 'unknown'}`);
  const duplicate = files.find((file, index) => files.findIndex((candidate) => candidate.materialId === file.materialId || candidate.relativePath === file.relativePath) !== index);
  if (duplicate) throw new Error(`消化批次包含重复资料：${duplicate.relativePath}`);
  const createdAt = String(options.createdAt || new Date().toISOString());
  const batchId = String(options.batchId || `digest-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
  return {
    schema: DIGEST_BATCH_SCHEMA,
    version: 1,
    batchId,
    scope,
    createdAt,
    submittedAt: String(options.submittedAt || ''),
    files,
    output: {
      knowledgeRoot: String(options.output?.knowledgeRoot || ''),
      receiptPath: String(options.output?.receiptPath || ''),
      requiredArtifacts: Array.isArray(options.output?.requiredArtifacts) ? options.output.requiredArtifacts.map(String).filter(Boolean) : [],
    },
    status: String(options.status || 'prepared'),
    idempotencyKey: String(options.idempotencyKey || digestIdempotencyKey(scope, files)),
    history: Array.isArray(options.history) ? options.history : [],
  };
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, file);
  return value;
}

function readDigestBatch(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (parsed?.schema !== DIGEST_BATCH_SCHEMA || !parsed?.batchId || !Array.isArray(parsed?.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

module.exports = {
  DIGEST_BATCH_SCHEMA,
  buildDigestBatch,
  digestIdempotencyKey,
  normalizeDigestFile,
  normalizeRelativePath,
  readDigestBatch,
  stableMaterialId,
  writeJsonAtomic,
};
