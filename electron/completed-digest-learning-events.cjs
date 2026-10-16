const path = require('node:path');
const { appendLearningEvents, collectLearningEvents, loadTaxonomy, normalizeLearningEvent } = require('./learning-analytics.cjs');

function insideRoot(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function supplementCompletedDigestLearningEvents(input = {}) {
  const studentId = String(input.studentId || '');
  const batch = input.batch;
  const receipt = input.receipt;
  const files = Array.isArray(batch?.files) ? batch.files : [];
  if (!studentId || !input.studentRootPath || !input.rawRoot
    || batch?.scope?.type !== 'student' || String(batch.scope.id) !== studentId
    || batch.status !== 'completed' || !files.length) {
    return { ok: false, code: 'completed_batch_required', message: '仅支持当前学生的已完成资料批次。' };
  }
  if (!receipt || String(receipt.batchId || receipt.digestBatchId || '') !== String(batch.batchId)
    || String(receipt.studentId || '') !== studentId || receipt.status !== 'completed') {
    return { ok: false, code: 'receipt_scope_mismatch', message: '回执的学生、批次或完成状态与当前批次不一致。' };
  }
  const events = receipt.learningEvents;
  if (!Array.isArray(events) || !events.length || events.length > 500) {
    return { ok: false, code: 'learning_events_missing', message: '当前批次回执没有可补录的学习事件候选。' };
  }
  const byId = new Map(files.map((file) => [String(file.materialId || ''), file]));
  if (byId.has('') || byId.size !== files.length) {
    return { ok: false, code: 'batch_identity_invalid', message: '批次材料 ID 缺失或重复。' };
  }
  const processed = Array.isArray(receipt.processed) ? receipt.processed : [];
  const processedIds = processed.map((item) => String(typeof item === 'string' ? item : item?.materialId || ''));
  if (!processedIds.length || processedIds.some((id) => !byId.has(id)) || new Set(processedIds).size !== processedIds.length) {
    return { ok: false, code: 'receipt_material_mismatch', message: '回执已处理材料无法逐一对应当前批次。' };
  }
  const materials = new Map((Array.isArray(input.materials) ? input.materials : [])
    .map((item) => [String(item.id || ''), item]));
  for (const id of processedIds) {
    const file = byId.get(id);
    const material = materials.get(id);
    const expectedHash = String(file.sha1 || '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(expectedHash) || !material
      || String(material.studentId || '') !== studentId
      || material.status !== 'processed' || String(material.digestBatchId || '') !== String(batch.batchId)
      || String(material.sha1 || '').toLowerCase() !== expectedHash) {
      return { ok: false, code: 'material_state_mismatch', message: '材料身份、哈希或已完成状态与批次快照不一致。' };
    }
    const relativePath = String(file.relativePath || '');
    const absolutePath = path.resolve(input.rawRoot, relativePath);
    if (!relativePath || !insideRoot(input.rawRoot, absolutePath)
      || typeof input.hashFile !== 'function' || String(input.hashFile(absolutePath) || '').toLowerCase() !== expectedHash) {
      return { ok: false, code: 'source_file_changed', message: '原始资料不存在、越界或内容与已完成批次不一致，已停止补录。' };
    }
  }
  const allowedEvidenceRefs = processedIds.flatMap((id) => [
    { sourceType: 'digest_material', sourceId: id },
    { sourceType: 'source_material', sourceId: id },
  ]);
  const context = { studentId, allowedEvidenceRefs, taxonomy: loadTaxonomy() };
  const preview = events.map((event) => normalizeLearningEvent(event, context));
  if (!preview.some((item) => item.ok)) {
    return { ok: false, code: 'no_valid_learning_events', rejected: preview.map((item, index) => ({ index, code: item.code })), message: '回执中的学习事件均未通过主机校验，未写入账本。' };
  }
  if (input.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      batchId: String(batch.batchId),
      materialCount: processedIds.length,
      candidateCount: events.length,
      validCandidateCount: preview.filter((item) => item.ok).length,
      rejected: preview.flatMap((item, index) => item.ok ? [] : [{ index, code: item.code }]),
    };
  }
  const result = appendLearningEvents(input.studentRootPath, {
    studentId,
    batchId: String(batch.batchId),
    events,
    allowedEvidenceRefs,
    extractorVersion: 'completed-digest-learning-events.v1',
  });
  return {
    ok: Boolean(result.ok),
    code: result.code || '',
    batchId: String(batch.batchId),
    materialCount: processedIds.length,
    candidateCount: events.length,
    accepted: Number(result.accepted || 0),
    rejected: result.rejected || [],
    deduplicatedTotal: Number(result.deduplicatedTotal || 0),
    message: result.ok
      ? `已校验 ${events.length} 条候选，新增入账 ${result.accepted || 0} 条，拒绝 ${(result.rejected || []).length} 条；原资料未重新消化。`
      : result.message || '学习事件补录失败。',
  };
}

