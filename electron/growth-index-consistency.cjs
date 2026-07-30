const crypto = require('node:crypto');
const path = require('node:path');

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function growthSourceFingerprint(review, projects = []) {
  const candidates = (Array.isArray(review?.candidates) ? review.candidates : []).map((item) => ({
    id: String(item?.id || ''),
    status: String(item?.status || ''),
    ability: String(item?.ability || ''),
    projectId: String(item?.projectId || ''),
    title: String(item?.title || ''),
    content: String(item?.content || ''),
    sourcePath: String(item?.sourcePath || ''),
    confidence: String(item?.confidence || ''),
    epistemicType: String(item?.epistemicType || ''),
    systemDecision: String(item?.systemVerification?.decision || ''),
    sourceMaterialIds: (Array.isArray(item?.systemVerification?.sourceMaterialIds) ? item.systemVerification.sourceMaterialIds : []).map(String).sort(),
    updatedAt: String(item?.updatedAt || item?.createdAt || ''),
  })).sort((a, b) => a.id.localeCompare(b.id));
  const projectState = (Array.isArray(projects) ? projects : []).map((project) => ({
    id: String(project?.id || ''),
    name: String(project?.name || ''),
    status: String(project?.status || ''),
    publishedAt: String(project?.publishedAt || ''),
    studentIds: (Array.isArray(project?.studentIds) ? project.studentIds : []).map(String).sort(),
    evidence: (Array.isArray(project?.studentEvidence) ? project.studentEvidence : []).map((item) => ({
      id: String(item?.id || ''),
      studentId: String(item?.studentId || ''),
      status: String(item?.status || ''),
      ability: String(item?.ability || ''),
      observation: String(item?.observation || ''),
      sourcePath: String(item?.sourcePath || ''),
      updatedAt: String(item?.updatedAt || item?.createdAt || ''),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })).sort((a, b) => a.id.localeCompare(b.id));
  return crypto.createHash('sha1').update(stableJson({ candidates, projects: projectState })).digest('hex');
}

function growthProjectFingerprint(projects = []) {
  return growthSourceFingerprint({ candidates: [] }, projects);
}

function changedGrowthProjectStudentIds(previousProjects = [], nextProjects = []) {
  const previousById = new Map((Array.isArray(previousProjects) ? previousProjects : []).map((project) => [String(project?.id || ''), project]));
  const nextById = new Map((Array.isArray(nextProjects) ? nextProjects : []).map((project) => [String(project?.id || ''), project]));
  const affected = new Set();
  for (const projectId of new Set([...previousById.keys(), ...nextById.keys()])) {
    const previous = previousById.get(projectId);
    const next = nextById.get(projectId);
    if (growthProjectFingerprint(previous ? [previous] : []) === growthProjectFingerprint(next ? [next] : [])) continue;
    for (const project of [previous, next].filter(Boolean)) {
      for (const studentId of Array.isArray(project.studentIds) ? project.studentIds : []) affected.add(String(studentId));
      for (const evidence of Array.isArray(project.studentEvidence) ? project.studentEvidence : []) {
        if (evidence?.studentId) affected.add(String(evidence.studentId));
      }
    }
  }
  return [...affected].filter(Boolean);
}

function growthIndexNeedsRebuild(index, fingerprint) {
  if (!index || Number(index.version || 0) < 2) return true;
  return String(index.sourceFingerprint || '') !== String(fingerprint || '');
}

function meaningfulReportText(content) {
  return String(content || '')
    .replace(/^---[\s\S]*?---\s*/u, '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/^[-|: ]+$/u.test(line))
    .filter((line) => !/^(待补充|暂无|本周期无实质变化)[。.]?$/u.test(line))
    .join('\n')
    .trim();
}

function legacyReportCandidate(options = {}) {
  const content = meaningfulReportText(options.content);
  if (content.length < 24) return null;
  const sourcePath = String(options.sourcePath || '');
  const reportId = String(options.reportId || path.basename(sourcePath, path.extname(sourcePath)) || 'report');
  const studentId = String(options.studentId || '');
  const id = `legacy-report-${crypto.createHash('sha1').update(`${studentId}|${sourcePath}`).digest('hex').slice(0, 14)}`;
  return {
    id,
    title: `历史学情报告待核验：${String(options.title || reportId)}`,
    content: content.slice(0, 1600),
    sourcePath,
    status: 'pending',
    confidence: '历史报告待核验',
    ability: '待标注',
    migratedFrom: sourcePath,
    migrationKind: 'learning_report_candidate',
  };
}

module.exports = {
  changedGrowthProjectStudentIds,
  growthIndexNeedsRebuild,
  growthProjectFingerprint,
  growthSourceFingerprint,
  legacyReportCandidate,
  meaningfulReportText,
  stableJson,
};
