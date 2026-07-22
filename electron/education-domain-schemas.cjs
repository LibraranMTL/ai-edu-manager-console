const { KnowledgeEngineContractError, assertPortableId } = require('./knowledge-engine-contract.cjs');

const EDUCATION_SCHEMA_VERSION = 'edu-manager.education-domain.v1';

const EDUCATION_SCHEMA_IDS = Object.freeze({
  Student: 'edu-manager.student.v1',
  LearningProject: 'edu-manager.learning-project.v1',
  GrowthEvidence: 'edu-manager.growth-evidence.v1',
  LearningReport: 'edu-manager.learning-report.v1',
  EducationPolicy: 'edu-manager.education-policy.v1',
});

const EDUCATION_OBJECT_SCHEMAS = Object.freeze({
  Student: Object.freeze({
    $id: EDUCATION_SCHEMA_IDS.Student,
    required: Object.freeze(['id', 'name']),
    stableFields: Object.freeze(['id', 'rootPath']),
  }),
  LearningProject: Object.freeze({
    $id: EDUCATION_SCHEMA_IDS.LearningProject,
    required: Object.freeze(['id', 'name', 'studentIds', 'status']),
    stableFields: Object.freeze(['id', 'studentIds', 'workspacePath', 'knowledgeRootPath']),
  }),
  GrowthEvidence: Object.freeze({
    $id: EDUCATION_SCHEMA_IDS.GrowthEvidence,
    required: Object.freeze(['id', 'studentId', 'title', 'status', 'sourceUri']),
    stableFields: Object.freeze(['id', 'studentId', 'sourceUri', 'originalSourcePath']),
  }),
  LearningReport: Object.freeze({
    $id: EDUCATION_SCHEMA_IDS.LearningReport,
    required: Object.freeze(['id', 'studentId', 'reportType', 'status', 'sourceClaimIds']),
    stableFields: Object.freeze(['id', 'studentId', 'filePath']),
  }),
  EducationPolicy: Object.freeze({
    $id: EDUCATION_SCHEMA_IDS.EducationPolicy,
    required: Object.freeze(['id', 'version', 'effectiveAt', 'reviewerRoles']),
    stableFields: Object.freeze(['id', 'version']),
  }),
});

function requiredText(input, field, objectType) {
  const value = String(input?.[field] || '').trim();
  if (!value) throw new KnowledgeEngineContractError('MISSING_DOMAIN_FIELD', `${objectType}.${field} 不能为空。`, { objectType, field });
  return value;
}

function normalizeStringArray(value) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean)));
}

function normalizeEducationObject(objectType, input = {}) {
  const schema = EDUCATION_OBJECT_SCHEMAS[objectType];
  if (!schema) throw new KnowledgeEngineContractError('UNKNOWN_EDUCATION_OBJECT', `不支持的教育对象：${objectType || 'missing'}。`);

  if (objectType === 'Student') {
    return {
      schema: schema.$id,
      protocolVersion: EDUCATION_SCHEMA_VERSION,
      ...input,
      id: assertPortableId(input.id, 'Student.id'),
      name: requiredText(input, 'name', objectType),
      grade: String(input.grade || ''),
      status: String(input.status || 'active'),
      rootPath: String(input.rootPath || ''),
    };
  }

  if (objectType === 'LearningProject') {
    const studentIds = normalizeStringArray(input.studentIds).map((id) => assertPortableId(id, 'LearningProject.studentIds[]'));
    if (!studentIds.length) throw new KnowledgeEngineContractError('MISSING_PROJECT_STUDENT', 'LearningProject.studentIds 至少包含一个学生 ID。');
    return {
      schema: schema.$id,
      protocolVersion: EDUCATION_SCHEMA_VERSION,
      ...input,
      id: assertPortableId(input.id, 'LearningProject.id'),
      name: requiredText(input, 'name', objectType),
      studentIds,
      status: requiredText(input, 'status', objectType),
      workspacePath: String(input.workspacePath || input.projectRootPath || ''),
      knowledgeRootPath: String(input.knowledgeRootPath || ''),
    };
  }

  if (objectType === 'GrowthEvidence') {
    const sourceUri = String(input.sourceUri || input.sourcePath || '').trim();
    if (!sourceUri) throw new KnowledgeEngineContractError('MISSING_SOURCE', 'GrowthEvidence.sourceUri 不能为空。');
    return {
      schema: schema.$id,
      protocolVersion: EDUCATION_SCHEMA_VERSION,
      ...input,
      id: assertPortableId(input.id, 'GrowthEvidence.id'),
      studentId: assertPortableId(input.studentId, 'GrowthEvidence.studentId'),
      title: requiredText(input, 'title', objectType),
      status: requiredText(input, 'status', objectType),
      sourceUri,
      originalSourcePath: String(input.originalSourcePath || input.sourcePath || ''),
      review: input.review && typeof input.review === 'object' ? { ...input.review } : { status: 'pending' },
    };
  }

  if (objectType === 'LearningReport') {
    return {
      schema: schema.$id,
      protocolVersion: EDUCATION_SCHEMA_VERSION,
      ...input,
      id: assertPortableId(input.id, 'LearningReport.id'),
      studentId: assertPortableId(input.studentId, 'LearningReport.studentId'),
      reportType: requiredText(input, 'reportType', objectType),
      status: requiredText(input, 'status', objectType),
      sourceClaimIds: normalizeStringArray(input.sourceClaimIds).map((id) => assertPortableId(id, 'LearningReport.sourceClaimIds[]')),
      filePath: String(input.filePath || ''),
      presentationOnly: input.presentationOnly !== false,
    };
  }

  const reviewerRoles = normalizeStringArray(input.reviewerRoles);
  if (!reviewerRoles.length) throw new KnowledgeEngineContractError('MISSING_REVIEWER_ROLES', 'EducationPolicy.reviewerRoles 不能为空。');
  return {
    schema: schema.$id,
    protocolVersion: EDUCATION_SCHEMA_VERSION,
    ...input,
    id: assertPortableId(input.id, 'EducationPolicy.id'),
    version: requiredText(input, 'version', objectType),
    effectiveAt: requiredText(input, 'effectiveAt', objectType),
    reviewerRoles,
    knowledgeEngine: 'llm-wiki-local',
    minimumDependencyDeployment: true,
  };
}

function validateEducationObject(objectType, input = {}) {
  try {
    return { ok: true, value: normalizeEducationObject(objectType, input), errors: [] };
  } catch (error) {
    return { ok: false, value: null, errors: [{ code: error.code || 'INVALID_EDUCATION_OBJECT', message: error.message, details: error.details || {} }] };
  }
}

module.exports = {
  EDUCATION_OBJECT_SCHEMAS,
  EDUCATION_SCHEMA_IDS,
  EDUCATION_SCHEMA_VERSION,
  normalizeEducationObject,
  validateEducationObject,
};
