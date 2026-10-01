const MATURITY_LABELS = {
  established: '已形成',
  emerging: '正在形成',
  observing: '观察中',
  unverified: '证据不足',
};

const TREND_LABELS = {
  improving: '持续增强',
  stable: '保持稳定',
  insufficient: '尚不足以判断',
};

const PROJECT_STATUS_LABELS = {
  published: '已发布',
  pending_review: '积累中',
  pending: '积累中',
  not_started: '尚无成长证据',
};
const { fixedEvidenceProjection, requiresFixedReportEvidence } = require('./project-evidence-reference.cjs');

function limitedArray(value, limit) {
  return (Array.isArray(value) ? value : []).slice(0, limit);
}

function buildStudentGrowthSummary(student, index = {}, options = {}) {
  if (index.studentId && String(index.studentId) !== String(student?.id)) throw new Error('成长索引不属于当前学生。');
  const abilityLimit = Number.isFinite(options.abilityLimit) ? options.abilityLimit : 12;
  const projectLimit = Number.isFinite(options.projectLimit) ? options.projectLimit : 12;
  const evidenceLimit = Number.isFinite(options.evidenceLimit) ? options.evidenceLimit : 10;
  const summary = index && typeof index.summary === 'object' ? index.summary : {};
  const visibleEvidence = (Array.isArray(index.evidence) ? index.evidence : [])
    .filter((item) => ['confirmed', 'watching'].includes(String(item?.status || '')));
  const abilities = Array.isArray(index.abilities) ? index.abilities : [];
  const projects = Array.isArray(index.projects) ? index.projects : [];
  const projectStatus = (item) => String(item?.reviewStatus || item?.status || 'not_started');

  return {
    ok: true,
    schema: 'edu-manager.student-growth-summary.v1',
    student: {
      id: String(student?.id || ''),
      name: String(student?.name || ''),
    },
    updatedAt: String(index.updatedAt || ''),
    summary: {
      evidenceCount: Number(summary.evidenceCount ?? (Array.isArray(index.evidence) ? index.evidence.length : 0)),
      confirmedCount: Number(summary.confirmedCount ?? visibleEvidence.filter((item) => item?.status === 'confirmed').length),
      watchingCount: Number(summary.watchingCount ?? visibleEvidence.filter((item) => item?.status === 'watching').length),
      abilityCount: Number(summary.abilityCount ?? abilities.length),
      projectCount: Number(summary.projectCount ?? projects.length),
      publishedProjectCount: Number(summary.publishedProjectCount ?? projects.filter((item) => projectStatus(item) === 'published').length),
      lastEvidenceAt: String(summary.lastEvidenceAt || ''),
    },
    abilities: limitedArray(abilities, abilityLimit).map((item) => ({
      name: String(item?.name || '待标注'),
      maturity: String(item?.maturity || 'unverified'),
      maturityLabel: MATURITY_LABELS[item?.maturity] || MATURITY_LABELS.unverified,
      trend: String(item?.trend || 'insufficient'),
      trendLabel: TREND_LABELS[item?.trend] || TREND_LABELS.insufficient,
      evidenceCount: Number(item?.evidenceCount || 0),
      confirmedCount: Number(item?.confirmedCount || 0),
      projectNames: limitedArray(item?.projectNames, 5).map(String),
      lastObservedAt: String(item?.lastObservedAt || ''),
    })),
    projects: limitedArray(projects, projectLimit).map((item) => ({
      projectName: String(item?.projectName || '未命名项目'),
      reviewStatus: projectStatus(item),
      reviewStatusLabel: PROJECT_STATUS_LABELS[projectStatus(item)] || '积累中',
      evidenceCount: Number(item?.evidenceCount || 0),
      confirmedEvidenceCount: Number(item?.confirmedEvidenceCount || 0),
      abilityNames: limitedArray(item?.abilityNames, 5).map(String),
      updatedAt: String(item?.updatedAt || item?.publishedAt || ''),
    })),
    recentEvidence: limitedArray(visibleEvidence, evidenceLimit).map((item) => ({
      evidenceId: String(item?.id || ''),
      title: String(item?.title || '成长证据'),
      status: String(item?.status || ''),
      statusLabel: item?.status === 'confirmed' ? '已确认' : '观察中',
      ability: String(item?.ability || '待标注'),
      projectName: String(item?.projectName || ''),
      updatedAt: String(item?.updatedAt || item?.createdAt || ''),
      ...(requiresFixedReportEvidence(item) ? { projectId: String(item.projectId || ''), ...fixedEvidenceProjection(item) } : {}),
    })),
  };
}

module.exports = {
  buildStudentGrowthSummary,
};