function reconcileCompletedDigestLearningReceipts(input = {}) {
  const studentId = String(input.studentId || '');
  const batch = input.batch;
  const files = Array.isArray(batch?.files) ? batch.files : [];
  if (!studentId || batch?.scope?.type !== 'student' || String(batch.scope.id) !== studentId
    || batch.status !== 'completed' || !files.length) {
    return { ok: false, code: 'completed_batch_required', checkedFingerprints: [], message: '仅支持当前学生的已完成资料批次。' };
  }
  const checkedBefore = new Set((Array.isArray(input.checkedFingerprints) ? input.checkedFingerprints : []).map(String));
  const candidates = (Array.isArray(input.candidates) ? input.candidates : [])
    .filter((candidate) => candidate && String(candidate.fingerprint || '') && !checkedBefore.has(String(candidate.fingerprint)));
  if (!candidates.length) return { ok: true, skipped: true, checkedFingerprints: [], accepted: 0, rejected: [], message: '没有新的已完成批次回执需要重对账。' };

  const checkedFingerprints = [];
  const receiptRejections = [];
  const events = [];
  for (const candidate of candidates) {
    const fingerprint = String(candidate.fingerprint);
    checkedFingerprints.push(fingerprint);
    const payload = candidate.payload;
    const receiptStudentId = String(payload?.studentId || payload?.scope?.id || payload?.data?.studentId || '');
    const receiptBatchId = String(payload?.digestBatchId || payload?.batchId || payload?.data?.digestBatchId || payload?.data?.batchId || '');
    const receiptStatus = String(payload?.status || payload?.data?.status || '').toLowerCase();
    if (receiptStudentId !== studentId || receiptBatchId !== String(batch.batchId)
      || (receiptStatus && receiptStatus !== 'completed')) {
      receiptRejections.push({ fingerprint, code: 'receipt_scope_mismatch' });
      continue;
    }
    events.push(...collectLearningEvents(payload));
  }
  if (!events.length) {
    return {
      ok: true,
      skipped: true,
      batchId: String(batch.batchId),
      checkedFingerprints,
      receiptCount: candidates.length,
      accepted: 0,
      rejected: [],
      receiptRejections,
      message: '新回执不含学习事件，已记录检查指纹。',
    };
  }

  const receipt = {
    status: 'completed',
    studentId,
    digestBatchId: String(batch.batchId),
    processed: files.map((file) => String(file.materialId || '')).filter(Boolean),
    learningEvents: events,
  };
  const result = supplementCompletedDigestLearningEvents({ ...input, receipt });
  return {
    ...result,
    checkedFingerprints,
    receiptCount: candidates.length,
    receiptRejections,
    message: result.ok
      ? `迟到回执重对账完成：检查 ${candidates.length} 份新回执，新增入账 ${result.accepted || 0} 条学习事件。`
      : result.message,
  };
}

module.exports = { reconcileCompletedDigestLearningReceipts, supplementCompletedDigestLearningEvents };
