function activeStudentCount(students = []) {
  return (Array.isArray(students) ? students : []).filter((student) => student?.archived !== true && String(student?.status || '').toLowerCase() !== 'archived').length;
}

function studentSeatDecision(input = {}) {
  const limit = Number(input.maxActiveStudents || 0);
  const currentCount = activeStudentCount(input.currentStudents);
  const nextCount = activeStudentCount(input.nextStudents);
  const allowed = !limit || nextCount <= limit || nextCount <= currentCount;
  return { allowed, limit, currentCount, nextCount };
}

module.exports = { activeStudentCount, studentSeatDecision };
