const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { verifiedOutput, createCodexResearchSearch } = require('../electron/planning-research.cjs');
test('research refuses a rejected send barrier before spawning any process',async()=>{
 let spawned=0;const search=createCodexResearchSearch({executable:'synthetic',spawnProcess:()=>spawned++,terminateProcess:()=>{}});
 await assert.rejects(search({queryInput:{},beforeExecute:async()=>{throw Error('revoked');}}),/revoked/);assert.equal(spawned,0);
});

const url = 'https://example.edu/admissions';
const output = { query: 'public query', findings: ['fact with source'], limitations: [], sources: [{ url, title: 'Admissions', summary: 'Official page' }] };
const event = { type: 'item.completed', item: { type: 'web_search', action: { type: 'open_page', url }, status: 'completed' } };

test('accepts completed page evidence from both supported CLI event formats', () => {
  assert.equal(verifiedOutput(output, [event]).sources[0].url, url);
  const legacy = { type: 'item.completed', item: { type: 'web_search', action: { type: 'other' }, query: url } };
  assert.equal(verifiedOutput(output, [legacy]).sources.length, 1);
});

test('rejects model-only URLs, search-only events, incomplete opens and partial sources', () => {
  assert.throws(() => verifiedOutput(output, []), /实际打开/);
  assert.throws(() => verifiedOutput(output, [{ ...event, type: 'item.started' }]), /实际打开/);
  assert.throws(() => verifiedOutput(output, [{ ...event, item: { ...event.item, action: { type: 'search', query: url } } }]), /实际打开/);
  assert.throws(() => verifiedOutput({ ...output, sources: [...output.sources, { url: 'https://other.edu/unopened' }] }, [event]), /部分来源/);
});

test('rejects local addresses even when the agent claims to have visited them', () => {
  for (const address of ['https://127.0.0.1/a', 'file:///C:/secret', 'https://192.168.1.2/a', 'https://user:pass@example.edu/a']) {
    assert.throws(() => verifiedOutput({ ...output, sources: [{ url: address }] }, [{ ...event, item: { ...event.item, action: { type: 'open_page', url: address } } }]), /实际打开/);
  }
});

test('executor forwards only queryInput, uses isolated read-only CLI and cleans owned files', async () => {
  let prompt = '', args, directory;
  const search = createCodexResearchSearch({
    executable: 'codex', terminateProcess() {},
    spawnProcess(_exe, actualArgs, options) {
      args = actualArgs; directory = options.cwd;
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
      child.stdin.on('data', (chunk) => { prompt += chunk; });
      child.stdin.on('finish', () => {
        fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify(output));
        child.stdout.write(JSON.stringify(event) + '\n'); child.emit('close', 0);
      });
      return child;
    },
  });
  const result = await search({ studentId: 'private-student-id', queryInput: { grade: '高中' } });
  assert.equal(result.sources.length, 1);
  assert.doesNotMatch(prompt, /private-student-id/);
  assert.ok(args.includes('--search')); assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.some((arg, index) => arg === '--enable' && args[index + 1] === 'tool_search'));
  assert.ok(!args.some((arg, index) => arg === '--disable' && args[index + 1] === 'tool_search'));
  for (const capability of ['plugins', 'apps', 'browser_use', 'computer_use', 'shell_tool', 'memories', 'multi_agent']) {
    assert.ok(args.some((arg, index) => arg === '--disable' && args[index + 1] === capability));
  }
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(fs.existsSync(directory), false);
});

test('executor abort terminates the child and returns an actionable failure', async () => {
  const controller = new AbortController(); let terminated = false;
  const search = createCodexResearchSearch({ executable: 'codex', terminateProcess() { terminated = true; }, spawnProcess() {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    setImmediate(() => controller.abort()); return child;
  } });
  await assert.rejects(search({ queryInput: {}, signal: controller.signal }), /已取消/);
  assert.equal(terminated, true);
});

test('executor timeout waits for close and returns bounded no-effect evidence before cleanup', async () => {
  let root = '', terminated = 0;
  const search = createCodexResearchSearch({
    executable: 'codex', timeoutFloorMs: 5, timeoutFinalizationGraceMs: 5,
    terminateProcess(child) {
      terminated += 1;
      child.stdout.end(); child.stderr.end();
      setImmediate(() => child.emit('close', null, 'SIGTERM'));
    },
    spawnProcess(_exe, _args, options) {
      root = options.cwd;
      const child = new EventEmitter(); child.pid = 101;
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      return child;
    },
  });
  const error = await search({
    queryInput: {}, timeoutMs: 5,
    executionContext: { executionId: 'e1', workKey: 'w1', sourceVersion: 'v1', providerId: 'codex' },
  }).then(() => null, value => value);
  assert.equal(error.code, 'RESEARCH_TIMEOUT');
  assert.equal(error.timeoutEvidence.terminationState, 'closed');
  assert.equal(error.timeoutEvidence.completedWebEvents, 0);
  assert.equal(error.timeoutEvidence.outputPresent, false);
  assert.equal(terminated, 1);
  assert.equal(fs.existsSync(root), false);
});
