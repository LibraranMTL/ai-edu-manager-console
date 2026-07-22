const { parseAgentResultInput } = require('./agent-result-envelope.cjs');

function cleanText(value) { return String(value || '').trim(); }
function unique(values) { return [...new Set(values.map(cleanText).filter(Boolean))]; }
function evidenceSourcePaths(evidence) {
  const direct = Array.isArray(evidence?.sourcePaths) ? evidence.sourcePaths : [];
  const files = Array.isArray(evidence?.sourceFiles) ? evidence.sourceFiles : [];
  const localized = cleanText(evidence?.['来源路径'] || evidence?.['来源文件']).split(/[、,，;；]/);
  return unique([...direct, ...localized, ...files.map((item) => (typeof item === 'string' ? item : item?.path))]);
}
function evidenceLabel(evidence) {
  return cleanText(evidence?.competencyName || evidence?.skillName || evidence?.competencyArea || evidence?.ability || '待标注能力');
}
function conservativeConfidence(records, summary) {
  const summaryValue = cleanText(summary?.overallConfidence).toLowerCase();
  if (['high', 'medium', 'low'].includes(summaryValue)) return summaryValue;
  const values = records.map((item) => cleanText(item?.confidence).toLowerCase()).filter((item) => ['high', 'medium', 'low'].includes(item));
  if (values.includes('low')) return 'low';
  if (values.includes('medium')) return 'medium';
  return values.includes('high') ? 'high' : '';
}
function normalizeNestedStudent(student) {
  const records = Array.isArray(student?.evidence) ? student.evidence.filter((item) => item && typeof item === 'object') : [];
  const summary = student?.summary && typeof student.summary === 'object' ? student.summary : {};
  const ability = unique(records.map(evidenceLabel)).join('、');
  const detail = records.map((item, index) => {
    const gap = cleanText(item.evidenceGaps);
    return `${index + 1}. ${evidenceLabel(item)}：${cleanText(item.observation) || '待补充具体表现'}${gap ? `\n   待补证据：${gap}` : ''}`;
  }).join('\n');
  return {
    studentId: cleanText(student?.studentId || student?.student_id || student?.id || student?.['学生ID'] || student?.['学生编号']),
    studentName: cleanText(student?.studentName || student?.student_name || student?.name || student?.['学生姓名'] || student?.['学生']),
    ability: ability || '待标注能力',
    observation: [cleanText(summary.overallObservation), detail].filter(Boolean).join('\n\n'),
    confidence: conservativeConfidence(records, summary),
    sourcePaths: unique(records.flatMap(evidenceSourcePaths)),
    status: 'draft', evidenceCount: records.length,
  };
}
function normalizeFlatStudent(student) {
  return {
    studentId: cleanText(student?.studentId || student?.student_id || student?.id),
    studentName: cleanText(student?.studentName || student?.student_name || student?.name),
    ability: cleanText(student?.ability || student?.competency || student?.competencyName || student?.skillName || student?.['能力维度']),
    observation: cleanText(student?.observation || student?.performance || student?.detail || student?.content || student?.['具体表现']),
    confidence: cleanText(student?.confidence || student?.confidenceLevel),
    sourcePaths: evidenceSourcePaths(student),
    status: 'draft', evidenceCount: 1,
  };
}
function normalizeProjectStudentEvidencePayload(payload, options = {}) {
  let envelope;
  try {
    envelope = parseAgentResultInput(payload, { kind: 'project_student_evidence', projectId: options.projectId, retainRaw: options.retainRaw });
  } catch (error) {
    return { ok: false, message: `个人证据建议无法解析：${error.message}` };
  }
  const projectId = cleanText(envelope.identity.projectId);
  const students = envelope.items.map((item) => item.payload);
  const nested = students.some((student) => Array.isArray(student?.evidence));
  const suggestions = students.map((student) => Array.isArray(student?.evidence) ? normalizeNestedStudent(student) : normalizeFlatStudent(student)).filter((student) => student.studentId || student.studentName);
  if (!projectId) return { ok: false, message: '个人证据建议缺少 projectId。', envelope };
  if (!suggestions.length) {
    const detail = envelope.invalidItems.map((item) => item.reason).join('；');
    return { ok: false, message: detail ? `没有可导入的学生证据：${detail}` : '个人证据建议中没有可识别的学生记录。', envelope };
  }
  return {
    ok: true, projectId, suggestions,
    sourceFormat: nested ? 'qclaw_nested' : 'edu_manager_standard',
    evidenceCount: suggestions.reduce((sum, item) => sum + Number(item.evidenceCount || 0), 0),
    partial: envelope.partial, invalidItems: envelope.invalidItems,
    idempotencyKey: envelope.idempotencyKey, envelope,
  };
}

module.exports = { normalizeProjectStudentEvidencePayload };
