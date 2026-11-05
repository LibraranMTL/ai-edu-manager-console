'use strict';

function text(value) { return String(value ?? '').trim(); }
function hasEfficiencyEvidence(metrics = {}) {
  const sampledMetrics = ['dueGoalAttainment', 'evidenceBackedOutputs', 'independentCompletion', 'comparableKnownAssistance', 'delayedRetention'];
  return sampledMetrics.some((key) => Number(metrics[key]?.sampleSize || 0) > 0)
    || Number(metrics.rework?.sampleSize || 0) > 0
    || Number(metrics.effort?.sampleSize || 0) > 0;
}
function dimensionSummary(key, dimension = {}) {
  if (dimension.status === 'insufficient_evidence') return { key, status: 'unknown', label: '待观察', summary: '当前没有足够证据形成结论。' };
  if (key === 'goals') return { key, status: dimension.status, label: '目标', summary: dimension.items?.[0]?.title || '已有目标记录' };
  if (key === 'mindset') return { key, status: dimension.status, label: '心态', summary: dimension.selfReport ? '已有学生自述，需结合后续观察。' : '待观察' };
  if (key === 'problems') return { key, status: dimension.status, label: '问题', summary: dimension.items?.[0]?.title || '当前没有登记中的问题' };
  if (key === 'methods') return { key, status: dimension.status, label: '方法', summary: dimension.items?.[0]?.title || '方法效果待验证' };
  if (!hasEfficiencyEvidence(dimension.metrics)) return { key, status: 'unknown', label: '效率', summary: '当前没有可评价样本，保持待观察且不合成总分。' };
  return { key, status: dimension.status, label: '效率', summary: '已有描述性效率记录。' };
}

function buildLearningWorkbenchProjection({ student, learningState = {}, fiveDimensions = {}, tasks = [], projects = [], reportStatus = null,
  expertConsultation = null, expertEntryEnabled = true, updatedAt = new Date().toISOString() } = {}) {
  if (!student?.id) throw Object.assign(new Error('学情工作台缺少学生范围。'), { code: 'student_scope_missing' });
  const pendingTasks = tasks.filter((item) => String(item.status) === 'pending');
  const actions = (learningState.actions || []).filter((item) => !['completed', 'cancelled'].includes(String(item.status))).slice(0, 3);
  const fallbackActions = pendingTasks.slice(0, Math.max(0, 3 - actions.length)).map((item) => ({ actionKey: item.id, title: item.title, status: item.status, source: 'task' }));
  const weeklyActions = [...actions, ...fallbackActions].slice(0, 3);
  const primary = weeklyActions[0] || null;
  const project = projects.find((item) => !['archived', 'completed'].includes(String(item.status))) || projects[0] || null;
  const dimensions = fiveDimensions.dimensions || {};
  return {
    schema: 'edu-manager.learning-workbench.v1', student: { id: text(student.id), name: text(student.name) }, updatedAt,
    todayBestAction: primary ? { title: primary.title, reason: primary.source === 'task' ? '这是当前待完成任务中优先级最高的一项。' : '这是现有学情行动中优先级最高的一项。', actionKey: primary.actionKey || primary.id } : {
      title: '补充一条本周学习反馈', reason: '当前没有可执行行动，先补充事实记录再形成建议。', actionKey: 'learning-check-in' },
    loop: [
      { key: 'ingest', label: '资料进入', status: 'available' },
      { key: 'digest', label: '整理消化', status: 'unknown' },
      { key: 'verify', label: '证据核验', status: (learningState.evidence || []).length ? 'available' : 'waiting' },
      { key: 'change', label: '学情变化', status: (learningState.findings || []).length ? 'available' : 'unknown' },
      { key: 'action', label: '行动项目', status: weeklyActions.length ? 'available' : 'waiting' },
      { key: 'communicate', label: '报告沟通', status: reportStatus?.status === 'ready' ? 'available' : 'waiting' },
    ],
    dimensions: ['goals', 'mindset', 'problems', 'methods', 'efficiency'].map((key) => dimensionSummary(key, dimensions[key])),
    weeklyActions,
    focusProject: project ? { id: text(project.id), name: text(project.name), status: text(project.status),
      milestone: text(project.deliverables?.[0]) || '里程碑待补充',
      risk: project.successCriteria?.length ? '按成功标准持续补证' : '尚未设置结构化成功标准',
      reportStatus: reportStatus?.status || '待生成' } : null,
    expertConsultation: expertConsultation || { draft: null, authorizationValid: false, reviewed: false },
    expertEntryEnabled: expertEntryEnabled !== false,
    boundaries: { readOnly: true, noCompositeScore: true, projectInferenceExcludedFromAbility: true },
  };
}

module.exports = { buildLearningWorkbenchProjection };
