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
  if (Array.isArray(receipt?.digestFiles)) return receipt.digestFiles;
  if (Array.isArray(receipt?.items)) return receipt.items;
  if (Array.isArray(receipt?.processedFiles)) return receipt.processedFiles;
  if (Array.isArray(receipt?.completedFiles)) return receipt.completedFiles;
  if (Array.isArray(receipt?.successfulFiles)) return receipt.successfulFiles;
  if (Array.isArray(receipt?.files)) return receipt.files;
  if (Array.isArray(receipt?.results)) return receipt.results;
  return [];
}

function normalizeReceiptItem(item, fallbackStatus = 'completed') {
  const entry = typeof item === 'string' ? { relativePath: item } : (item || {});
  const status = String(entry.status || entry.state || entry.result || entry.outcome || fallbackStatus).toLowerCase();
  return {
    materialId: String(entry.materialId || entry.id || entry.recordId || entry.material_id || entry['资料ID'] || ''),
    relativePath: normalizeRelativePath(entry.relativePath || entry.path || entry.filePath || entry.fileName || entry.filename || entry.name || entry.title || entry['相对路径'] || entry['路径'] || entry['文件'] || entry['文件名']),
    sha1: String(entry.sha1 || entry.sha || entry.hash || entry.checksum || entry.fileHash || entry.sourceSha1 || entry['哈希'] || '').toLowerCase(),
    status,
    disposition: classifyReceiptDisposition({ ...entry, status }),
    artifacts: (Array.isArray(entry.artifacts) ? entry.artifacts
      : Array.isArray(entry.outputs) ? entry.outputs
        : Array.isArray(entry.updatedFiles) ? entry.updatedFiles
          : []).map((artifact) => typeof artifact === 'string' ? artifact : artifact?.path).filter(Boolean),
    message: String(entry.message || entry.notes || entry.reason || entry.summary || entry.content || ''),
  };
}

function normalizeResultStatus(value, hasItems = false, message = '') {
  const status = String(value || '').trim().toLowerCase();
  if (['completed', 'complete', 'success', 'succeeded', 'processed', 'digested', 'done', 'finished', 'ok', '已完成', '完成', '成功'].includes(status)) return 'completed';
  if (['partial', 'partially_completed', 'incomplete', '部分完成'].includes(status)) return 'partial';
  if (['failed', 'error', '失败'].includes(status)) return 'failed';
  if (/(消化完成|处理完成|已完成|完成消化|全部完成|success|succeeded|completed|finished)/i.test(String(message || ''))) return 'completed';
  return hasItems ? 'partial' : status;
}

function digestPayloadScore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return -1;
  let score = 0;
  if (String(value.schema || '') === DIGEST_RESULT_SCHEMA) score += 100;
  if (value.digestBatchId || value.batchId || value.batch_id || value.taskBatchId) score += 15;
  if (value.studentId || value.projectId || value.scope?.id) score += 10;
  if (['processed', 'digestedFiles', 'digestFiles', 'items', 'processedFiles', 'completedFiles', 'successfulFiles', 'files', 'results', 'failed', 'failures', 'errors']
    .some((key) => Array.isArray(value[key]))) score += 40;
  if (value.status || value.digestStatus || value.state || value.resultStatus || value.outcome) score += 5;
  return score;
}

function selectDigestPayload(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 4 || seen.has(value)) return value;
  seen.add(value);
  let best = value;
  let bestScore = digestPayloadScore(value);
  for (const key of ['digestResult', 'structuredOutput', 'data', 'payload', 'result', 'response']) {
    const nested = value[key];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const candidate = selectDigestPayload(nested, depth + 1, seen);
    const score = digestPayloadScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function collectReceiptText(value, depth = 0, seen = new Set(), output = []) {
  if (value === null || value === undefined || depth > 5 || output.join('').length > 12000) return output;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    output.push(String(value));
    return output;
  }
  if (typeof value !== 'object' || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectReceiptText(item, depth + 1, seen, output);
    return output;
  }
  for (const [key, item] of Object.entries(value)) {
    output.push(String(key));
    collectReceiptText(item, depth + 1, seen, output);
  }
  return output;
}

