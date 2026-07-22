function knowledgeRiskReasons(record) {
  const reasons = [];
  const status = String(record?.status || 'ai_generated');
  const confidence = String(record?.confidence || 'medium').toLowerCase();
  if (status === 'ai_generated') reasons.push('new_content');
  if (status === 'pending_review') reasons.push('pending_review');
  if (confidence === 'low') reasons.push('low_confidence');
  if (!Array.isArray(record?.sourceAssets) || !record.sourceAssets.length) reasons.push('missing_source');
  if (record?.conflict || (Array.isArray(record?.conflictWith) && record.conflictWith.length)) reasons.push('conflict');
  return reasons;
}

function completionBlockers({ students = [], digestState = {}, staging = [], knowledge = [], evidence = [], conflicts = [] }) {
  const blockers = [];
  const push = (severity, target, code, title, detail, blocking = true) => blockers.push({ severity, target, code, title, detail, blocking });
  if (!students.length) push('high', 'workspace', 'missing_students', '尚未绑定学生', '先绑定至少一名参与学生。');
  const pendingDigest = Number(digestState.pendingCount || 0);
  if (pendingDigest > 0 || ['submitted', 'digesting', 'failed'].includes(String(digestState.status))) push('high', 'digest', 'digest_open', '资料消化尚未收口', `${pendingDigest} 份资料待处理，当前状态 ${digestState.status || 'pending'}。`);
  const pendingStaging = staging.filter((item) => !['promoted', 'analyzed', 'discarded'].includes(String(item?.status)));
  if (pendingStaging.length) push('medium', 'assets', 'staging_open', '研究暂存尚未收口', `${pendingStaging.length} 份资料尚未晋升、分析或排除。`);
  const pendingKnowledge = knowledge.filter((item) => ['ai_generated', 'pending_review'].includes(String(item?.status)));
  if (pendingKnowledge.length) push('medium', 'knowledge', 'knowledge_open', '知识资产尚未确认', `${pendingKnowledge.length} 条知识仍需审核。`);
  for (const student of students) {
    const item = evidence.find((candidate) => String(candidate?.studentId) === String(student?.id));
    if (!item) push('medium', 'evidence', `evidence_missing:${student.id}`, `${student.name}缺少个人证据`, '系统可先生成草稿，再由人工确认差异。');
    else if (!Array.isArray(item.sourcePaths) || !item.sourcePaths.length) push('high', 'evidence', `evidence_source:${student.id}`, `${student.name}证据缺少来源`, '无具体来源的成长证据不能发布。');
    else if (!['verified', 'published'].includes(String(item.status))) push('medium', 'evidence', `evidence_review:${student.id}`, `${student.name}证据待确认`, '核对能力维度、具体表现和来源后确认。');
  }
  for (const conflict of conflicts) push(String(conflict.severity || 'medium'), 'promotion', 'promotion_conflict', '发现归档冲突提醒', String(conflict.message || '目标位置已有相关项目记录。'), false);
  const order = { high: 0, medium: 1, low: 2 };
  return blockers.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
}

function singleStudentEvidenceDraft({ project, students = [], knowledge = [], staging = [] }) {
  if (students.length !== 1 || (project?.studentEvidence || []).length) return null;
  const sources = [
    ...knowledge.filter((item) => ['verified', 'published'].includes(String(item?.status))).map((item) => item.path),
    ...staging.filter((item) => ['selected', 'analyzed', 'promoted'].includes(String(item?.status))).map((item) => item.sourcePath || item.path),
  ].filter(Boolean).slice(0, 8);
  return {
    studentId: String(students[0].id),
    ability: String(project?.growthStrategy || '').split(/[，,；;\n]/).map((item) => item.trim()).filter(Boolean)[0] || '项目学习与实践',
    observation: `参与“${project?.name || '学习项目'}”并形成项目知识与成果；请结合来源核对具体表现。`,
    status: 'draft', confidence: sources.length ? 'medium' : 'low', sourcePaths: sources, generatedBy: 'system-draft',
  };
}

module.exports = { completionBlockers, knowledgeRiskReasons, singleStudentEvidenceDraft };
