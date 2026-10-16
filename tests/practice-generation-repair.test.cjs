'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPracticeCards } = require('../electron/practice-cards.cjs');

const candidate = { title: 'Divisibility practice', subject: '数学', knowledgePoint: '整除', rationale: 'Recorded review goal', minutes: 10, sourceRefs: ['E0'], prompt: 'For integer n, prove 8 divides 8(n+1)^2.', hint: 'Consider two consecutive integers.', answer: '(n+1)^2 is an integer.', explanation: 'The expression is eight times an integer.' };
const rejected = { passed: false, languagePassed: true, reason: '提示与 8(n+1)^2 的结构不一致，应考虑平方是否为整数。' };
const passed = { passed: true, languagePassed: true, reason: 'Hint, solution and language independently checked.' };
async function fixture(t, handler) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'practice-repair-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = { fingerprint: 'fp1', calls: [], controller: new AbortController() };
  const api = createPracticeCards({ resolveStudentDir: async id => path.join(root, id),
    snapshot: async () => ({ profile: { grade: '12' }, inputFingerprint: state.fingerprint, languageProfile: { primaryLanguage: 'en', supportLanguage: 'zh-CN' }, learningSignals: ['Confirmed divisibility review need'], confirmedGrowthSignals: [], sourceIds: ['synthetic-report'] }),
    generate: async request => { state.calls.push(request); return handler(request, state.calls.length, state, api); } });
  const read = async () => JSON.parse(await fs.readFile(path.join(root, 'student', 'practice-cards', 'store.json'), 'utf8'));
  return { api, state, read };
}

test('reviewed hint mismatch is repaired once and the complete new candidate independently rechecked', async t => {
  const { api, state, read } = await fixture(t, (request, call) => {
    if (call === 1) return candidate;
    if (call === 2) return rejected;
    if (call === 3) {
      assert.deepEqual(request.input.previousContent, candidate);
      assert.equal(request.input.reviewFeedback, rejected.reason);
      assert.equal(request.input.languagePolicy.instructionLanguage, 'en');
      return { ...candidate, hint: 'What can you say about the square of an integer?' };
    }
    assert.equal(request.input.content.hint, 'What can you say about the square of an integer?');
    assert.equal(request.input.reviewFeedback, undefined);
    assert.equal(request.input.previousContent, undefined);
    return passed;
  });
  const [result, duplicate] = await Promise.all([api.generate('student'), api.generate('student')]);
  assert.equal(result.card.id, duplicate.card.id);
  assert.equal(state.calls.length, 4);
  assert.equal(result.card.review.repairCount, 1);
  assert.equal(result.card.content.answer, undefined);
  assert.equal(result.card.generationChecks, undefined);
  assert.match(result.message, /自动修正/);
  const store = await read();
  assert.deepEqual(store.cards[0].generationChecks, [rejected, passed]);
  assert.equal(store.attempts.length, 0);
  assert.equal(store.records.length, 1);
  await api.generate('student');
  assert.equal(state.calls.length, 4, 'view/reuse does not restart generation');
});

test('persistent rejection stops at four calls, preserves old cards and releases the pending request', async t => {
  let failing = false;
  const { api, state, read } = await fixture(t, request => request.schema.required.includes('passed') ? (failing ? rejected : passed) : candidate);
  await api.generate('student');
  const oldCards = (await read()).cards;
  state.fingerprint = 'fp2'; failing = true;
  await assert.rejects(api.generate('student'), /自动修正一次.*原卡片已保留/);
  assert.equal(state.calls.length, 6);
  assert.deepEqual((await read()).cards, oldCards);
  assert.equal((await read()).records[0].status, 'failed');
  failing = false;
  await api.generate('student');
  assert.equal(state.calls.length, 8);
});

test('a language-only rejection is repaired, not silently accepted', async t => {
  const { api, state } = await fixture(t, (request, call) => request.schema.required.includes('passed') ? (call === 2 ? { ...rejected, passed: true, languagePassed: false } : passed) : candidate);
  const result = await api.generate('student');
  assert.equal(state.calls.length, 4);
  assert.equal(result.card.languagePolicy.instructionLanguage, 'en');
});

test('missing review fields and transport errors do not trigger paid repair retries', async t => {
  for (const failure of [{ passed: true, reason: 'missing language check' }, new Error('Agent 登录失效')]) {
    const { api, state, read } = await fixture(t, (request, call) => { if (call === 1) return candidate; if (failure instanceof Error) throw failure; return failure; });
    await assert.rejects(api.generate('student'), /复核未通过|登录失效/);
    assert.equal(state.calls.length, 2);
    assert.equal((await read()).cards.length, 0);
  }
});

test('repair cannot introduce invented references or switch away from the chosen subject', async t => {
  for (const invalid of [{ ...candidate, sourceRefs: ['invented'] }, { ...candidate, subject: '英语' }]) {
    const { api, state, read } = await fixture(t, (_request, call) => call === 1 ? candidate : call === 2 ? rejected : invalid);
    await api.savePlan('student', { subject: '数学', range: 'auto', minutes: 10, template: 'clear', focus: '', autoEnabled: false });
    await assert.rejects(api.generate('student'), /引用依据无效|学科与练习计划不一致/);
    assert.equal(state.calls.length, 3);
    assert.equal((await read()).cards.length, 0);
  }
});

test('changed evidence stops before repair, rather than spending on a stale candidate', async t => {
  const { api, state } = await fixture(t, (_request, call, state) => { if (call === 1) return candidate; state.fingerprint = 'fp2'; return rejected; });
  await assert.rejects(api.generate('student'), /证据已变化/);
  assert.equal(state.calls.length, 2);
});

test('cancellation stops before repair and also prevents saving a late passing verdict', async t => {
  for (const verdict of [rejected, passed]) {
    const { api, state, read } = await fixture(t, (_request, call, state) => { if (call === 1) return candidate; state.controller.abort(); return verdict; });
    await assert.rejects(api.generate('student', 'manual', state.controller.signal), /已取消/);
    assert.equal(state.calls.length, 2);
    assert.equal((await read()).cards.length, 0);
  }
});
