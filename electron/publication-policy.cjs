'use strict';

function normalizeAudience(input, students, currentStudentId) {
  const value = input || { type: 'students', studentIds: [currentStudentId] };
  if (!['all', 'grade', 'students'].includes(value.type)) throw Error('请选择有效的学生范围');
  const studentIds = [...new Set((Array.isArray(value.studentIds) ? value.studentIds : []).map(String))];
  const grade = String(value.grade || '').trim();
  if (value.type === 'students' && (!studentIds.length || studentIds.some(id => !students.some(s => String(s.id) === id)))) throw Error('请至少选择一名本机学生，不能分配到其他主机的学生');
  if (value.type === 'grade' && (!grade || !students.some(s => String(s.grade || '') === grade))) throw Error('请选择已有学生的年级');
  return { type: value.type, studentIds: value.type === 'students' ? studentIds : [], grade: value.type === 'grade' ? grade : '' };
}
function audienceAllows(audience, student) {
  return !!audience && (audience.type === 'all' || (audience.type === 'grade' && String(student.grade || '') === audience.grade) || (audience.type === 'students' && audience.studentIds.includes(String(student.id))));
}
function audienceCount(audience, students) { return students.filter(s => audienceAllows(audience, s)).length; }
module.exports = { normalizeAudience, audienceAllows, audienceCount };
