function normalizedConfidence(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['high', '高', '0.9', '1'].includes(text)) return 'high';
  if (['low', '低'].includes(text)) return 'low';
  return 'medium';
}

function buildProjectReviewPackage(project, knowledgeRecords = []) {
  const staging = Array.isArray(project?.stagingItems) ? project.stagingItems : [];
  const knowledge = Array.isArray(knowledgeRecords) ? knowledgeRecords : [];
  const evidence = Array.isArray(project?.studentEvidence) ? project.studentEvidence : [];
  const materialReady = staging.filter((item) =>
    !['promoted', 'analyzed', 'discarded'].includes(String(item?.status || ''))
    && (String(item?.status || '') === 'selected' || String(item?.reviewStatus || '') === 'accepted')
    && Boolean(item?.sourcePath || item?.path));
  const materialNeedsReview = staging.filter((item) =>
    !['promoted', 'analyzed', 'discarded'].includes(String(item?.status || ''))
    && !materialReady.some((ready) => String(ready.id) === String(item.id)));
  const pendingKnowledge = knowledge.filter((item) => ['ai_generated', 'pending_review'].includes(String(item?.status || '')));
  const knowledgeReady = pendingKnowledge.filter((item) => normalizedConfidence(item?.confidence) === 'high' && Array.isArray(item?.sourceAssets) && item.sourceAssets.length > 0);
  const knowledgeNeedsReview = pendingKnowledge.filter((item) => !knowledgeReady.some((ready) => String(ready.id) === String(item.id)));
  const evidenceNeedsReview = evidence.filter((item) => !['verified', 'published', 'rejected'].includes(String(item?.status || '')));
  const pendingDigest = Math.max(0, Number(project?.digestState?.pendingCount || 0));
  const readyCount = materialReady.length + knowledgeReady.length;
  const attentionCount = materialNeedsReview.length + knowledgeNeedsReview.length + evidenceNeedsReview.length;
  return {
    schema: 'edu-manager.project-review-package.v1',
    projectId: String(project?.id || ''),
    generatedAt: new Date().toISOString(),
    ready: {
      materialIds: materialReady.map((item) => String(item.id)),
      knowledgeIds: knowledgeReady.map((item) => String(item.id)),
      count: readyCount,
    },
    attention: {
      materials: materialNeedsReview.map((item) => ({ id: String(item.id), title: String(item.filename || item.id), reason: item.aiReason || '尚未完成资料采用判断。' })),
      knowledge: knowledgeNeedsReview.map((item) => ({ id: String(item.id), title: String(item.title || item.id), reason: !item.sourceAssets?.length ? '缺少来源资产。' : '置信度需要人工判断。' })),
      evidence: evidenceNeedsReview.map((item) => ({ studentId: String(item.studentId || ''), title: String(item.ability || '待标注能力'), reason: '成长结论必须由人确认。' })),
      count: attentionCount,
    },
    pendingDigest,
    primaryAction: readyCount > 0 ? 'approve_ready' : materialNeedsReview.length > 0 ? 'assess_materials' : pendingDigest > 0 ? 'digest' : knowledgeNeedsReview.length > 0 ? 'review_knowledge' : evidenceNeedsReview.length > 0 ? 'review_evidence' : 'complete',
    message: readyCount > 0
      ? `本批次有 ${readyCount} 项可一键采用，另有 ${attentionCount} 项需要关注。`
      : attentionCount > 0
        ? `本批次有 ${attentionCount} 项需要判断，系统不会自动形成成长结论。`
        : pendingDigest > 0 ? `有 ${pendingDigest} 份正式资料待消化。` : '当前批次已处理完毕。',
  };
}

module.exports = { buildProjectReviewPackage, normalizedConfidence };

