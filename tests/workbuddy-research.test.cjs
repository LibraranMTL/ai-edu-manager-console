'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PROBE_SCHEMA, isPublicAddress, resolvePublicAddress, fetchPublicSource, workBuddyResearchEvidence, parseWorkBuddyResearchResult, runWorkBuddyResearch, createWorkBuddyResearchSearch } = require('../electron/workbuddy-research.cjs');

const url = 'https://www.iana.org/help/example-domains';
const payload = { query: 'IANA example domains', sources: [{ url, title: 'Example Domains', publisher: 'IANA', official: true, region: 'global', publishedAt: '', summary: 'Reserved example domains.' }], findings: ['IANA maintains example domains.'], limitations: [] };
function events(output = payload) {
  return [
    { type: 'function_call', name: 'WebSearch', call_id: 'search-1', arguments: JSON.stringify({ query: 'IANA example domains' }) },
    { type: 'function_call_result', call_id: 'search-1', output: 'search completed' },
    { type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(output) },
  ];
}

const fetched = async value => value;

test('known sources_note string is compatible without weakening contracts or evidence', async () => {
  const parse = output => parseWorkBuddyResearchResult(JSON.stringify(events(output)), '', 0, PROBE_SCHEMA, { fetchSource: fetched });
  assert.equal((await parse({ ...payload, sources_note: 'Additional source explanation' })).sources[0].url, url);
  for (const extra of [{ sources_note: {} }, { sources_note: ['text'] }, { sources_note: 'x'.repeat(4001) }, { unknown: 'x' }]) await assert.rejects(parse({ ...payload, ...extra }));
  await assert.rejects(parse({ ...payload, sources: [{ ...payload.sources[0], sources_note: 'nested' }] }));
  await assert.rejects(parse({ ...payload, findings: undefined, sources_note: 'x' }));
  await assert.rejects(parseWorkBuddyResearchResult(JSON.stringify(events({ ...payload, sources_note: 'verified' }).filter(x => x.type !== 'function_call_result')), '', 0, PROBE_SCHEMA, { fetchSource: fetched }));
  await assert.rejects(parseWorkBuddyResearchResult(JSON.stringify(events({ ...payload, sources_note: 'verified' })), '', 0, PROBE_SCHEMA, { fetchSource: async () => { throw Error('blocked source'); } }));
});

test('official camelCase callId correlates receipts even when event ids differ', () => {
  const stream = events();
  stream[0] = { ...stream[0], call_id: undefined, callId: 'real-call', id: 'event-1' };
  stream[1] = { ...stream[1], call_id: undefined, callId: 'real-call', id: 'event-2', status: 'completed', output: { results: [] } };
  assert.deepEqual(workBuddyResearchEvidence(stream).result, payload);
  assert.throws(() => workBuddyResearchEvidence([stream[0], { ...stream[1], callId: 'wrong' }, stream[2]]), /WebSearch/);
  for (const change of [{ status: 'failed' }, { output: { error: 'failed' } }, { is_error: true }]) {
    assert.throws(() => workBuddyResearchEvidence([stream[0], { ...stream[1], ...change }, stream[2]]), /WebSearch/);
  }
});

test('cancel after CLI exit while source fetch is pending cannot produce success', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbuddy-research-fetch-cancel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtime = { available: true, mode: 'node', cliPath: path.join(root, 'cli.js'), nodePath: process.execPath, configDir: path.join(root, 'profile') };
  await fs.writeFile(runtime.cliPath, 'synthetic');
  const controller = new AbortController();
  let resolveFetch;
  const pending = runWorkBuddyResearch(runtime, { prompt: 'synthetic', schema: PROBE_SCHEMA, signal: controller.signal,
    fetchSource: () => new Promise(resolve => { resolveFetch = resolve; controller.abort(); }), spawnProcess: () => {
      const child = new EventEmitter(); child.pid = 8; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.stdin.end = () => setImmediate(() => { child.stdout.emit('data', Buffer.from(JSON.stringify(events()))); child.emit('close', 0); });
      child.kill = () => true; return child;
    } });
  await assert.rejects(pending, error => error.code === 'RESEARCH_CANCELLED' && error.stopConfirmed === true);
  resolveFetch(url);
});

test('WorkBuddy research requires a matched WebSearch receipt and host-fetches every declared source', async () => {
  const evidence = workBuddyResearchEvidence(events());
  assert.deepEqual(evidence.result, payload);
  assert.equal((await parseWorkBuddyResearchResult(JSON.stringify(events()), '', 0, PROBE_SCHEMA, { fetchSource: fetched })).sources[0].url, url);
  assert.throws(() => workBuddyResearchEvidence(events().filter(item => item.type !== 'function_call_result')), /WebSearch/);
  assert.throws(() => workBuddyResearchEvidence([{ type: 'function_call', name: 'Read', call_id: 'x', arguments: '{}' }, ...events()]), /未授权工具/);
  await assert.rejects(parseWorkBuddyResearchResult(JSON.stringify(events({ ...payload, sources: [{ ...payload.sources[0], url: 'https://example.com/' }] })), '', 0, PROBE_SCHEMA, { fetchSource: async () => url }), /未取得实际打开|缺少网页访问记录|部分来源/);
});