function explicitBatchFailure(data, processed, failed) {
  const identifiableProcessed = processed.filter((item) => item.materialId || item.relativePath || item.sha1);
  if (identifiableProcessed.length) return null;
  const status = String(data?.status || data?.digestStatus || data?.state || data?.resultStatus || data?.outcome || '').trim().toLowerCase();
  const parts = collectReceiptText(data).map((item) => item.trim()).filter(Boolean);
  const text = parts.join('；');
  const explicitStatus = ['failed', 'error', '失败'].includes(status);
  const failureSignal = /(本批[^；]{0,20}未完成|整批[^；]{0,20}失败|工具[^；]{0,20}初始化失败|无法读取[^；]{0,40}(?:批次|AGENT\.md)|无法写入[^；]{0,30}(?:回执|结果)|(?:已处理文件|处理文件)[^；]{0,12}(?:0\s*个|为?\s*0)|(?:0\s*个|零个)[^；]{0,30}(?:已处理|处理成功)|均未修改|需[^；]{0,30}重试|initiali[sz]ation failed|processed\s*(?:files?)?\s*[:=]\s*0)/i.test(text);
  if (!explicitStatus && !failureSignal) return null;
  const detail = parts.find((item) => /(初始化失败|未完成|无法读取|无法写入|0\s*个|未修改|重试|failed|error)/i.test(item)) || 'Agent 明确报告本批资料未完成。';
  return {
    code: 'batch_execution_failed',
    message: `Agent 未处理本批资料：${detail}`,
    failedCount: failed.length,
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
  data = selectDigestPayload(data);
  const scope = batch?.scope || {};
  const processed = receiptItems(data).map((item) => normalizeReceiptItem(item));
  const failedItems = Array.isArray(data.failed) ? data.failed
    : Array.isArray(data.failures) ? data.failures
      : Array.isArray(data.errors) ? data.errors
        : [];
  const failed = failedItems.map((item) => normalizeReceiptItem(item, 'failed'));
  const message = String(data.message || data.summary || data.detail || data.content || '');
  const executionFailure = explicitBatchFailure(data, processed, failed);
  return {
    schema: String(data.schema || DIGEST_RESULT_SCHEMA),
    protocolVersion: String(data.protocolVersion || ''),
    taskId: String(data.taskId || ''),
    executionId: String(data.executionId || ''),
    digestBatchId: String(data.digestBatchId || data.batchId || data.batch_id || data.taskBatchId || ''),
    scope: {
      type: String(data.scope?.type || (data.studentId ? 'student' : data.projectId ? 'project' : scope.type || '')),
      id: String(data.scope?.id || data.studentId || data.projectId || scope.id || ''),
    },
    status: executionFailure ? 'failed' : normalizeResultStatus(data.status || data.digestStatus || data.state || data.resultStatus || data.outcome, processed.length > 0 || failed.length > 0, message),
    processed,
    failed,
    artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
    completedAt: String(data.completedAt || ''),
    message: executionFailure?.message || message,
    executionFailure,
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

  if (result.executionFailure) {
    return {
      ok: false,
      code: result.executionFailure.code,
      message: result.executionFailure.message,
      result,
      confirmed: [],
      ignored: [],
      invalid: [],
      failed: [],
      remaining: batch.files,
      rejected: [],
      retryable: true,
    };
  }

  const currentFiles = Array.isArray(options.currentFiles) ? options.currentFiles : batch.files;
  const normalizedKey = (value) => normalizeRelativePath(value).toLowerCase();
  const batchByPath = new Map(batch.files.map((file) => [normalizedKey(file.relativePath), file]));
  const currentByPath = new Map(currentFiles.map((file) => [normalizedKey(file.relativePath), file]));
  const batchById = new Map(batch.files.filter((file) => file.materialId).map((file) => [String(file.materialId), file]));
  const batchBySha1 = new Map();
  const batchByBasename = new Map();
  for (const file of batch.files) {
    const sha1 = String(file.sha1 || '').toLowerCase();
    if (sha1) {
      const values = batchBySha1.get(sha1) || [];
      values.push(file);
      batchBySha1.set(sha1, values);
    }
    const basename = path.basename(normalizeRelativePath(file.relativePath)).toLowerCase();
    if (basename) {
      const values = batchByBasename.get(basename) || [];
      values.push(file);
      batchByBasename.set(basename, values);
    }
  }
  const seen = new Set();
  const confirmed = [];
  const ignored = [];
  const invalid = [];
  const failed = [];
  const rejected = [];
  const allowedRoots = (Array.isArray(options.allowedArtifactRoots) ? options.allowedArtifactRoots : []).filter(Boolean);
  const matchModes = new Set();
  const compatibleWarnings = [];
  if (!result.digestBatchId) compatibleWarnings.push('回执缺少批次号，已按资料身份自动归入当前批次');
  else if (result.digestBatchId !== String(batch.batchId)) compatibleWarnings.push(`回执批次号 ${result.digestBatchId} 与当前批次不同，已按资料身份自动匹配`);
  if (result.scope.type && result.scope.type !== String(batch.scope?.type || '')) compatibleWarnings.push('回执范围类型不同，已忽略该字段');
  if (result.scope.id && result.scope.id !== String(batch.scope?.id || '')) compatibleWarnings.push('回执范围 ID 不同，已按资料身份匹配');
  const resolveExpected = (item) => {
    if (item.materialId && batchById.has(item.materialId)) {
      matchModes.add('materialId');
      return batchById.get(item.materialId);
    }
    const relativePath = normalizedKey(item.relativePath);
    if (relativePath && batchByPath.has(relativePath)) {
      matchModes.add('relativePath');
      return batchByPath.get(relativePath);
    }
    const shaMatches = item.sha1 ? batchBySha1.get(item.sha1) || [] : [];
    if (shaMatches.length === 1) {
      matchModes.add('sha1');
      return shaMatches[0];
    }
    const basename = path.basename(normalizeRelativePath(item.relativePath)).toLowerCase();
    const basenameMatches = basename ? batchByBasename.get(basename) || [] : [];
    if (basenameMatches.length === 1) {
      matchModes.add('filename');
      return basenameMatches[0];
    }
    return null;
  };
  const validateItemIdentity = (item) => {
    const expected = resolveExpected(item);
    const relativePath = normalizedKey(expected?.relativePath || item.relativePath);
    const current = currentByPath.get(relativePath);
    let reason = '';
    if (!expected || !current) reason = '无法与当前批次中的真实资料建立唯一对应';
    else if (String(expected.sha1 || '').toLowerCase() && String(current.sha1 || '').toLowerCase()
      && String(expected.sha1).toLowerCase() !== String(current.sha1).toLowerCase()) reason = '原始文件已在提交后发生变化';
    else if (seen.has(relativePath)) reason = '同一资料在回执中重复出现';
    if (reason) {
      rejected.push({ ...item, reason });
      return null;
    }
    seen.add(relativePath);
    const artifacts = item.artifacts.filter((artifact) => !allowedRoots.length || allowedRoots.some((root) => pathWithin(artifact, root)));
    return { ...expected, ...current, artifacts, receiptStatus: item.status, disposition: item.disposition, message: item.message };
  };
  let items = [...result.processed, ...result.failed];
  const completionSignal = result.status === 'completed'
    || /(消化完成|处理完成|已完成|完成消化|全部完成|success|succeeded|completed|finished)/i.test(result.message);
  const identifiableItems = items.filter((item) => item.materialId || item.relativePath || item.sha1);
  if (!identifiableItems.length && completionSignal && options.assumeAllOnCompletion) {
    items = batch.files.map((file) => normalizeReceiptItem({
      materialId: file.materialId,
      relativePath: file.relativePath,
      sha1: file.sha1,
      status: 'completed',
      artifacts: options.inferredArtifacts || [],
      message: '根据 Agent 完成信号和已更新知识产物自动归并。',
    }));
    matchModes.add('completion_and_artifacts');
    compatibleWarnings.push('回执没有逐文件清单，已依据完成信号和知识产物更新自动结算');
  } else {
    items = identifiableItems;
  }
  if (!items.length) return { ok: false, code: 'result_items_empty', message: '尚未识别到资料结果或可信的知识更新。', result, confirmed: [], remaining: batch.files, rejected: [] };
  for (const item of items) {
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
    compatibility: {
      mode: 'permissive_auto_reconciliation',
      matchModes: [...matchModes],
      warnings: compatibleWarnings,
    },
  };
}

module.exports = {
  DIGEST_RESULT_SCHEMA,
  normalizeDigestResult,
  pathWithin,
  receiptItems,
  validateDigestResult,
};
