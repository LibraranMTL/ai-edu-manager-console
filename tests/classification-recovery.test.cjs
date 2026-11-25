'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createRoutingAgent } = require('../electron/smart-inbox-agent.cjs');
const { classificationRoute } = require('../electron/agent-invocation-service.cjs');
const input = () => ({ context: { studentId: 'a', projects: [{ id: 'project-a', categories: [] }] }, text: 'project-a', executionId: 'run' });
const answer = i => ({ candidates: [{ studentId: i.context.studentId, type: 'project', id: i.context.projects[0].id, categoryId: '', score: .98, evidence: i.context.projects[0].id, reason: '' }], sensitive: false, conflict: false, reason: '' });
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'classification-recovery-'));
  t.after(() => fs.rm(dir, { force: true, recursive: true }));
  const executable = path.join(dir, 'cli'); await fs.writeFile(executable, 'synthetic executable');
  return { dir, executable, select: async (_, id) => id === 'workbuddy' ? { id, runtime: { cliPath: executable }, authScope: 'desktop' } : { id: id || 'codex', executable, authScope: 'default' } };
}
test('fallback is opt-in and scoped to the other qualified provider', () => {
  assert.deepEqual(classificationRoute({ agentTool: 'workbuddy' }).providers, ['workbuddy']);
  assert.deepEqual(classificationRoute({ agentTool: 'workbuddy', classificationFallback: { enabled: true, providerId: 'hermes' } }).providers, ['workbuddy']);
  assert.deepEqual(classificationRoute({ agentTool: 'workbuddy', classificationFallback: { enabled: true, providerId: 'codex', version: 1 } }), { providers: ['workbuddy', 'codex'], policyVersion: 1 });
});
test('native executable updates behind a fixed cmd wrapper invalidate runtime qualification', async t => {
  const f = await fixture(t), wrapper = path.join(f.dir, 'codex.cmd');
  await fs.writeFile(wrapper, `@ECHO off\nSET "CODEX_EXE=${f.executable}"\n`);
  const { routingRuntimeHash } = require('../electron/smart-inbox-agent.cjs');
  const adapter = { id: 'codex', executable: wrapper }, before = await routingRuntimeHash(adapter);
  await fs.writeFile(f.executable, 'updated native binary');
  assert.notEqual(await routingRuntimeHash(adapter), before);
});
test('20 documents share one failed primary qualification and one fallback qualification', async t => {
  const f = await fixture(t), calls = [], stages = [];
  const agent = createRoutingAgent({ select: f.select, route: () => ({ providers: ['workbuddy', 'codex'], policyVersion: 2 }),
    run: async (adapter, value) => { calls.push([adapter.id, value.context.studentId]);
      if (adapter.id === 'workbuddy') throw Object.assign(Error('Authentication required'), { code: 'AUTHENTICATION_REQUIRED' }); return answer(value); } });
  await Promise.all(Array.from({ length: 20 }, (_, i) => agent.classify({ ...input(), executionId: String(i), onStage: async s => stages.push(s) })));
  assert.equal(calls.filter(c => c[0] === 'workbuddy').length, 1);
  assert.equal(calls.filter(c => c[0] === 'codex' && c[1] === 'synthetic-student').length, 1);
  assert.equal(calls.filter(c => c[1] === 'a').length, 20);
  assert.equal(stages.filter(s => s.stage === 'possibly_sent' && s.providerId === 'workbuddy').length, 0);
});
for (const code of ['agent_timeout', 'ECONNRESET']) test(`confirmed stopped read-only classification failure ${code} uses the next provider`, async t => {
  const f = await fixture(t), calls = [];
  const agent = createRoutingAgent({ select: f.select, route: () => ({ providers: ['workbuddy', 'codex'], policyVersion: 1 }),
    run: async (a, value) => { calls.push(a.id); if (a.id === 'workbuddy' && value.context.studentId !== 'synthetic-student') throw Object.assign(Error(code), { code, stopConfirmed: true }); return answer(value); } });
  const result = await agent.classify(input());
  assert.equal(result.candidates[0].id, 'project-a');
  assert.deepEqual(calls, ['workbuddy', 'workbuddy', 'codex', 'codex']);
});
for (const code of ['AUTHENTICATION_REQUIRED', 'SENSITIVE_REVIEW_REQUIRED']) test(`sent primary policy failure ${code} never calls fallback`, async t => {
  const f = await fixture(t), calls = [];
  const agent = createRoutingAgent({ select: f.select, route: () => ({ providers: ['workbuddy', 'codex'], policyVersion: 1 }),
    run: async (a, value) => { calls.push(a.id); if (value.context.studentId !== 'synthetic-student') throw Object.assign(Error(code), { code, stopConfirmed: true }); return answer(value); } });
  await assert.rejects(agent.classify(input()), e => e.code === (code === 'SENSITIVE_REVIEW_REQUIRED' ? code : 'execution_unknown'));
  assert.deepEqual(calls, ['workbuddy', 'workbuddy']);
});
test('failed durable possibly-sent checkpoint prevents transmission', async t => {
  const f = await fixture(t); let calls = 0;
  const agent = createRoutingAgent({ select: f.select, run: async (_, i) => { calls++; return answer(i); } });
  await assert.rejects(agent.classify({ ...input(), onStage: async s => { if (s.stage === 'possibly_sent') throw Error('disk full'); } }), /disk full/);
  assert.equal(calls, 1);
});
test('qualification persists failure code and separates authentication contexts and generations', async t => {
  const f = await fixture(t), records = new Map(); let scope = 'test', generation = 0, calls = 0;
  const options = { select: () => ({ id: 'codex', executable: f.executable, authScope: scope, authVersion: generation }),
    qualification: { load: (_, key) => records.get(key), save: async (_, key, value) => { records.set(key, value); } },
    run: async (_, i) => { calls++; if (scope === 'test') throw Object.assign(Error('login'), { code: 'AUTHENTICATION_REQUIRED' }); return answer(i); } };
  await assert.rejects(createRoutingAgent(options).classify(input()), { code: 'AUTHENTICATION_REQUIRED' });
  await assert.rejects(createRoutingAgent(options).classify(input()), { code: 'AUTHENTICATION_REQUIRED' }); assert.equal(calls, 1);
  scope = 'production'; await createRoutingAgent(options).classify(input()); assert.equal(calls, 3);
  await createRoutingAgent(options).classify(input()); assert.equal(calls, 4);
  generation++; await createRoutingAgent(options).classify(input()); assert.equal(calls, 6);
});
test('route revocation during qualification prevents student data and fallback', async t => {
  const f = await fixture(t); let calls = 0;
  const agent = createRoutingAgent({ select: f.select, route: () => ({ providers: ['workbuddy', 'codex'], policyVersion: 1 }),
    validateRoute: () => { throw Object.assign(Error('revoked'), { code: 'ROUTE_CHANGED' }); },
    run: async (_, i) => { calls++; return answer(i); } });
  await assert.rejects(agent.classify(input()), { code: 'ROUTE_CHANGED' }); assert.equal(calls, 1);
});
test('both providers failing keeps structured attempts and never sends student bytes', async t => {
  const f = await fixture(t);
  const agent = createRoutingAgent({ select: f.select, route: () => ({ providers: ['workbuddy', 'codex'], policyVersion: 1 }),
    run: async (_, i) => { assert.equal(i.context.studentId, 'synthetic-student'); throw Object.assign(Error('login'), { code: 'AUTHENTICATION_REQUIRED' }); } });
  await assert.rejects(agent.classify(input()), e => e.blockReason.code === 'NO_FALLBACK_AGENT' && e.blockReason.attempts.length === 2);
});

test('a completed invalid classification is durably distinguished from an unknown remote execution', async t => {
  const f = await fixture(t), stages = [];
  const agent = createRoutingAgent({ select: f.select, run: async (_, value) => value.context.studentId === 'synthetic-student'
    ? answer(value) : { ...answer(value), candidates: [{ ...answer(value).candidates[0], evidence: 'invented' }] } });
  await assert.rejects(agent.classify({ ...input(), onStage: async stage => stages.push(stage) }), error =>
    error.code === 'execution_unknown' && error.blockReason.resultReceived === true);
  assert.equal(stages.at(-1).stage, 'result_rejected');
});

test('failure saving a valid result is not labeled as a rejected model result', async t => {
  const f = await fixture(t), stages = [];
  const agent = createRoutingAgent({ select: f.select, run: async (_, value) => answer(value) });
  await assert.rejects(agent.classify({ ...input(), onStage: async stage => stages.push(stage),
    onResult: async () => { throw Error('disk full'); } }), /disk full/);
  assert.equal(stages.some(stage => stage.stage === 'result_rejected'), false);
});
