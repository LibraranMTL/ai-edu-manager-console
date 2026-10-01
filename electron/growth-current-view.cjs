const { buildGrowthIndexV2 } = require('./growth-model.cjs');
const { requiresFixedReportEvidence, resolveFixedEvidenceSources, fixedEvidenceProjection } = require('./project-evidence-reference.cjs');
const { invariant } = require('./project-material-contract.cjs');

// Request-local: no authorization decision or registry survives the read request.
function createGrowthSourceReader({ student, projects = [], readProjectIndex }) {
  const studentId = String(student?.id || '');
  const allowed = projects.filter((project) => project.studentIds?.map(String).includes(studentId));
  const byId = new Map(allowed.map((project) => [String(project.id), project]));
  const registries = new Map();
  const resolveFixedSources = (evidence) => {
    const project = byId.get(String(evidence.projectId || ''));
    if (!project || evidence.status !== 'confirmed' || (evidence.conflicts || []).length) return [];
    try {
      if (!registries.has(project.id)) {
        // Cache a failed read too: a malformed registry must not be retried for every card.
        registries.set(project.id, null);
        registries.set(project.id, readProjectIndex(project));
      }
      const index = registries.get(project.id);
      if (!index) return [];
      return resolveFixedEvidenceSources({ studentId, project, evidence, index });
    } catch { return []; }
  };
  return { projects: allowed, resolveFixedSources };
}

function currentGrowthReadView({ student, index = {}, projects = [], resolveFixedSources, visibleOnly = false }) {
  const studentId = String(student?.id || '');
  invariant(studentId && (!index.studentId || String(index.studentId) === studentId), 'cross_student_index', '成长索引不属于当前学生。');
  const allowed = projects.filter((project) => project.studentIds?.map(String).includes(studentId));
  const byId = new Map(allowed.map((project) => [String(project.id), project]));
  const candidates = [];
  for (const evidence of Array.isArray(index.evidence) ? index.evidence : []) {
    if (!evidence || (evidence.studentId && String(evidence.studentId) !== studentId)) continue;
    const project = byId.get(String(evidence.projectId || ''));
    if (evidence.projectId && !project) continue;
    if (visibleOnly && !['confirmed', 'watching'].includes(evidence.status)) continue;
    if (requiresFixedReportEvidence(evidence, projects)) {
      let sources = [];
      try { sources = typeof resolveFixedSources === 'function' ? resolveFixedSources(evidence) : []; } catch {}
      if (!Array.isArray(sources) || !sources.length || sources.some((source) => !source.available)) continue;
      candidates.push({ ...evidence, ...fixedEvidenceProjection(evidence), sourcePath: '',
        sourceMaterials: sources.filter((source) => source.materialId).map(({ materialId, version, sha256 }) => ({ materialId, version, sha256 })),
        projectName: String(project.name || '') });
    } else candidates.push({ ...evidence, ...(project ? { projectName: String(project.name || '') } : {}) });
  }
  const stamp = new Date(index.updatedAt || 0);
  const derived = buildGrowthIndexV2({ student, growthDir: index.growthDir || '', review: { candidates }, projects: allowed,
    sourceFiles: index.sourceFiles || {}, migration: index.migration || {}, now: Number.isNaN(stamp.getTime()) ? new Date(0) : stamp });
  return { ...index, ...derived, updatedAt: String(index.updatedAt || ''), sourceFingerprint: String(index.sourceFingerprint || ''),
    readView: { kind: 'current-authorized', sourceValidation: 'metadata', visibleOnly, persisted: false } };
}

function currentGrowthReviewView({ student, review = {}, projects = [], resolveFixedSources }) {
  const allowed = new Set(projects.filter((project) => project.studentIds?.map(String).includes(String(student.id))).map((project) => String(project.id)));
  const candidates = (Array.isArray(review.candidates) ? review.candidates : []).flatMap((item) => {
    if (item.projectId && !allowed.has(String(item.projectId))) return [];
    if (!requiresFixedReportEvidence(item, projects)) return [{ ...item }];
    let sources = [];
    try { sources = typeof resolveFixedSources === 'function' ? resolveFixedSources(item) : []; } catch {}
    const available = Array.isArray(sources) && sources.length > 0 && sources.every((source) => source.available);
    return [{ ...item, ...fixedEvidenceProjection(item), requiresProjectConfirmation: true,
      sourcePath: '', sourcePaths: [], sourceUri: '',
      recordedStatus: String(item.status || 'pending'),
      status: item.status === 'confirmed' && !available ? 'pending' : item.status,
      sourceResolution: available ? 'fixed_metadata_verified' : 'fixed_unavailable',
      ...(available ? {} : { automationAttentionReason: 'fixed_source_unavailable' }) }];
  });
  return { ...review, candidates, readOnlyView: true };
}

function currentGrowthMarkdown(student, index) {
  const cell = (value) => String(value || '').replace(/[|\r\n]/gu, ' ');
  const abilityRows = index.abilities.map((item) => `| ${cell(item.name)} | ${cell(item.maturity)} | ${cell(item.trend)} | ${item.evidenceCount} | ${item.confirmedCount} | ${cell(item.projectNames.join('、'))} | ${cell(item.lastObservedAt)} |`).join('\n');
  const projectRows = index.projects.map((item) => `| ${cell(item.projectName)} | ${cell(item.reviewStatus)} | ${item.evidenceCount} | ${item.confirmedEvidenceCount} | ${cell(item.abilityNames.join('、'))} | ${cell(item.updatedAt)} |`).join('\n');
  return `# ${cell(student.name)} 成长模型当前视图\n\n生成时间：${cell(index.updatedAt)}\n\n> 只读展示；项目范围与固定来源已按当前元数据核对，未改写历史档案。原文打开时另行核验字节。\n\n## 总览\n\n| 指标 | 数量 |\n| --- | ---: |\n| 成长证据 | ${index.summary.evidenceCount} |\n| 已确认 | ${index.summary.confirmedCount} |\n| 观察中 | ${index.summary.watchingCount} |\n| 能力维度 | ${index.summary.abilityCount} |\n| 关联项目 | ${index.summary.projectCount} |\n| 已发布项目贡献 | ${index.summary.publishedProjectCount} |\n\n## 能力画像\n\n| 能力 | 成熟度 | 趋势 | 证据 | 已确认 | 来源项目 | 最近观察 |\n| --- | --- | --- | ---: | ---: | --- | --- |\n${abilityRows}\n\n## 项目贡献\n\n| 项目 | 状态 | 证据 | 已确认 | 能力 | 更新 |\n| --- | --- | ---: | ---: | --- | --- |\n${projectRows}\n`;
}

module.exports = { createGrowthSourceReader, currentGrowthReadView, currentGrowthReviewView, currentGrowthMarkdown };
