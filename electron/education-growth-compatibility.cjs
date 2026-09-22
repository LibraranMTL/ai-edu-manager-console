const crypto = require('crypto');
const { KnowledgeEngineContractError } = require('./knowledge-engine-contract.cjs');
const {
  EDUCATION_DOMAIN_PROTOCOL_VERSION,
  validateEducationClaim,
} = require('./education-domain-protocol.cjs');
const { normalizeEducationObject } = require('./education-domain-schemas.cjs');
const { buildEducationClaimHistoryView } = require('./education-governance.cjs');

const COMPATIBILITY_SCHEMA = 'edu-manager.education-growth-compatibility.v1';
const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LEGACY_STATUS_TO_CLAIM_STATUS = Object.freeze({
  pending: 'candidate',
  watching: 'candidate',
  confirmed: 'candidate',
  rejected: 'rejected',
});

function stableLegacyId(prefix, legacyId) {
  const original = String(legacyId || '').trim();
  if (PORTABLE_ID.test(original)) return { id: original, legacyId: original, remapped: false };
  const digest = crypto.createHash('sha256').update(original || 'missing').digest('hex').slice(0, 20);
  return { id: `${prefix}-${digest}`, legacyId: original, remapped: true };
}

function portableStudentIdentity(studentId) {
  return stableLegacyId('student', studentId);
}

function sourceUriFromLegacyPath(value, fallbackId) {
  const original = String(value || '').trim();
  if (!original) return `legacy-review://growth-evidence/${encodeURIComponent(fallbackId)}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(original)) return original;
  const normalized = original.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return encodeURI(`file:///${normalized}`);
  if (normalized.startsWith('/')) return encodeURI(`file://${normalized}`);
  return `legacy-path:///${encodeURI(normalized.replace(/^\.\//, ''))}`;
}

function evidenceSemantics(item) {
  const sourceType = String(item.sourceType || '');
  const actorRole = String(item.actorRole || '');
  if (sourceType && actorRole) return { sourceType, actorRole, inferred: false };
  const generatedBy = String(item.generatedBy || '').toLocaleLowerCase('zh-CN');
  const confidence = String(item.confidence || '').toLocaleLowerCase('zh-CN');
  if (/agent|ai|模型|智能体/.test(generatedBy)) return { sourceType: 'agent_inference', actorRole: 'agent', inferred: true };
  if (/教师|teacher/.test(confidence) || /教师|teacher/.test(generatedBy)) return { sourceType: 'teacher_assessment', actorRole: 'teacher', inferred: true };
  if (item.sourcePath || item.projectId || item.projectName) return { sourceType: 'learning_artifact', actorRole: 'student', inferred: true };
  return { sourceType: 'system_record', actorRole: 'system', inferred: true };
}

function reviewAudit(item) {
  const explicit = item.review && typeof item.review === 'object' ? item.review : {};
  const reviewerRole = String(explicit.reviewerRole || item.reviewerRole || '');
  const reviewerId = String(explicit.reviewerId || item.reviewerId || '');
  const reviewedAt = String(explicit.reviewedAt || item.reviewedAt || '');
  const complete = ['student', 'parent', 'teacher', 'administrator'].includes(reviewerRole) && reviewerId && reviewedAt;
  return {
    complete: Boolean(complete),
    review: {
      status: complete ? 'approved' : 'pending',
      reviewerRole,
      reviewerId,
      reviewedAt,
    },
  };
}

