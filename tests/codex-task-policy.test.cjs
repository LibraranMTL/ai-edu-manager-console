const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DRAFT_END,
  DRAFT_START,
  extractHostValidatedDraft,
  hostValidatedDraftPrompt,
  isHostValidatedDraftTask,
  validateHostDraftShape,
} = require('../electron/codex-task-policy.cjs');

test('learning reports use no-tool host-validated Codex generation', () => {
  assert.equal(isHostValidatedDraftTask({ kind: 'learning_profile' }), true);
  assert.equal(isHostValidatedDraftTask({ kind: 'student_digest' }), false);
  const prompt = hostValidatedDraftPrompt('生成报告');
  assert.match(prompt, /不要调用任何工具/);
  assert.match(prompt, new RegExp(DRAFT_START));
  assert.match(prompt, new RegExp(DRAFT_END));
});

test('extracts only the last complete marked draft and validates identity and sections', () => {
  const report = `---\nstudent_id: s1\ngrowth_fingerprint: fp1\nstatus: generated\n---\n\n## 一句话画像\n资料不足。\n\n## 依据来源\n无。\n`;
  const output = `noise\n${DRAFT_START}\n---\nbad\n${DRAFT_END}\n${DRAFT_START}\n${report}${DRAFT_END}\ntrailer`;
  const extracted = extractHostValidatedDraft(output);
  assert.equal(extracted, report);
  const task = { input: { studentId: 's1', growthFingerprint: 'fp1' }, expectedOutput: { requiredSections: ['一句话画像', '依据来源'] } };
  assert.equal(validateHostDraftShape(task, extracted).ok, true);
  assert.equal(validateHostDraftShape({ ...task, input: { ...task.input, studentId: 's2' } }, extracted).ok, false);
  assert.equal(extractHostValidatedDraft(`${DRAFT_START}\n${report}`), '');
});
