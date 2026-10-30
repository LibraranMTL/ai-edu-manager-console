'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const modulePath = path.join(__dirname, '../electron/agent-capability-readiness.cjs');
function gate(options) { assert.ok(fs.existsSync(modulePath), 'readiness gate must exist'); return require(modulePath).createDispatchCapabilityGate(options); }
function workBuddyReadiness(options) { assert.ok(fs.existsSync(modulePath)); return require(modulePath).workBuddyDispatchReadiness(options); }
const turn = () => new Promise(resolve => setImmediate(resolve));
const request = (providers = ['codex'], configRevision = 1) => ({ providers, configRevision, profileId: 'digest' });

test('invalidation releases probe slots even when the provider ignores cancellation', async () => {
  let calls=0; const g=gate({probe:async id=>{calls++; if(id==='llm-api')return {state:'available'};return new Promise(()=>{});}});
  try{g.ensureReady(request(['codex','workbuddy']));await turn();assert.equal(calls,2);
    g.invalidate('codex');g.invalidate('workbuddy');g.ensureReady(request(['llm-api']));await turn();await turn();
    assert.equal(g.ensureReady(request(['llm-api'])).decision,'dispatch');
  }finally{g.close();}
});
test('cold cache waits and twenty callers share one probe; hot cache does not probe', async () => {
  let calls = 0, finish; const g = gate({ probe: () => { calls++; return new Promise(r => finish = r); } });
  try { for(let i=0;i<20;i++) assert.equal(g.ensureReady(request()).decision, 'wait'); await turn(); assert.equal(calls,1);
    finish({ state:'available' }); await turn(); assert.equal(g.ensureReady(request()).decision,'dispatch'); assert.equal(calls,1);
  } finally { g.close(); }
});
test('probe exception does not cache a confirmed negative; retry can recover', async () => {
  let now = 0, calls = 0; const g = gate({ now: () => now, probe: async () => { if (++calls === 1) throw Error('timeout'); return {state:'available'}; } });
  try { g.ensureReady(request()); await turn(); const wait=g.ensureReady(request()); assert.equal(wait.decision,'wait'); assert.equal(wait.retryAt,15000);
    assert.equal(wait.reasons[0].reasonCode, 'probe_error'); assert.equal(wait.reasons[0].lastError, 'timeout');
    now=15000; g.ensureReady(request()); await turn(); assert.equal(g.ensureReady(request()).decision,'dispatch');
  } finally { g.close(); }
});
test('slow provider does not block unrelated ready task; probe concurrency bounded', async () => {
  let active=0,max=0; const finishes={};const g=gate({probe:id=>{active++;max=Math.max(max,active);return new Promise(r=>finishes[id]=v=>{active--;r(v);});}});
  try { g.ensureReady(request(['workbuddy']));g.ensureReady(request(['codex']));g.ensureReady(request(['llm-api']));await turn();assert.equal(max,2);
    finishes.codex({state:'available'});await turn();assert.equal(g.ensureReady(request()).decision,'dispatch');assert.equal(g.ensureReady(request(['workbuddy'])).decision,'wait');
  } finally {g.close();}
});
test('a refreshing earlier provider cannot hide a later fresh available provider unless locked', async () => {
  const finishes = {};
  const g = gate({ probe: id => new Promise(resolve => { finishes[id] = resolve; }) });
  try {
    assert.equal(g.ensureReady(request(['provider-a'])).decision, 'wait');
    assert.equal(g.ensureReady(request(['provider-b'])).decision, 'wait');
    await turn();
    finishes['provider-b']({ state: 'available', capability: { id: 'provider-b' } });
    await turn();
    const automatic = g.ensureReady(request(['provider-a', 'provider-b']));
    assert.equal(automatic.decision, 'dispatch');
    assert.equal(automatic.providerId, 'provider-b');
    const locked = g.ensureReady({ ...request(['provider-a', 'provider-b']), lockedProviderId: 'provider-a' });
    assert.equal(locked.decision, 'wait');
  } finally { g.close(); }
});
test('all definite negatives permit fallback; unknown exhaustion never does', async () => {
  let now=0;const g=gate({now:()=>now,probe:async id=>({state:id==='codex'?'unknown':'unavailable',reasonCode:'probe_timeout'})});
  try {g.ensureReady(request(['workbuddy']));await turn();assert.equal(g.ensureReady(request(['workbuddy'])).decision,'manual_fallback');
    for(let i=0;i<6;i++){g.ensureReady(request());await turn(); const result=g.ensureReady(request()); if(i<5){assert.equal(result.decision,'wait'); now=result.retryAt;}}
    assert.equal(g.ensureReady(request()).decision,'environment_help');
  } finally {g.close();}
});
test('configuration generation discards stale probe; locked provider does not fall back', async () => {
  const finishes=[];const g=gate({probe:()=>new Promise(r=>finishes.push(r))});
  try {g.ensureReady(request());await turn();g.ensureReady(request(['codex'],2));await turn();finishes[0]({state:'available'});await turn();
    assert.equal(g.ensureReady(request(['codex'],2)).decision,'wait'); finishes[1]({state:'unavailable'});await turn();
    assert.equal(g.ensureReady({...request(['codex','workbuddy'],2),lockedProviderId:'codex'}).decision,'manual_fallback');
  } finally {g.close();}
});
test('caller cancellation does not cancel shared probe and close ignores late callbacks', async()=>{
  let finish,changes=0;const g=gate({probe:()=>new Promise(r=>finish=r),onChange:()=>changes++});
  const c=new AbortController();g.ensureReady({...request(),signal:c.signal});g.ensureReady(request());await turn();c.abort();finish({state:'available'});await turn();assert.equal(g.ensureReady(request()).decision,'dispatch');assert.equal(changes,1);g.close();
});

test('WorkBuddy CLI remains dispatch eligible when the desktop IPC endpoint is absent', () => {
  const result = workBuddyReadiness({
    adapter: { runtime: { available: true, cliPath: 'codebuddy.js', exePath: 'WorkBuddy.exe',
      configDir: 'isolated-profile/.workbuddy', authVersion: 7, desktopSessionAvailable: false } },
    profileId: 'digest_host_mediated.v1',
    savedQualification: null,
    now: 1000,
  });
  assert.equal(result.state, 'available');
  assert.equal(result.reasonCode, 'cli_ready_task_boundary_verification');
  assert.equal(result.capability.available, true);
  assert.equal(result.capability.authorized, false);
});

test('WorkBuddy readiness exposes a matching persisted qualification without requiring desktop IPC', () => {
  const runtime = { available: true, cliPath: 'codebuddy.js', exePath: 'WorkBuddy.exe',
    configDir: 'isolated-profile/.workbuddy', authVersion: 7, desktopSessionAvailable: false };
  const result = workBuddyReadiness({ adapter: { runtime }, profileId: 'digest_host_mediated.v1', now: 1000,
    savedQualification: { ready: true, expiresAt: new Date(5000).toISOString(),
      authScope: JSON.stringify([runtime.configDir, runtime.authVersion]) } });
  assert.equal(result.state, 'available');
  assert.equal(result.reasonCode, 'qualification_cached');
  assert.equal(result.capability.authorized, true);
});
