function reconcileDigestControlState(parsedState, pendingCount) {
  const parsed = parsedState && typeof parsedState === 'object' && !Array.isArray(parsedState) ? parsedState : {};
  const count = Math.max(0, Number(pendingCount || 0));
  let status = String(parsed.status || (count > 0 ? 'pending' : 'idle'));
  let digestBatchId = String(parsed.digestBatchId || '');
  let submittedFiles = Array.isArray(parsed.submittedFiles) ? parsed.submittedFiles : [];
  let message = '';
  const activeBatchIsValid = Boolean(digestBatchId && submittedFiles.length);
  if (['submitted', 'digesting'].includes(status) && (!activeBatchIsValid || count === 0)) {
    status = count > 0 ? 'pending' : (parsed.lastDigestAt ? 'completed' : 'idle');
    digestBatchId = '';
    submittedFiles = [];
    message = count > 0
      ? `检测到失效的消化批次，已恢复为待处理（${count} 份）。`
      : '检测到无待处理文件的失效消化状态，已自动收口。';
  } else if (count > 0 && ['idle', 'completed'].includes(status)) {
    status = 'pending';
    message = `检测到 ${count} 份新增或变更资料，已恢复为待消化。`;
  } else if (count === 0 && status === 'pending') {
    status = parsed.lastDigestAt ? 'completed' : 'idle';
    message = '当前没有待消化资料。';
  }
  return { status, digestBatchId, submittedFiles, message };
}

function normalizeProjectDigestReceipt(receipt, submittedFiles = []) {
  const original = receipt && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt : {};
  const submitted = Array.isArray(submittedFiles) ? submittedFiles : [];
  const normalized = normalizeDigestResult(original, {
    batchId: String(original.digestBatchId || original.batchId || ''),
    scope: { type: 'project', id: String(original.projectId || '') },
    files: submitted,
  });
  const stats = original.digestStats && typeof original.digestStats === 'object' ? original.digestStats : {};
  const totalFiles = Number(stats.totalFiles);
  const actuallyDigested = Number(stats.actuallyDigested);
  const skipped = Number(stats.skipped);
  const hasStats = Number.isFinite(totalFiles) || Number.isFinite(actuallyDigested) || Number.isFinite(skipped);
  const compatibility = original.compatibility || {
    mode: hasStats ? 'qclaw_digest_stats_permissive' : 'project_receipt_permissive',
    sourceStatus: String(original.status || original.digestStatus || original.state || ''),
    ...(Number.isFinite(totalFiles) ? { totalFiles } : {}),
    ...(Number.isFinite(actuallyDigested) ? { actuallyDigested } : {}),
    ...(Number.isFinite(skipped) ? { skipped } : {}),
  };
  return {
    receipt: {
      ...original,
      status: normalized.status || (normalized.processed.length ? 'partial' : ''),
      projectId: String(original.projectId || normalized.scope.id || ''),
      digestBatchId: String(original.digestBatchId || original.batchId || normalized.digestBatchId || ''),
      digestedFiles: normalized.processed,
      failed: normalized.failed,
      compatibility,
    },
    compatibility,
  };
}

function validateDigestReceipt({ projectId, current, request, receipt, rawFiles, assumeAllOnCompletion = false, inferredArtifacts = [] }) {
  const state = current && typeof current === 'object' ? current : {};
  const requestData = request && typeof request === 'object' ? request : {};
  const submitted = Array.isArray(state.submittedFiles) ? state.submittedFiles : [];
  const normalizedReceipt = normalizeProjectDigestReceipt(receipt, submitted);
  const receiptData = normalizedReceipt.receipt;
  const batchId = String(state.digestBatchId || requestData.digestBatchId || receiptData.digestBatchId || `project-digest-${projectId}`);
  if (!submitted.length) return { ok: false, code: 'no_active_batch', message: '当前没有等待结算的项目资料。' };
  const receiptKeys = Object.keys(receiptData);
  if (!receiptKeys.length) {
    return { ok: false, code: 'receipt_not_ready', message: '尚未检测到当前批次的有效完成回执。' };
  }
  const rawByPath = new Map((Array.isArray(rawFiles) ? rawFiles : []).map((file) => [String(file.relativePath || '').replace(/\\/g, '/').toLowerCase(), file]));
  const batchFiles = submitted.map((file, index) => ({
    ...file,
    materialId: String(file.materialId || `project-${projectId}-${index}`),
  }));
  const currentFiles = batchFiles.map((file) => {
    const raw = rawByPath.get(String(file.relativePath || '').replace(/\\/g, '/').toLowerCase());
    return raw ? { ...file, ...raw, materialId: file.materialId } : file;
  });
  const validation = validateDigestResult({
    batch: { batchId, scope: { type: 'project', id: String(projectId) }, files: batchFiles },
    receipt: receiptData,
    currentFiles,
    assumeAllOnCompletion,
    inferredArtifacts,
  });
  if (!validation.ok) return validation;
  return {
    ok: true,
    confirmed: validation.confirmed,
    remaining: validation.remaining,
    rejected: validation.rejected,
    fullyCompleted: validation.fullyCompleted,
    compatibility: {
      ...(normalizedReceipt.compatibility || {}),
      reconciliation: validation.compatibility,
      ignoredRequestBatch: Boolean(requestData.digestBatchId && requestData.digestBatchId !== batchId),
      ignoredReceiptBatch: Boolean(receiptData.digestBatchId && receiptData.digestBatchId !== batchId),
      pathMode: path.sep,
    },
  };
}

