const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const { createLearningStateStore } = require('../electron/learning-state-store.cjs');

test('Android student and teacher collaboration HTTP adapters are exposed by the 0.23 host', () => {
  for (const route of [
    '/api/student-session/learning-status',
    '/api/student-session/knowledge-growth/weeks',
    'comprehensive-report',
  ]) assert.match(main, new RegExp(route));
  assert.ok(main.includes('teacher-session\\/students'));
  for (const capability of ['learningStatus', 'projectComprehensiveReport', 'weeklyKnowledgeGrowthImage']) {
    assert.match(main, new RegExp(`${capability}: true`));
  }
  assert.match(main, /projectReportMarkdown\(report\)/);
  assert.match(main, /weeklyKnowledgeGrowthJson\(String\(student\.id\)\)/);
});

test('teacher-assisted and student learning status share one store and stable submission semantics', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-collaboration-http-'));
  const store = createLearningStateStore({ dbPath: path.join(folder, 'learning.sqlite3') });
  try {
    const teacher = store.submitCheckIn({ studentId: 's1', actorRole: 'teacher', actorId: 't1' },
      { kind: 'weekly', note: '今日总体状态：一般\n当前在学内容：电路' }, 'submission-1');
    assert.equal(teacher.sourceCategory, 'teacher_assisted');
    assert.equal(store.submitCheckIn({ studentId: 's1', actorRole: 'teacher', actorId: 't1' },
      { kind: 'weekly', note: '今日总体状态：一般\n当前在学内容：电路' }, 'submission-1').checkInId, teacher.checkInId);
    assert.throws(() => store.submitCheckIn({ studentId: 's1', actorRole: 'teacher', actorId: 't1' },
      { kind: 'weekly', note: 'changed' }, 'submission-1'), /同一提交号/);
    const student = store.submitCheckIn({ studentId: 's1', actorRole: 'student', actorId: 'd1' },
      { kind: 'weekly', note: '今日总体状态：顺利' }, 'submission-2');
    assert.equal(student.sourceCategory, 'student_self_report');
  } finally {
    store.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
