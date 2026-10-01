const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(path.join(__dirname, '../src/main.tsx'), 'utf8');
const start = source.indexOf('  const saveProjectStudentEvidence = ');
const handler = source.slice(start, source.indexOf('\n  const ', start + 1));
const deferred = () => { let resolve; const promise = new Promise((a) => { resolve = a; }); return { promise, resolve }; };
const preview = JSON.stringify({ ok: true, needsSourceConfirmation: true, bindingId: 'b1', sourcesSummary: 'm1 / v1 / SHA-256 synthetic' });
const saved = JSON.stringify({ ok: true, project: { id: 'p1' }, evidence: { status: 'verified' }, message: 'confirmed' });
function ui(api, confirm = () => true) {
  const state = { Projects: [{ id: 'p1' }, { id: 'other', note: 'preserved' }], ProjectStudentEvidenceFeedbacks: {}, ProjectStudentEvidenceDrafts: {} };
  const calls = [];
  const context = vm.createContext({ selectedProjectId: 'p1', selectedId: 's1', projectPageMode: 'detail', projectStudentFilterId: 'all',
    projectStudentEvidenceBusyId: '', projectEvidenceRequest: { current: 0 }, projectEvidenceScope: { current: JSON.stringify(['p1', 's1', 'detail', 'all']) },
    projectEvidenceInFlight: { current: false }, projectStudentEvidenceFeedbacks: {},
    selectedProject: { id: 'p1', studentEvidence: [{ studentId: 's1', sourcePaths: ['old.txt'] }] },
    projectStudentEvidenceDrafts: { s1: { ability: 'ability', observation: 'observation', status: 'draft', sourcePathsText: 'new.txt' } },
    projectCompletionOpen: false, bridge: () => api,
    window: { confirm: (text) => { calls.push(text); return confirm(text); }, setTimeout() {} },
    showActionNotice: (...args) => calls.push(args), prepareProjectCompletion() {} });
  for (const key of ['Projects', 'ProjectStudentEvidenceBusyId', 'ProjectStudentEvidenceFeedbacks', 'ProjectStudentEvidenceDrafts', 'ProjectMessage']) {
    context[`set${key}`] = (value) => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  }
  vm.runInContext(`${stripTypeScriptTypes(handler)}\nglobalThis.save = saveProjectStudentEvidence;`, context);
  function navigate(projectId, studentId = 's1') {
    context.selectedProjectId = projectId; context.selectedId = studentId;
    context.projectStudentEvidenceBusyId = state.ProjectStudentEvidenceBusyId;
    context.projectStudentEvidenceFeedbacks = state.ProjectStudentEvidenceFeedbacks;
    const startScope = source.indexOf('  const nextProjectEvidenceScope = ');
    const endScope = source.indexOf('  const [projectStudentEvidencePasteOpen', startScope);
    vm.runInContext(`{ ${source.slice(startScope, endScope)} }`, context);
  }
  return { context, state, calls, navigate };
}

test('actual UI previews and confirms the same payload/binding, preserving unrelated projects', async () => {
  const sent = []; const f = ui({ updateProjectStudentEvidenceAsync: async (...args) => { sent.push(args); return args[3] ? saved : preview; } });
  await f.context.save('s1');
  assert.equal(sent.length, 2); assert.deepEqual(sent[1].slice(0, 3), sent[0]); assert.equal(sent[1][3], 'b1');
  assert.equal(JSON.parse(sent[0][2]).sourcePaths[0], 'new.txt');
  assert.match(f.calls[0], /v1/); assert.equal(f.state.ProjectStudentEvidenceDrafts.s1.status, 'verified');
  assert.equal(f.state.Projects[1].note, 'preserved'); assert.equal(f.context.projectEvidenceInFlight.current, false);
});

test('cancelled source confirmation does not send a commit or change saved evidence status', async () => {
  let count = 0; const f = ui({ updateProjectStudentEvidenceAsync: async () => { count++; return preview; } }, () => false);
  await f.context.save('s1'); assert.equal(count, 1); assert.equal(f.state.ProjectStudentEvidenceDrafts.s1, undefined);
  assert.match(f.state.ProjectStudentEvidenceFeedbacks.s1.message, /已取消/); assert.equal(f.state.ProjectStudentEvidenceBusyId, '');
});

test('switching student or project and returning cannot revive an earlier preview or confirmation', async () => {
  for (const stage of ['preview', 'commit']) {
    const pending = deferred(); const sent = [];
    const f = ui({ updateProjectStudentEvidenceAsync: (...args) => { sent.push(args); return stage === 'preview' || args[3] ? pending.promise : Promise.resolve(preview); } });
    const saving = f.context.save('s1'); await new Promise(setImmediate);
    f.navigate('p2', 's2'); f.navigate('p1', 's1');
    pending.resolve(stage === 'preview' ? preview : saved); await saving;
    assert.equal(f.state.ProjectStudentEvidenceDrafts.s1, undefined);
    assert.equal(f.state.ProjectMessage, undefined); assert.equal(f.state.ProjectStudentEvidenceBusyId, '');
    assert.equal(sent.length, stage === 'preview' ? 1 : 2);
  }
});

test('double click before rerender cannot prepare twice and errors release the busy state', async () => {
  let count = 0; const pending = deferred(); const f = ui({ updateProjectStudentEvidenceAsync: () => { count++; return pending.promise; } });
  const first = f.context.save('s1'); await f.context.save('s1'); assert.equal(count, 1);
  pending.resolve(JSON.stringify({ ok: false, code: 'evidence_changed', message: '来源变化' })); await first;
  assert.equal(f.state.ProjectStudentEvidenceFeedbacks.s1.ok, false);
  assert.equal(f.context.projectEvidenceInFlight.current, false); assert.equal(f.state.ProjectStudentEvidenceBusyId, '');
});

test('legacy synchronous bridge remains usable and a missing bridge is an explicit error', async () => {
  const legacy = ui({ updateProjectStudentEvidence: () => saved }); await legacy.context.save('s1');
  assert.equal(legacy.state.ProjectStudentEvidenceDrafts.s1.status, 'verified');
  const missing = ui({}); await missing.context.save('s1');
  assert.equal(missing.state.ProjectStudentEvidenceFeedbacks.s1.ok, false);
});
