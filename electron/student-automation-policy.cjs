'use strict';
function studentActivity(student = {}) {
  if (['active','paused','inactive'].includes(student.activityStatus)) return student.activityStatus;
  if (['paused','inactive'].includes(student.status)) return student.status;
  return student.active === false ? 'inactive' : 'active';
}
function studentAutomaticTasksPaused(student) {
  if (!student) return true;
  if (student.archived === true || student.status === 'archived') return true;
  if (studentActivity(student) === 'inactive') return true;
  return student.pauseAutomaticTasksWhenInactive !== false && studentActivity(student) === 'paused';
}
function studentTaskCardsSuppressed(student) {
  if (!student) return true;
  return student.archived === true || student.status === 'archived' || studentActivity(student) === 'inactive';
}
function inactiveStudentTaskCardRetirable(task) {
  if (task?.sourceType !== 'student') return false;
  if (['running','waiting_result','reviewing'].includes(String(task.status || ''))) return false;
  if (['practice_attempt_review','collaboration_assignment'].includes(String(task.kind || ''))) return false;
  return String(task.trigger || '') !== 'manual';
}
function automaticStudentTaskBlocked(task, student) {
  // User-submitted homework is not a periodic job; never strand a saved answer.
  return task?.sourceType === 'student' && task.kind !== 'practice_attempt_review' && studentAutomaticTasksPaused(student);
}
module.exports = {studentActivity, studentAutomaticTasksPaused, studentTaskCardsSuppressed, inactiveStudentTaskCardRetirable, automaticStudentTaskBlocked};