function nextStagingReviewState(item, decision) {
  const current = item && typeof item === 'object' ? item : {};
  if (['promoted', 'analyzed'].includes(String(current.status))) {
    return { ok: false, status: current.status, reason: '已晋升或已分析资料不能返回暂存审核状态' };
  }
  if (decision === 'accepted') return { ok: true, status: 'selected' };
  if (decision === 'rejected') return { ok: true, status: 'discarded' };
  return { ok: true, status: current.status === 'discarded' ? 'collected' : String(current.status || 'collected') };
}

function repairStagingLifecycle(item) {
  const current = item && typeof item === 'object' ? item : {};
  const status = String(current.status || 'collected');
  const analyzedWithoutPromotion = status === 'analyzed'
    && String(current.reviewStatus || 'pending') !== 'accepted'
    && !String(current.promotedAssetId || '')
    && !String(current.promotedAt || '')
    && !String(current.analyzedAt || '');
  if (!analyzedWithoutPromotion) return { ...current };
  return {
    ...current,
    status: 'screened',
    lifecycleRepairReason: String(current.lifecycleRepairReason || 'AI初筛不能直接进入已分析终态，已恢复为待人工确认。'),
  };
}

function nextKnowledgeReviewState(currentStatus, nextStatus) {
  const transitions = {
    ai_generated: new Set(['pending_review', 'verified', 'rejected', 'invalid']),
    pending_review: new Set(['verified', 'rejected', 'invalid']),
    verified: new Set(['pending_review', 'published', 'rejected', 'invalid']),
    published: new Set(['invalid']),
    rejected: new Set(['pending_review', 'verified', 'invalid']),
    invalid: new Set(['pending_review']),
  };
  const current = String(currentStatus || 'ai_generated');
  const next = String(nextStatus || '');
  return { ok: current === next || Boolean(transitions[current]?.has(next)), from: current, to: next };
}

function projectCompletionIssues({ stage = 'archive', projectStatus, students, studentEvidence, digestState, stagingStatuses, knowledgeStatuses }) {
  const boundStudents = Array.isArray(students) ? students : [];
  const digest = digestState && typeof digestState === 'object' ? digestState : {};
  const unresolvedStaging = (Array.isArray(stagingStatuses) ? stagingStatuses : []).filter((status) => !['promoted', 'analyzed', 'discarded'].includes(String(status)));
  const unresolvedKnowledge = (Array.isArray(knowledgeStatuses) ? knowledgeStatuses : []).filter((status) => ['ai_generated', 'pending_review'].includes(String(status)));
  const issues = [];
  if (!boundStudents.length) issues.push('项目尚未绑定学生');
  if (Number(digest.pendingCount || 0) > 0 || ['submitted', 'digesting', 'failed'].includes(String(digest.status))) {
    issues.push(`项目消化尚未收口（${digest.pendingCount || 0} 份待处理，状态 ${digest.status}）`);
  }
  if (unresolvedStaging.length) issues.push(`${unresolvedStaging.length} 份暂存资料尚未晋升、分析或排除`);
  if (unresolvedKnowledge.length) issues.push(`${unresolvedKnowledge.length} 条知识资产尚未审核`);
  if (stage === 'publish') {
    if (!['archived', 'published'].includes(String(projectStatus))) issues.push(`项目状态必须为已归档，当前为 ${projectStatus}`);
    const verifiedStudentIds = new Set((Array.isArray(studentEvidence) ? studentEvidence : [])
      .filter((item) => ['verified', 'published'].includes(String(item?.status)) && Array.isArray(item?.sourcePaths) && item.sourcePaths.length)
      .map((item) => String(item.studentId)));
    const missingEvidence = boundStudents.filter((student) => !verifiedStudentIds.has(String(student.id)));
    if (missingEvidence.length) issues.push(`${missingEvidence.length} 名学生缺少已确认且有来源的个人成长证据`);
  }
  return { issues, unresolvedStaging, unresolvedKnowledge };
}

module.exports = {
  nextKnowledgeReviewState,
  nextStagingReviewState,
  projectCompletionIssues,
  repairStagingLifecycle,
  reconcileDigestControlState,
  normalizeProjectDigestReceipt,
  validateDigestReceipt,
};
const path = require('node:path');

const { normalizeDigestResult, validateDigestResult } = require('./digest-result.cjs');
