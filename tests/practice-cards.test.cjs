'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createPracticeCards } = require('../electron/practice-cards.cjs');
const plan = { subject: '数学', range: 'week', minutes: 10, template: 'clear', focus: '一次方程', autoEnabled: false };
test('practice content uses evidence and independent review, hides answers until explicit submission, and does not confirm mastery', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'practice-card-'));
  let fingerprint = 'fp1', calls = 0, reject = false;
  const create = () => createPracticeCards({ resolveStudentDir: async id => { if (!['a', 'b'].includes(id)) throw Error('student invalid'); return path.join(root, id); },
    snapshot: async id => ({ profile: { grade: '八年级' }, inputFingerprint: fingerprint, learningSignals: id === 'a' ? ['正式报告：方程移项需复习'] : [], confirmedGrowthSignals: [], sourceIds: ['report:a:正式报告'] }),
    generate: async ({ schema }) => { calls++; return schema.required.includes('passed') ? { passed: !reject, reason: '单一知识点，可解，依据适配' } : { title: '移项练习', subject: '数学', knowledgePoint: '一次方程', rationale: '复习报告所示需求，不推断掌握', minutes: 10, sourceRefs: ['E0'], prompt: '解方程 2x+3=7', hint: '两边先减 3', answer: 'x=2', explanation: '两边减 3 再除以 2' }; } });
  let api = create();
  try {
    await api.savePlan('a', plan); await api.savePlan('b', plan); await assert.rejects(api.generate('b'), /证据/);
    const [first, duplicate] = await Promise.all([api.generate('a'), api.generate('a')]); assert.equal(first.card.id, duplicate.card.id); assert.equal(calls, 2); assert.equal(first.card.content.answer, undefined);
    assert.equal((await api.generate('a')).unchanged, true);
    await assert.rejects(api.start('b', first.card.id));
    await api.start('a', first.card.id); fingerprint = 'fp2'; await api.generate('a');
    assert.equal((await api.dashboard('a')).current.id, first.card.id);
    const input = { attemptId: 'attempt-123', answer: 'x=2', difficulty: 'right', confidence: 3 };
    const submitted = await api.submit('a', first.card.id, input); assert.equal(submitted.card.content.answer, 'x=2'); assert.equal(submitted.attempt.evidenceStatus, 'pending_review'); assert.equal(submitted.attempt.masteryConclusion, null);
    assert.equal((await api.submit('a', first.card.id, input)).duplicate, true); await assert.rejects(api.submit('a', first.card.id, { ...input, answer: 'different' }));
    api = create(); assert.equal((await api.dashboard('a')).history.length, 2); assert.equal((await api.dashboard('b')).history.length, 0);
    fingerprint = 'fp3'; reject = true; await assert.rejects(api.generate('a'), /复核未通过/); assert.equal((await api.dashboard('a')).history.length, 2);
    await assert.rejects(api.savePlan('a', { ...plan, minutes: 60 }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
