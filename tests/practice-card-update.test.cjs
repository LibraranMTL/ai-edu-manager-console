'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createPracticeCards } = require('../electron/practice-cards.cjs');
const plan = { subject: '数学', range: 'auto', minutes: 10, template: 'clear', focus: '', autoEnabled: false };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'practice-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = { fingerprint: 'fp1', calls: 0, reject: false, hook: null };
  const api = createPracticeCards({ resolveStudentDir: async () => root,
    snapshot: async () => ({ inputFingerprint: state.fingerprint, profile: { grade: '12' }, languageProfile: { primaryLanguage: 'en', supportLanguage: 'zh-CN' }, learningSignals: ['已确认的方程复习需求'], confirmedGrowthSignals: [], sourceIds: ['test-report'] }),
    generate: async ({ schema }) => {
      state.calls++;
      if (schema.required.includes('passed')) { if (state.hook) await state.hook(); return { passed: !state.reject, languagePassed: true, reason: 'Evidence, solution and language checked' }; }
      return { title: `Practice ${state.fingerprint}`, subject: '数学', knowledgePoint: 'Linear equation', rationale: 'Confirmed review need', minutes: 10, sourceRefs: ['E0'], prompt: 'Solve 2x+3=7', hint: 'Subtract 3', answer: 'x=2', explanation: 'Subtract 3 and divide by 2' };
    } });
  await api.savePlan('student', plan);
  return { api, state, read: async () => JSON.parse(await fs.readFile(path.join(root, 'practice-cards', 'store.json'), 'utf8')) };
}
test('new evidence replaces only unstarted next card, preserving started card and attempts', async t => {
  const { api, state, read } = await fixture(t);
  const first = (await api.generate('student')).card;
  await api.start('student', first.id);
  const frozen = (await read()).cards[0];
  state.fingerprint = 'fp2'; const next = (await api.generate('student')).card;
  await assert.rejects(api.start('student', next.id), /先完成/);
  state.fingerprint = 'fp3'; const updated = await api.generate('student');
  assert.match(updated.message, /替换/);
  const store = await read();
  assert.deepEqual(store.cards.find(card => card.id === first.id), frozen);
  assert.equal(store.cards.find(card => card.id === next.id).status, 'superseded');
  assert.equal(store.cards.filter(card => ['started', 'ready'].includes(card.status)).length, 2);
  assert.deepEqual(store.attempts, []);
  const dashboard = await api.dashboard('student');
  assert.equal(dashboard.current.id, first.id);
  assert.equal(dashboard.history.find(card => card.id === updated.card.id).status, 'ready');
  assert.equal(updated.card.content.answer, undefined);
  await api.submit('student', first.id, { attemptId: 'attempt-update-1', answer: 'x=2', difficulty: 'right', confidence: 3 });
  await api.start('student', updated.card.id);
  assert.equal((await api.dashboard('student')).current.id, updated.card.id);
  assert.equal((await read()).attempts[0].evidenceStatus, 'pending_review');
});
test('plan changes replace ready card while completed card and attempts stay frozen', async t => {
  const { api, read } = await fixture(t);
  const first = (await api.generate('student')).card;
  await api.start('student', first.id);
  await api.submit('student', first.id, { attemptId: 'attempt-update-2', answer: 'x=2', difficulty: 'right', confidence: 3 });
  const frozen = await read();
  await api.savePlan('student', { ...plan, focus: '复习移项' });
  const next = (await api.generate('student')).card;
  await api.savePlan('student', { ...plan, focus: '复习检验' });
  const updated = (await api.generate('student')).card;
  const store = await read();
  assert.deepEqual(store.cards.find(card => card.id === first.id), frozen.cards[0]);
  assert.deepEqual(store.attempts, frozen.attempts);
  assert.equal(store.cards.find(card => card.id === next.id).status, 'superseded');
  assert.equal((await api.dashboard('student')).current.id, updated.id);
});
test('failed review and changing evidence retain the prior ready card', async t => {
  const { api, state, read } = await fixture(t);
  await api.generate('student'); const frozen = (await read()).cards;
  state.fingerprint = 'fp2'; state.reject = true;
  await assert.rejects(api.generate('student'), /复核未通过/);
  assert.deepEqual((await read()).cards, frozen);
  state.reject = false; state.hook = () => { state.fingerprint = 'fp3'; };
  await assert.rejects(api.generate('student'), /证据已变化/);
  assert.deepEqual((await read()).cards, frozen);
});
test('reuse and concurrent generation give explicit feedback without extra model calls', async t => {
  const { api, state } = await fixture(t);
  const [a, b] = await Promise.all([api.generate('student'), api.generate('student')]);
  assert.equal(a.card.id, b.card.id); assert.equal(state.calls, 2);
  const reused = await api.generate('student');
  assert.equal(reused.unchanged, true); assert.match(reused.message, /复用/); assert.equal(state.calls, 2);
});
test('a ready card started during review is never superseded', async t => {
  const { api, state, read } = await fixture(t);
  const first = (await api.generate('student')).card;
  state.fingerprint = 'fp2'; state.hook = () => api.start('student', first.id);
  const next = (await api.generate('student')).card;
  assert.equal((await read()).cards.find(card => card.id === first.id).status, 'started');
  assert.equal(next.status, 'ready');
  assert.equal((await api.dashboard('student')).current.id, first.id);
});
test('legacy occupied capacity has a visible result and does not call the model', async t => {
  const { api, state, read } = await fixture(t);
  const first = (await api.generate('student')).card;
  await api.start('student', first.id);
  state.fingerprint = 'fp2'; const next = (await api.generate('student')).card;
  // Emulate an old store with multiple started cards, without modifying real student data.
  const store = await read(); store.cards.find(card => card.id === next.id).status = 'started';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'practice-capacity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'practice-cards'));
  await fs.writeFile(path.join(root, 'practice-cards', 'store.json'), JSON.stringify(store));
  const capacityApi = createPracticeCards({ resolveStudentDir: async () => root, snapshot: async () => ({ inputFingerprint: 'fp3', languageProfile: { primaryLanguage: 'en', supportLanguage: 'zh-CN' } }), generate: async () => { throw Error('must not call model'); } });
  const result = await capacityApi.generate('student');
  assert.equal(result.unchanged, true); assert.match(result.message, /不再堆积/); assert.equal(state.calls, 4);
});