function mapLegacyEvidenceItem(item = {}, options = {}) {
  const studentId = String(options.studentId || item.studentId || '').trim();
  const legacyStudentId = String(options.legacyStudentId || studentId).trim();
  if (!studentId) throw new KnowledgeEngineContractError('MISSING_STUDENT_ID', '成长证据兼容映射必须指定 studentId。');
  if (item.studentId && ![studentId, legacyStudentId].includes(String(item.studentId))) {
    throw new KnowledgeEngineContractError('CROSS_STUDENT_EVIDENCE', '成长证据 studentId 与目标学生不一致。', { expected: legacyStudentId, actual: item.studentId });
  }
  const idMapping = stableLegacyId('growth-evidence', item.id);
  const legacyStatus = String(item.status || 'pending');
  const audit = reviewAudit(item);
  const source = evidenceSemantics(item);
  const originalSourcePath = String(item.sourcePath || '');
  const sourceUri = sourceUriFromLegacyPath(originalSourcePath, idMapping.id);
  const issues = [];
  if (idMapping.remapped) issues.push({ code: 'LEGACY_ID_REMAPPED', severity: 'warning', legacyId: idMapping.legacyId, protocolId: idMapping.id });
  if (!originalSourcePath) issues.push({ code: 'LEGACY_PRIMARY_SOURCE_MISSING', severity: 'warning', evidenceId: idMapping.id });
  if (source.inferred) issues.push({ code: 'LEGACY_SOURCE_SEMANTICS_INFERRED', severity: 'info', evidenceId: idMapping.id, sourceType: source.sourceType, actorRole: source.actorRole });
  if (legacyStatus === 'confirmed' && !audit.complete) issues.push({ code: 'LEGACY_REVIEW_AUDIT_MISSING', severity: 'warning', evidenceId: idMapping.id });

  const status = legacyStatus === 'confirmed' && audit.complete ? 'confirmed' : LEGACY_STATUS_TO_CLAIM_STATUS[legacyStatus] || 'candidate';
  const observedAt = String(item.observedAt || item.updatedAt || item.createdAt || '');
  const claimInput = {
    id: idMapping.id,
    subjectId: studentId,
    predicate: 'education.growth_evidence',
    value: String(item.content || item.title || ''),
    status,
    epistemicType: 'observation',
    scope: item.projectId || item.projectName ? 'context' : observedAt ? 'period' : 'event',
    validFrom: observedAt,
    confidence: String(item.confidence || 'legacy-unknown'),
    evidence: [{
      id: `${idMapping.id}:source:0`,
      sourceUri,
      sourceType: source.sourceType,
      actorRole: source.actorRole,
      excerpt: String(item.content || item.title || ''),
      observedAt,
      originalSourcePath,
    }],
    review: audit.review,
    counterEvidence: [],
    counterEvidenceReviewed: false,
    createdAt: String(item.createdAt || observedAt || new Date(0).toISOString()),
    updatedAt: String(item.updatedAt || item.createdAt || observedAt || new Date(0).toISOString()),
    legacy: {
      sourceSchema: String(options.sourceSchema || ''),
      legacyId: idMapping.legacyId,
      legacyStatus,
      ability: String(item.ability || '待标注'),
      projectId: String(item.projectId || ''),
      projectName: String(item.projectName || ''),
      migratedFrom: String(item.migratedFrom || ''),
      note: String(item.note || ''),
      readOnlyCompatibilityView: true,
    },
    supersededBy: String(item.supersededBy || ''),
  };
  const validation = validateEducationClaim(claimInput);
  const reviewEvents = (Array.isArray(item.reviewHistory) ? item.reviewHistory : []).map((entry, index) => ({
    id: `${idMapping.id}:review:${index + 1}`,
    claimId: idMapping.id,
    type: 'review_decision',
    actorRole: String(entry.reviewerRole || 'administrator'),
    actorId: String(entry.reviewerId || 'local-user'),
    reason: String(entry.note || `status ${entry.from || 'unknown'} -> ${entry.to || entry.status || 'unknown'}`),
    occurredAt: String(entry.reviewedAt || entry.at || new Date(0).toISOString()),
    status: String(entry.to || entry.status || 'submitted'),
  }));
  const historyView = buildEducationClaimHistoryView({
    claim: validation.claim || { id: idMapping.id, status },
    revisions: Array.isArray(item.revisions) ? item.revisions : [],
    events: reviewEvents,
  });
  const domainEvidence = normalizeEducationObject('GrowthEvidence', {
    id: idMapping.id,
    studentId,
    title: String(item.title || item.content || idMapping.id),
    status,
    sourceUri,
    sourcePath: originalSourcePath,
    review: audit.review,
  });
  return { claim: validation.claim, validation, issues, idMapping, historyView, domainEvidence };
}

