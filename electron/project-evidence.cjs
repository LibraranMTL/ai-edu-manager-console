function verifiedStudentEvidenceForPublication(project, studentId) {
  const evidence = (project?.studentEvidence || []).find((item) => String(item?.studentId || '') === String(studentId || ''));
  if (!evidence || !['verified', 'published'].includes(String(evidence.status || ''))) return null;
  return evidence;
}

module.exports = { verifiedStudentEvidenceForPublication };
