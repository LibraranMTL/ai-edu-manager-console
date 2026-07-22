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

function validateDigestReceipt({ projectId, current, request, receipt, rawFiles }) {
  const state = current && typeof current === 'object' ? current : {};
  const requestData = request && typeof request === 'object' ? request : {};
  const receiptData = receipt && typeof receipt === 'object' ? receipt : {};
  const submitted = Array.isArray(state.submittedFiles) ? state.submittedFiles : [];
  const batchId = String(state.digestBatchId || '');
  if (!batchId || !['submitted', 'digesting'].includes(String(state.status)) || !submitted.length) {
    return { ok: false, code: 'no_active_batch', message: '当前没有已登记且等待回执的消化批次。' };
  }
  if (String(requestData.projectId || '') !== String(projectId) || String(requestData.digestBatchId || '') !== batchId) {
    return { ok: false, code: 'request_mismatch', message: '当前消化请求文件缺失或批次不一致，未同步结果。' };
  }
  const receiptKeys = Object.keys(receiptData);
  if (!receiptKeys.length) {
    return { ok: false, code: 'receipt_not_ready', message: '尚未检测到当前批次的有效完成回执。' };
  }
  const receiptProblems = [];
  if (receiptData.status !== 'completed') {
    receiptProblems.push(`status 应为 completed，实际为 ${String(receiptData.status || '缺失')}`);
  }
  if (String(receiptData.projectId || '') !== String(projectId)) {
    receiptProblems.push(`projectId 应为 ${projectId}，实际为 ${String(receiptData.projectId || '缺失')}`);
  }
  if (String(receiptData.digestBatchId || '') !== batchId) {
    const incompatibleBatch = receiptData.batchId ? `；检测到不兼容字段 batchId=${receiptData.batchId}` : '';
    receiptProblems.push(`digestBatchId 应为 ${batchId}，实际为 ${String(receiptData.digestBatchId || '缺失')}${incompatibleBatch}`);
  }
  if (!Array.isArray(receiptData.digestedFiles) && Array.isArray(receiptData.processedFiles)) {
    receiptProblems.push('使用了 processedFiles；当前协议要求 digestedFiles，并逐项提供 relativePath 与 sha1');
  }
  if (receiptProblems.length) {
    return {
      ok: false,
      code: 'receipt_not_ready',
      message: `已检测到回执文件，但不符合当前批次协议：${receiptProblems.join('；')}。未同步任何资料。`,
    };
  }
  const explicit = Array.isArray(receiptData.digestedFiles) ? receiptData.digestedFiles : [];
  if (!explicit.length) return { ok: false, code: 'empty_receipt', message: 'Agent 完成回执缺少 digestedFiles，未更新任何资料。' };
  const submittedByRelativePath = new Map(submitted.map((file) => [String(file.relativePath || ''), file]));
  const rawByRelativePath = new Map((Array.isArray(rawFiles) ? rawFiles : []).map((file) => [String(file.relativePath || ''), file]));
  const confirmed = [];
  const rejected = [];
  const seen = new Set();
  for (const item of explicit) {
    if (!item || typeof item !== 'object') {
      rejected.push({ receipt: item, reason: '回执条目必须同时包含 relativePath 和 sha1' });
      continue;
    }
    const relativePath = String(item.relativePath || '');
    const sha1 = String(item.sha1 || '');
    const submittedFile = submittedByRelativePath.get(relativePath);
    const rawFile = rawByRelativePath.get(relativePath);
    if (!relativePath || !sha1 || !submittedFile || !rawFile || String(submittedFile.sha1 || '') !== sha1 || String(rawFile.sha1 || '') !== sha1) {
      rejected.push({ relativePath, sha1, reason: '不属于当前批次，或文件内容已变化' });
      continue;
    }
    if (!seen.has(relativePath)) {
      confirmed.push(rawFile);
      seen.add(relativePath);
    }
  }
  if (!confirmed.length) return { ok: false, code: 'no_matching_files', rejected, message: 'Agent 已写完成状态，但未提供与当前批次匹配的 digestedFiles，未更新消化清单。' };
  const remaining = submitted.filter((file) => !seen.has(String(file.relativePath || '')));
  return { ok: true, confirmed, remaining, rejected, fullyCompleted: remaining.length === 0 };
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
  reconcileDigestControlState,
  validateDigestReceipt,
};