function mapGrowthEvidenceReviewToEducationClaims({ student, review = {}, sourcePath = '' } = {}) {
  const legacyStudentId = String(student?.id || '').trim();
  if (!legacyStudentId) throw new KnowledgeEngineContractError('MISSING_STUDENT_ID', '成长证据审核映射必须指定 student.id。');
  const studentIdentity = portableStudentIdentity(legacyStudentId);
  const studentId = studentIdentity.id;
  const items = Array.isArray(review.candidates) ? review.candidates : [];
  // A student's local review file can outlive an ID migration. Rebind only
  // when the record carries the same explicit student name; a mismatched
  // named record remains a cross-student error and is never silently merged.
  const studentName = String(student?.name || '').trim();
  const mapped = items.map((item) => {
    const itemStudentId = String(item?.studentId || '').trim();
    const itemStudentName = String(item?.studentName || '').trim();
    const compatibleLegacyId = itemStudentId && itemStudentId !== legacyStudentId && studentName && itemStudentName === studentName
      ? itemStudentId
      : legacyStudentId;
    return mapLegacyEvidenceItem({ ...item, studentId: itemStudentId && itemStudentId !== legacyStudentId && itemStudentName === studentName ? studentId : item.studentId }, {
      studentId,
      legacyStudentId: compatibleLegacyId,
      sourceSchema: 'edu-manager.growth-evidence-review.v1',
    });
  });
  const reviewQueue = mapped.filter((item) => item.issues.some((entry) => entry.code === 'LEGACY_REVIEW_AUDIT_MISSING')).map((item) => ({
    evidenceId: item.claim?.id || item.idMapping.id,
    legacyStatus: 'confirmed',
    currentProtocolStatus: 'candidate',
    reason: '历史 confirmed 记录缺少完整人工审核身份与时间，需由当前用户重新确认、继续观察或驳回。',
    requiredFields: ['reviewerRole', 'reviewerId', 'reviewedAt'],
    actions: ['confirm', 'watch', 'reject'],
  }));
  return {
    schema: COMPATIBILITY_SCHEMA,
    protocolVersion: EDUCATION_DOMAIN_PROTOCOL_VERSION,
    readOnly: true,
    source: { schema: 'edu-manager.growth-evidence-review.v1', path: String(sourcePath || ''), version: Number(review.version || 1), updatedAt: String(review.updatedAt || '') },
    profile: { id: studentId, legacyId: legacyStudentId, idRemapped: studentIdentity.remapped, legacyType: 'Student', type: 'person', domain: 'education', displayName: String(student?.name || '') },
    domainStudent: normalizeEducationObject('Student', { id: studentId, name: String(student?.name || studentId), grade: String(student?.grade || ''), rootPath: String(student?.rootPath || '') }),
    claims: mapped.map((item) => item.claim),
    growthEvidence: mapped.map((item) => item.domainEvidence),
    historyViews: mapped.map((item) => item.historyView),
    reviewQueue,
    issues: mapped.flatMap((item) => item.issues),
    validation: mapped.map((item) => ({ id: item.claim?.id || '', ok: item.validation.ok, errors: item.validation.errors, warnings: item.validation.warnings })),
    idMappings: [
      ...(studentIdentity.remapped ? [{ ...studentIdentity, type: 'Student' }] : []),
      ...mapped.filter((item) => item.idMapping.remapped).map((item) => item.idMapping),
    ],
    summary: {
      total: mapped.length,
      confirmed: mapped.filter((item) => item.claim?.status === 'confirmed').length,
      candidate: mapped.filter((item) => item.claim?.status === 'candidate').length,
      rejected: mapped.filter((item) => item.claim?.status === 'rejected').length,
      requiresLegacyReviewAudit: mapped.filter((item) => item.issues.some((issue) => issue.code === 'LEGACY_REVIEW_AUDIT_MISSING')).length,
    },
  };
}

function mapGrowthIndexV2ToDomainSnapshot({ student, index = {}, sourcePath = '' } = {}) {
  const legacyStudentId = String(student?.id || index.studentId || '').trim();
  if (!legacyStudentId) throw new KnowledgeEngineContractError('MISSING_STUDENT_ID', 'growth-index 映射必须指定 student.id 或 index.studentId。');
  if (index.studentId && String(index.studentId) !== legacyStudentId) {
    throw new KnowledgeEngineContractError('CROSS_STUDENT_INDEX', 'growth-index studentId 与目标学生不一致。', { expected: legacyStudentId, actual: index.studentId });
  }
  const evidenceView = mapGrowthEvidenceReviewToEducationClaims({
    student: { id: legacyStudentId, name: student?.name || index.studentName || '' },
    review: { version: index.version || 2, updatedAt: index.updatedAt || '', candidates: Array.isArray(index.evidence) ? index.evidence : [] },
    sourcePath,
  });
  const projects = (Array.isArray(index.projects) ? index.projects : []).map((item) => ({
    schema: 'edu-manager.learning-project.v1',
    protocolVersion: EDUCATION_DOMAIN_PROTOCOL_VERSION,
    id: String(item.projectId || ''),
    legacyType: 'LearningProject',
    type: 'Project',
    name: String(item.projectName || ''),
    status: String(item.status || ''),
    contributionId: String(item.contributionId || ''),
    evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.map(String) : [],
    publishedAt: String(item.publishedAt || ''),
    readOnlyCompatibilityView: true,
  }));
  const abilityViews = (Array.isArray(index.abilities) ? index.abilities : []).map((item) => ({
    abilityId: String(item.abilityId || ''),
    name: String(item.name || ''),
    maturity: String(item.maturity || ''),
    trend: String(item.trend || ''),
    confidence: String(item.confidence || ''),
    evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.map(String) : [],
    derived: true,
    publishableClaim: false,
    reason: 'growth-index ability aggregation is a derived view and must not become a formal education Claim without review',
  }));
  return {
    ...evidenceView,
    source: { schema: String(index.schema || 'edu-manager.growth-model.v2'), path: String(sourcePath || ''), version: Number(index.version || 2), updatedAt: String(index.updatedAt || '') },
    projects,
    abilityViews,
    originalSourceFiles: index.sourceFiles && typeof index.sourceFiles === 'object' ? { ...index.sourceFiles } : {},
    migration: index.migration && typeof index.migration === 'object' ? { ...index.migration } : {},
  };
}

module.exports = {
  COMPATIBILITY_SCHEMA,
  LEGACY_STATUS_TO_CLAIM_STATUS,
  mapGrowthEvidenceReviewToEducationClaims,
  mapGrowthIndexV2ToDomainSnapshot,
  mapLegacyEvidenceItem,
  sourceUriFromLegacyPath,
  stableLegacyId,
  portableStudentIdentity,
};