test('host source verifier rejects private DNS answers and pins a public address', async () => {
  assert.equal(isPublicAddress('93.184.216.34'), true);
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.2', '::1', 'fc00::1']) assert.equal(isPublicAddress(address), false);
  await assert.rejects(resolvePublicAddress('example.com', async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]), /非公开地址/);
  let pinned;
  const requestImpl = (_target, options, callback) => {
    const request = new EventEmitter(); request.setTimeout = () => {}; request.destroy = error => request.emit('error', error);
    request.end = () => options.lookup('example.com', {}, (_error, address) => { pinned = address; const response = new EventEmitter(); response.statusCode = 200; response.headers = { 'content-length': '2' }; response.destroy = () => {}; callback(response); setImmediate(() => { response.emit('data', Buffer.from('ok')); response.emit('end'); }); });
    return request;
  };
  assert.equal(await fetchPublicSource('https://example.com/', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], requestImpl }), 'https://example.com/');
  assert.equal(pinned, '93.184.216.34');
});

test('pinned DNS callback supports Node and Electron all-address lookup mode', async () => {
  const requestImpl = (_target, options, callback) => {
    const request = new EventEmitter(); request.setTimeout = () => {}; request.destroy = error => request.emit('error', error);
    request.end = () => options.lookup('example.com', { all: true }, (_error, addresses) => {
      assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
      const response = new EventEmitter(); response.statusCode = 200; response.headers = {}; callback(response);
      setImmediate(() => { response.emit('data', Buffer.from('ok')); response.emit('end'); });
    }); return request;
  };
  assert.equal(await fetchPublicSource('https://example.com/', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], requestImpl }), 'https://example.com/');
});

test('host source verifier revalidates redirects and enforces the response cap', async () => {
  const lookup = async hostname => [{ address: hostname === 'private.example.com' ? '127.0.0.1' : '93.184.216.34', family: 4 }];
  const redirecting = (_target, _options, callback) => {
    const request = new EventEmitter(); request.setTimeout = () => {}; request.destroy = error => request.emit('error', error);
    request.end = () => { const response = new EventEmitter(); response.statusCode = 302; response.headers = { location: 'https://private.example.com/secret' }; response.resume = () => {}; callback(response); };
    return request;
  };
  await assert.rejects(fetchPublicSource('https://example.com/', { lookup, requestImpl: redirecting }), /非公开地址/);
  const oversized = (_target, _options, callback) => {
    const request = new EventEmitter(); request.setTimeout = () => {}; request.destroy = error => request.emit('error', error);
    request.end = () => { const response = new EventEmitter(); response.statusCode = 200; response.headers = { 'content-length': String(600 * 1024) }; response.destroy = () => {}; response.resume = () => {}; callback(response); };
    return request;
  };
  await assert.rejects(fetchPublicSource('https://example.com/', { lookup, requestImpl: oversized }), /容量限制/);
});

test('WorkBuddy research runner uses the restricted invocation and returns host-verified sources', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbuddy-research-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtime = { available: true, mode: 'node', cliPath: path.join(root, 'cli.js'), nodePath: process.execPath, configDir: path.join(root, 'profile') };
  await fs.writeFile(runtime.cliPath, 'synthetic');
  let captured;
  const result = await runWorkBuddyResearch(runtime, { prompt: 'synthetic', schema: PROBE_SCHEMA, fetchSource: fetched, spawnProcess: (_exe, args, options) => {
    captured = { args, options }; const child = new EventEmitter(); child.pid = 7;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.end = () => setImmediate(() => { child.stdout.emit('data', Buffer.from(JSON.stringify(events()))); child.emit('close', 0); });
    child.kill = () => { child.emit('close', 1); return true; }; return child;
  } });
  assert.equal(result.sources.length, 1);
  assert.equal(captured.args[captured.args.indexOf('--tools') + 1], 'WebSearch');
  assert.equal(captured.args.includes('--allowedTools'), false);
  assert.equal(captured.args.includes('-y'), false);
  assert.equal(captured.options.env.CODEBUDDY_IS_SANDBOX, '0');
  assert.equal(captured.options.cwd.startsWith(os.tmpdir()), true);
});

test('cancelling WorkBuddy research cannot be converted into a successful result by process close', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbuddy-research-cancel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtime = { available: true, mode: 'node', cliPath: path.join(root, 'cli.js'), nodePath: process.execPath, configDir: path.join(root, 'profile') };
  await fs.writeFile(runtime.cliPath, 'synthetic');
  const controller = new AbortController();
  const pending = runWorkBuddyResearch(runtime, { prompt: 'synthetic', schema: PROBE_SCHEMA, signal: controller.signal, spawnProcess: () => {
    const child = new EventEmitter(); child.pid = 8;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.end = () => setImmediate(() => controller.abort());
    child.kill = () => { child.stdout.emit('data', Buffer.from(JSON.stringify(events()))); child.emit('close', 0); return true; };
    return child;
  } });
  await assert.rejects(pending, error => error?.code === 'RESEARCH_CANCELLED' && error?.stopConfirmed === true);
});

test('saved WorkBuddy research qualification is bound to CLI bytes and authorization scope', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbuddy-research-scope-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtime = { available: true, mode: 'node', cliPath: path.join(root, 'cli.js'), nodePath: process.execPath, configDir: path.join(root, 'profile'), authVersion: 2 };
  await fs.writeFile(runtime.cliPath, 'synthetic');
  const hash = (await require('../electron/project-materials.cjs').hashStableFile(runtime.cliPath)).sha256;
  const qualification = { ready: true, profile: 'research.v1', runtimeHash: hash, authScope: JSON.stringify([runtime.configDir, 2]) };
  assert.equal(typeof await createWorkBuddyResearchSearch({ runtime, qualification }), 'function');
  await assert.rejects(createWorkBuddyResearchSearch({ runtime: { ...runtime, authVersion: 3 }, qualification }), /授权范围/);
  await fs.writeFile(runtime.cliPath, 'changed');
  await assert.rejects(createWorkBuddyResearchSearch({ runtime, qualification }), /合同尚未通过|运行程序已经变化/);
});
