const path = require('node:path');
const { normalizeRelativePath } = require('./digest-batch.cjs');
const { parseAgentResultInput } = require('./agent-result-envelope.cjs');
const { classifyReceiptDisposition } = require('./material-status.cjs');

const DIGEST_RESULT_SCHEMA = 'edu-manager.digest-result.v1';

function canonicalPath(value) {
  try { return path.resolve(String(value || '')); } catch { return ''; }
}

function pathWithin(candidate, root) {
  const target = canonicalPath(candidate);
  const base = canonicalPath(root);
  if (!target || !base) return false;
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function receiptItems(receipt) {
  if (Array.isArray(receipt?.processed)) return receipt.processed;
  if (Array.isArray(receipt?.digestedFiles)) return receipt.digestedFiles;
  if (Array.isArray(receipt?.items)) return receipt.items;
  if (Array.isArray(receipt?.processedFiles)) return receipt.processedFiles;
  if (Array.isArray(receipt?.results)) return receipt.results;
  return [];
}

function normalizeReceiptItem(item, fallbackStatus = 'completed') {
  const entry = typeof item === 'string' ? { relativePath: item } : (item || {});
  return {
    materialId: String(entry.materialId || entry.id || entry.recordId || ''),
    relativePath: normalizeRelativePath(entry.relativePath || entry.path || entry.fileName || entry.filename),
    sha1: String(entry.sha1 || '').toLowerCase(),
    status: String(entry.status || fallbackStatus).toLowerCase(),
    disposition: classifyReceiptDisposition({ ...entry, status: entry.status || fallbackStatus }),
    artifacts: Array.isArray(entry.artifacts) ? entry.artifacts.map((artifact) => typeof artifact === 'string' ? artifact : artifact?.path).filter(Boolean) : [],
    message: String(entry.message || entry.notes || entry.reason || ''),
  };
}

function normalizeDigestResult(receipt, batch) {
  let envelope = null;
  let data = receipt && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt : {};
  try {
    envelope = parseAgentResultInput(receipt, {
      kind: 'digest',
      batchId: data.digestBatchId || data.batchId || batch?.batchId,
      retainRaw: typeof receipt === 'string',
    });
    data = envelope.payload && typeof envelope.payload === 'object' && !Array.isArray(envelope.payload) ? envelope.payload : data;
  } catch {
    // Strict digest validation below remains authoritative for malformed receipts.
  }
  const scope = batch?.scope || {};
  const processed = receiptItems(data).map((item) => normalizeReceiptItem(item));
  const failed = (Array.isArray(data.failed) ? data.failed : []).map((item) => normalizeReceiptItem(item, 'failed'));
  return {
    schema: String(data.schema || DIGEST_RESULT_SCHEMA),
    protocolVersion: String(data.protocolVersion || ''),
    taskId: String(data.taskId || ''),
    executionId: String(data.executionId || ''),
    digestBatchId: String(data.digestBatchId || data.batchId || ''),
    scope: {
      type: String(data.scope?.type || (data.studentId ? 'student' : data.projectId ? 'project' : scope.type || '')),
      id: String(data.scope?.id || data.studentId || data.projectId || scope.id || ''),
    },
    status: String(data.status || '').toLowerCase(),
    processed,
    failed,
    artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
    completedAt: String(data.completedAt || ''),
    message: String(data.message || ''),
    envelope: envelope ? {
      schema: envelope.schema,
      sourceFormat: envelope.sourceFormat,
      idempotencyKey: envelope.idempotencyKey,
      partial: envelope.partial,
      invalidItems: envelope.invalidItems,
      extensions: envelope.extensions,
    } : null,
  };
}

function validateDigestResult(options = {}) {
  const batch = options.batch;
  if (!batch?.batchId || !Array.isArray(batch.files) || !batch.files.length) {
    return { ok: false, code: 'batch_missing', message: '当前严格消化批次不存在或为空。', confirmed: [], remaining: [] };
  }
  const result = normalizeDigestResult(options.receipt, batch);
  if (!result.digestBatchId) return { ok: false, code: 'batch_id_missing', message: '回执缺少 digestBatchId。', result, confirmed: [], remaining: batch.files };
  if (result.digestBatchId !== String(batch.batchId)) return { ok: false, code: 'batch_id_mismatch', message: '回执不属于当前消化批次。', result, confirmed: [], remaining: batch.files };
  if (result.scope.type && result.scope.type !== String(batch.scope?.type || '')) return { ok: false, code: 'scope_type_mismatch', message: '回执资料范围类型与当前批次不一致。', result, confirmed: [], remaining: batch.files };
  if (result.scope.id && result.scope.id !== String(batch.scope?.id || '')) return { ok: false, code: 'scope_id_mismatch', message: '回执资料范围 ID 与当前批次不一致。', result, confirmed: [], remaining: batch.files };
  if (!['completed', 'partial'].includes(result.status)) return { ok: false, code: 'status_invalid', message: `回执状态必须为 completed 或 partial，实际为 ${result.status || '缺失'}。`, result, confirmed: [], remaining: batch.files };
  if (!result.processed.length && !result.failed.length) return { ok: false, code: 'result_items_empty', message: '回执没有逐文件处理结果。', result, confirmed: [], remaining: batch.files };

  const currentFiles = Array.isArray(options.currentFiles) ? options.currentFiles : batch.files;
  const batchByPath = new Map(batch.files.map((file) => [normalizeRelativePath(file.relativePath), file]));
  const currentByPath = new Map(currentFiles.map((file) => [normalizeRelativePath(file.relativePath), file]));
  const seen = new Set();
  const confirmed = [];
  const ignored = [];
  const invalid = [];
  const failed = [];
  const rejected = [];
  const allowedRoots = (Array.isArray(options.allowedArtifactRoots) ? options.allowedArtifactRoots : []).filter(Boolean);
  const validateItemIdentity = (item) => {
    const relativePath = normalizeRelativePath(item.relativePath);
    const expected = batchByPath.get(relativePath);
    const current = currentByPath.get(relativePath);
    let reason = '';
    if (!relativePath || !item.sha1) reason = '缺少 relativePath 或 sha1';
    else if (!expected || !current) reason = '不属于当前批次或原始文件已不存在';
    else if (String(expected.sha1).toLowerCase() !== item.sha1 || String(current.sha1).toLowerCase() !== item.sha1) reason = '文件内容已经变化或 SHA-1 不匹配';
    else if (options.requireMaterialId && (!item.materialId || item.materialId !== String(expected.materialId))) reason = 'materialId 缺失或不匹配';
    else if (item.materialId && item.materialId !== String(expected.materialId)) reason = 'materialId 不匹配';
    else if (seen.has(relativePath)) reason = '同一资料在回执中重复出现';
    else if (allowedRoots.length && item.artifacts.some((artifact) => !allowedRoots.some((root) => pathWithin(artifact, root)))) reason = '产物路径超出允许的知识目录';
    if (reason) {
      rejected.push({ ...item, reason });
      return null;
    }
    seen.add(relativePath);
    return { ...expected, ...current, artifacts: item.artifacts, receiptStatus: item.status, disposition: item.disposition, message: item.message };
  };
  for (const item of [...result.processed, ...result.failed]) {
    const matched = validateItemIdentity(item);
    if (!matched) continue;
    if (item.disposition === 'processed') confirmed.push(matched);
    else if (item.disposition === 'ignored') ignored.push(matched);
    else if (item.disposition === 'invalid') invalid.push(matched);
    else failed.push(matched);
  }
  const resolvedPaths = new Set([...confirmed, ...ignored, ...invalid].map((item) => normalizeRelativePath(item.relativePath)));
  const remaining = batch.files.filter((file) => !resolvedPaths.has(normalizeRelativePath(file.relativePath)));
  if (!confirmed.length && !ignored.length && !invalid.length) {
    return {
      ok: false,
      code: failed.length ? 'all_failed' : 'no_matching_files',
      message: failed.length ? `本次 ${failed.length} 项均未处理成功。` : '回执没有任何与当前批次严格匹配的资料。',
      result,
      confirmed,
      ignored,
      invalid,
      failed,
      remaining: batch.files,
      rejected,
    };
  }
  return {
    ok: true,
    code: remaining.length ? 'partial' : 'completed',
    message: remaining.length
      ? `已消化 ${confirmed.length} 项、忽略 ${ignored.length} 项、无效 ${invalid.length} 项，另有 ${remaining.length} 项未完成。`
      : `当前批次已结算：消化 ${confirmed.length} 项、忽略 ${ignored.length} 项、无效 ${invalid.length} 项。`,
    result,
    confirmed,
    ignored,
    invalid,
    failed,
    remaining,
    rejected,
    fullyCompleted: remaining.length === 0,
  };
}

module.exports = {
  DIGEST_RESULT_SCHEMA,
  normalizeDigestResult,
  pathWithin,
  receiptItems,
  validateDigestResult,
};
