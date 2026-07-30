function text(value) {
  return String(value || '').trim();
}

function activeAssignments(binding, nodeId) {
  return (Array.isArray(binding?.roleAssignments) ? binding.roleAssignments : [])
    .filter((assignment) => (
      !assignment?.revokedAt
      && text(assignment.nodeId) === text(nodeId)
      && text(assignment.studentId)
    ));
}

function importedProjectLocalStudentIds(input = {}) {
  const publication = input.publication || {};
  const state = input.state || {};
  const localNodeId = text(state?.node?.nodeId);
  const localStudentIds = new Set((Array.isArray(input.localStudents) ? input.localStudents : [])
    .map((student) => text(student?.id))
    .filter(Boolean));
  const resolved = new Set((Array.isArray(publication.targetStudentIds) ? publication.targetStudentIds : [])
    .map(text)
    .filter((studentId) => localStudentIds.has(studentId)));

  // Legacy project publications were sometimes created with the sender-side
  // student ID. A collaboration binding already contains the authoritative
  // peer-to-local student mapping, so use its local assignments as the
  // compatibility source. One binding represents one shared student scope in
  // the current protocol; multiple local assignments remain explicitly
  // bounded to that same binding.
  for (const binding of Array.isArray(state.bindings) ? state.bindings : []) {
    if (
      binding?.status !== 'active'
      || binding.revokedAt
      || !localNodeId
      || !(binding.participantNodeIds || []).map(text).includes(localNodeId)
      || !(binding.participantNodeIds || []).map(text).includes(text(publication.sourceNodeId))
    ) continue;
    for (const assignment of activeAssignments(binding, localNodeId)) {
      if (localStudentIds.has(text(assignment.studentId))) resolved.add(text(assignment.studentId));
    }
  }
  return [...resolved];
}

function mergeProjectStudentScope(project = {}, studentIds = [], localStudents = []) {
  const allowed = new Set((Array.isArray(localStudents) ? localStudents : [])
    .map((student) => text(student?.id))
    .filter(Boolean));
  const mergedIds = [...new Set([
    ...(Array.isArray(project.studentIds) ? project.studentIds : []),
    ...(Array.isArray(studentIds) ? studentIds : []),
  ].map(text).filter((studentId) => allowed.has(studentId)))];
  const names = new Map((Array.isArray(localStudents) ? localStudents : [])
    .map((student) => [text(student?.id), text(student?.name)]));
  return {
    ...project,
    studentIds: mergedIds,
    studentNames: mergedIds.map((studentId) => names.get(studentId)).filter(Boolean),
  };
}

module.exports = {
  importedProjectLocalStudentIds,
  mergeProjectStudentScope,
};
