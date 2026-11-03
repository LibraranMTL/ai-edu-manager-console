'use strict';

const {
  displayAvailability, displayChangeReason, displayChanges, displayDisclaimer, displayGap, displayNextAction,
  displaySourceType, displayStatement, displayStatus, friendlyMaterialTitle, reportTypeLabel,
} = require('./project-report-presentation.cjs');

function text(value) { return String(value ?? '').trim(); }
function assertReader(reader, snapshot) {
  if (!reader || !['admin', 'student', 'teacher'].includes(text(reader.role))) throw Object.assign(new Error('报告读者身份无效。'), { code: 'subject_scope_forbidden' });
  if (text(reader.authorizationVersion) !== text(snapshot.authorizationVersion)) throw Object.assign(new Error('报告授权版本已变化。'), { code: 'subject_scope_forbidden' });
  if (reader.role === 'student' && !(snapshot.members || []).some((item) => text(item.studentId) === text(reader.readerId))) {
    throw Object.assign(new Error('读者不在项目成员范围内。'), { code: 'subject_scope_forbidden' });
  }
}
function safeLocator(locator = {}) {
  return Object.fromEntries(['kind', 'logicalPath', 'page', 'row', 'sheet', 'timecode', 'region']
    .filter((key) => locator[key] !== undefined).map((key) => [key, locator[key]]));
}
function evidenceVisible(reader, evidence) {
  if (!(evidence.audience || []).includes(text(reader.role))) return false;
  if (!text(evidence.studentId) || reader.role === 'admin') return true;
  return (Array.isArray(reader.allowedStudentIds) ? reader.allowedStudentIds : []).map(text).includes(text(evidence.studentId));
}
function personalVisible(reader, item) {
  if (reader.role === 'admin') return true;
  return (Array.isArray(reader.allowedStudentIds) ? reader.allowedStudentIds : []).map(text).includes(text(item.studentId));
}
function citationProjection(reader, snapshot, citationId) {
  assertReader(reader, snapshot);
  const evidence = (snapshot.evidence || []).find((item) => text(item.citationId) === text(citationId));
  if (!evidence || !evidenceVisible(reader, evidence)) throw Object.assign(new Error('当前读者无权查看此依据。'), { code: 'subject_scope_forbidden' });
  return { citationId: evidence.citationId, sourceType: evidence.sourceType, sourceId: evidence.sourceId,
    revision: evidence.revision, contentHash: evidence.contentHash, availability: evidence.availability,
    title: evidence.title || '', locator: safeLocator(evidence.locator),
    displayTitle: friendlyMaterialTitle(evidence.title || evidence.sourceId),
    displaySourceType: displaySourceType(evidence.sourceType), displayAvailability: displayAvailability(evidence.availability) };
}
function projectReportProjection(reader, snapshot, report, version = {}) {
  assertReader(reader, snapshot);
  const visibleEvidence = new Set((snapshot.evidence || []).filter((item) => evidenceVisible(reader, item)).map((item) => item.evidenceId));
  const claims = (report.claims || []).filter((item) => (item.audience || []).includes(text(reader.role))
    && (item.kind === 'suggestion' || (item.evidenceIds || []).every((id) => visibleEvidence.has(id))))
    .map((item) => ({ ...item, displayStatement: displayStatement(item.statement), displayStatus: displayStatus(item.status) }));
  const visibleClaimKeys = new Set(claims.map((item) => item.claimKey));
  const presentedClaims = new Map(claims.map((item) => [item.claimKey, item]));
  const personalContributions = (report.personalContributions || []).filter((item) => personalVisible(reader, item)
    && (item.evidenceIds || []).every((id) => visibleEvidence.has(id)));
  const sections = (report.sections || []).map((section) => ({ ...section,
    items: (section.items || []).filter((item) => visibleClaimKeys.has(item.claimKey))
      .map((item) => presentedClaims.get(item.claimKey) || item) }));
  const visibleChange = (item) => (item.audience || []).includes(text(reader.role))
    && (item.evidenceIds || []).every((id) => visibleEvidence.has(id));
  const changes = Object.fromEntries(['added', 'revised', 'withdrawn', 'unchanged'].map((key) => [key,
    (report.changes?.[key] || []).filter(visibleChange).map(({ audience: _audience, ...item }) => ({
      ...item, displayStatement: displayStatement(item.statement), displayStatus: displayStatus(item.status),
      displayReason: displayChangeReason(item.reason),
    }))]));
  const summary = structuredClone(report.summary);
  summary.representativeResults = (summary.representativeResults || []).filter((item) => visibleEvidence.has(item.evidenceId))
    .map((item) => ({ ...item, displayTitle: friendlyMaterialTitle(item.title), displayStatement: displayStatement(item.statement) }));
  summary.displayChanges = displayChanges(summary.changes);
  summary.displayNextAction = displayNextAction(summary.nextAction);
  return { projectId: snapshot.projectId, snapshotId: snapshot.snapshotId, versionId: version.versionId || '',
    reportType: report.reportType, asOf: snapshot.asOf, policyVersion: report.policyVersion,
    dataGeneration: Number(version.generation || 0), authorizationVersion: snapshot.authorizationVersion,
    project: structuredClone(snapshot.project), summary, claims: structuredClone(claims), sections: structuredClone(sections), changes,
    gaps: structuredClone(report.gaps || []), personalContributions: structuredClone(personalContributions),
    coverage: structuredClone(snapshot.coverage),
    ...(report.completion ? { completion: structuredClone(report.completion) } : {}),
    disclaimer: report.disclaimer, reportTypeLabel: reportTypeLabel(report.reportType),
    updatedAt: text(version.createdAt || snapshot.asOf), displayGaps: (report.gaps || []).map(displayGap),
    displayDisclaimer: displayDisclaimer(report.disclaimer, report.reportType) };
}

module.exports = { projectReportProjection, citationProjection };

