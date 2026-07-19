const crypto = require('crypto');

const KNOWN_STATUSES = new Set(['pending', 'confirmed', 'watching', 'rejected']);

function stableId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 14)}`;
}

function safeDate(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeStatus(value) {
  return KNOWN_STATUSES.has(String(value)) ? String(value) : 'pending';
}

function parseLegacyGrowthEvidenceMarkdown(content, sourceFile = '成长证据.md') {
  const results = [];
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
    if (cells.length < 5) continue;
    if (/^(日期|---|:?-+)/.test(cells[0]) || cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    if (cells.some((cell) => cell === '待补充')) continue;
    const [date, title, source, ability, confidence] = cells;
    const seed = `${date}|${title}|${source}|${ability}|${confidence}`;
    results.push({
      id: stableId('legacy-evidence', seed),
      title: title || '历史成长证据',
      content: title || '',
      sourcePath: source || '',
      projectName: source || '',
      status: 'confirmed',
      ability: ability || '待标注',
      confidence: confidence || '历史确认',
      createdAt: safeDate(date)?.toISOString() || '',
      updatedAt: safeDate(date)?.toISOString() || '',
      migratedFrom: sourceFile,
    });
  }
  return results;
}

function evidenceTime(item) {
  return safeDate(item.updatedAt || item.createdAt)?.toISOString() || '';
}

function buildGrowthIndexV2({ student, growthDir, review, projects = [], sourceFiles = {}, migration = {}, now = new Date() }) {
  const candidates = Array.isArray(review?.candidates) ? review.candidates : [];
  const abilities = new Map();
  const projectEvidence = new Map();

  for (const source of candidates) {
    const candidate = { ...source, status: normalizeStatus(source.status) };
    const abilityName = String(candidate.ability || '待标注').trim() || '待标注';
    const ability = abilities.get(abilityName) || {
      abilityId: stableId('ability', abilityName),
      name: abilityName,
      evidenceIds: [],
      projectIds: new Set(),
      projectNames: new Set(),
      dates: [],
      total: 0,
      pending: 0,
      confirmed: 0,
      watching: 0,
      rejected: 0,
    };
    ability.total += 1;
    ability[candidate.status] += 1;
    ability.evidenceIds.push(candidate.id);
    if (candidate.projectId) ability.projectIds.add(String(candidate.projectId));
    if (candidate.projectName) ability.projectNames.add(String(candidate.projectName));
    const timestamp = evidenceTime(candidate);
    if (timestamp) ability.dates.push(timestamp);
    abilities.set(abilityName, ability);
    if (candidate.projectId) {
      const projectId = String(candidate.projectId);
      const list = projectEvidence.get(projectId) || [];
      list.push(candidate);
      projectEvidence.set(projectId, list);
    }
  }

  const abilityList = Array.from(abilities.values()).map((item) => {
    const dates = item.dates.sort();
    const maturity = item.confirmed >= 3 ? 'established' : item.confirmed >= 1 ? 'emerging' : item.watching >= 1 ? 'observing' : 'unverified';
    const trend = item.confirmed >= 2 && dates.length >= 2 ? 'improving' : item.confirmed || item.watching ? 'stable' : 'insufficient';
    return {
      abilityId: item.abilityId,
      name: item.name,
      evidenceCount: item.total,
      pendingCount: item.pending,
      confirmedCount: item.confirmed,
      watchingCount: item.watching,
      rejectedCount: item.rejected,
      projectIds: Array.from(item.projectIds),
      projectNames: Array.from(item.projectNames),
      evidenceIds: item.evidenceIds,
      firstObservedAt: dates[0] || '',
      lastObservedAt: dates[dates.length - 1] || '',
      trend,
      maturity,
      confidence: item.confirmed ? 'confirmed' : item.watching ? 'watching' : 'pending',
    };
  }).sort((a, b) => b.confirmedCount - a.confirmedCount || b.evidenceCount - a.evidenceCount || a.name.localeCompare(b.name, 'zh-CN'));

  const projectList = projects.map((project) => {
    const evidence = projectEvidence.get(String(project.id)) || [];
    return {
      contributionId: stableId('contribution', `${student.id}|${project.id}`),
      contributionType: 'project_knowledge',
      projectId: String(project.id),
      projectName: String(project.name || '未命名项目'),
      status: String(project.status || 'active'),
      reviewStatus: project.publishedAt ? 'published' : evidence.length ? 'pending' : 'not_started',
      evidenceCount: evidence.length,
      confirmedEvidenceCount: evidence.filter((item) => item.status === 'confirmed').length,
      evidenceIds: evidence.map((item) => item.id),
      abilityNames: Array.from(new Set(evidence.map((item) => item.ability || '待标注'))),
      knowledgeRootPath: project.knowledgeRootPath || '',
      promotionPath: project.promotionPath || '',
      publishedAt: project.publishedAt || '',
      updatedAt: project.updatedAt || project.publishedAt || '',
    };
  }).sort((a, b) => Number(Boolean(b.publishedAt)) - Number(Boolean(a.publishedAt)) || b.evidenceCount - a.evidenceCount || a.projectName.localeCompare(b.projectName, 'zh-CN'));

  const evidence = candidates.map((item) => ({
    id: item.id,
    title: item.title,
    content: item.content || '',
    status: normalizeStatus(item.status),
    ability: item.ability || '待标注',
    projectId: item.projectId || '',
    projectName: item.projectName || '',
    sourcePath: item.sourcePath || '',
    confidence: item.confidence || '',
    note: item.note || '',
    createdAt: item.createdAt || '',
    updatedAt: item.updatedAt || item.createdAt || '',
    migratedFrom: item.migratedFrom || '',
  })).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  const updatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return {
    version: 2,
    schema: 'edu-manager.growth-model.v2',
    studentId: student.id,
    studentName: student.name,
    updatedAt,
    growthDir,
    sourceFiles,
    migration,
    summary: {
      evidenceCount: evidence.length,
      pendingCount: evidence.filter((item) => item.status === 'pending').length,
      confirmedCount: evidence.filter((item) => item.status === 'confirmed').length,
      watchingCount: evidence.filter((item) => item.status === 'watching').length,
      rejectedCount: evidence.filter((item) => item.status === 'rejected').length,
      abilityCount: abilityList.length,
      projectCount: projectList.length,
      publishedProjectCount: projectList.filter((item) => item.reviewStatus === 'published').length,
      lastEvidenceAt: evidence.find((item) => item.updatedAt)?.updatedAt || '',
    },
    abilities: abilityList,
    projects: projectList,
    evidence,
  };
}

module.exports = {
  buildGrowthIndexV2,
  parseLegacyGrowthEvidenceMarkdown,
  stableId,
};
