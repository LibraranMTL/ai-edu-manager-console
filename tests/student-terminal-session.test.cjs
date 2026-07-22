const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createStudentLoginId,
  ensureStudentLoginIds,
  isValidStudentLoginId,
  migrateTerminalDevice,
  normalizeStudentLoginId,
  studentLoginQrPayload,
} = require('../electron/student-terminal-session.cjs');

test('student login IDs are readable, checksummed and normalized', () => {
  const id = createStudentLoginId(() => Buffer.from([0, 1, 2, 3]));
  assert.equal(id.startsWith('S-'), true);
  assert.equal(isValidStudentLoginId(id), true);
  assert.equal(normalizeStudentLoginId(id.replaceAll('-', '').toLowerCase()), id);
  assert.equal(isValidStudentLoginId(`${id.slice(0, -1)}Z`), id.endsWith('Z'));
});

test('existing students receive stable unique login IDs without changing internal IDs', () => {
  const ids = [
    createStudentLoginId(() => Buffer.from([0, 1, 2, 3])),
    createStudentLoginId(() => Buffer.from([4, 5, 6, 7])),
    createStudentLoginId(() => Buffer.from([8, 9, 10, 11])),
  ];
  let cursor = 0;
  const first = ensureStudentLoginIds([{ id: '中文-id', name: '学生甲' }, { id: 's2', name: '学生乙' }], {
    createId: () => ids[cursor++],
    now: '2026-07-22T00:00:00.000Z',
  });
  assert.equal(first.students[0].id, '中文-id');
  assert.notEqual(first.students[0].loginId, first.students[1].loginId);
  const second = ensureStudentLoginIds(first.students, { createId: () => { throw new Error('should not regenerate'); } });
  assert.equal(second.changed, false);
  assert.deepEqual(second.students, first.students);
});

test('legacy single-student devices become personal and multi-student devices become shared', () => {
  const personal = migrateTerminalDevice({ id: 'd1', allowedStudentIds: ['s1'] }, ['s1', 's2']);
  assert.equal(personal.terminalMode, 'personal');
  assert.equal(personal.boundStudentId, 's1');
  assert.deepEqual(personal.allowedStudentIds, ['s1']);

  const shared = migrateTerminalDevice({ id: 'd2', allowedStudentIds: ['s1', 's2'] }, ['s1', 's2']);
  assert.equal(shared.terminalMode, 'shared');
  assert.equal(shared.boundStudentId, '');
  assert.deepEqual(shared.allowedStudentIds, []);
  assert.equal(shared.allowedAllStudents, true);
});

test('student login QR payload contains only the structured login ID', () => {
  const id = createStudentLoginId(() => Buffer.from([5, 6, 7, 8]));
  assert.deepEqual(JSON.parse(studentLoginQrPayload(id)), { type: 'AI_EDU_STUDENT_LOGIN', version: 1, loginId: id });
});
