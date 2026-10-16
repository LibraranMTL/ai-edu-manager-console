'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { checkedEndpoint, endpointUrl, completionUrl, createLlmApiProvider, researchEvidence } = require('../electron/llm-api-provider.cjs');
const { executeMaterialLlmApi } = require('../electron/project-material-agent.cjs');

async function fixture(t, request) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-llm-api-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const provider = createLlmApiProvider({ directory: root,
    protect: async value => Buffer.from(`protected:${value}`).toString('base64'),
    unprotect: async value => Buffer.from(value, 'base64').toString().replace(/^protected:/, ''), request });
  return { root, provider };
}

test('endpoint policy permits public HTTPS and loopback only', () => {
  assert.equal(checkedEndpoint('https://api.example.com/v1/'), 'https://api.example.com/v1');
  assert.equal(completionUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(endpointUrl('https://api.example.com/v1', 'openai-responses'), 'https://api.example.com/v1/responses');
  assert.equal(endpointUrl('https://api.anthropic.com/v1/messages', 'anthropic-messages'), 'https://api.anthropic.com/v1/messages');
  for (const value of ['http://api.example.com/v1', 'https://user:key@example.com/v1', 'https://example.com/v1?key=x', 'http://192.168.1.2/v1']) assert.throws(() => checkedEndpoint(value));
});

test('settings encrypt the key, expose only public state and bind key changes to endpoint', async t => {
  const { root, provider } = await fixture(t, async () => assert.fail('not called'));
  const saved = await provider.save({ revision: 0, baseUrl: 'https://api.example.com/v1', model: 'fixture-model', apiKey: 'synthetic-private-key' });
  assert.equal(saved.configured, true); assert.equal(saved.hasApiKey, true); assert.equal(saved.apiKey, undefined);
  const raw = await fs.readFile(path.join(root, 'provider.json'), 'utf8');
  assert.doesNotMatch(raw, /synthetic-private-key/);
  await assert.rejects(provider.save({ revision: 1, baseUrl: 'https://other.example.com/v1', model: 'fixture-model' }), /重新输入或清除/);
});

test('structured generation sends no tools and parses bounded JSON output', async t => {
  let requestBody, authorization;
  const { provider } = await fixture(t, async (_url, options) => {
    requestBody = JSON.parse(options.body); authorization = options.headers.authorization;
    return new Response(JSON.stringify({ id: 'request-1', choices: [{ finish_reason: 'stop', message: { content: '{"answer":42}' } }], usage: { total_tokens: 12 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await provider.save({ revision: 0, baseUrl: 'https://api.example.com/v1', model: 'fixture-model', apiKey: 'synthetic-private-key' });
  const stages = [];
  const value = await provider.generate({ prompt: '合成输入', schema: { type: 'object', properties: { answer: { type: 'integer' } } }, onStage: stage => stages.push(stage) });
  assert.deepEqual(value, { answer: 42 }); assert.equal(authorization, 'Bearer synthetic-private-key');
  assert.equal(requestBody.model, 'fixture-model'); assert.equal(requestBody.tools, undefined); assert.equal(requestBody.stream, false);
  assert.deepEqual(stages, ['possibly_sent', 'result_received']);
});

test('verification persists only a successful synthetic structured check', async t => {
  const { provider } = await fixture(t, async () => new Response(JSON.stringify({ id: 'verify', choices: [{ finish_reason: 'stop', message: { content: '{"ok":true,"code":"edu-llm-42"}' } }] }), { status: 200 }));
  await provider.save({ revision: 0, baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-fixture' });
  const checked = await provider.verify();
  assert.equal(checked.lastCheck.ok, true); assert.match(checked.message, /结构化合成检测通过/);
});

test('legacy settings migrate to chat completions without silently enabling research', async t => {
  const { root, provider } = await fixture(t, async () => assert.fail('not called'));
  await fs.writeFile(path.join(root, 'provider.json'), JSON.stringify({ schema: 'edu-manager.llm-api.v1', revision: 3,
    baseUrl: 'https://api.example.com/v1', model: 'legacy-model', secret: Buffer.from('protected:key').toString('base64'), credentialVersion: 1, lastCheck: null }));
  const state = await provider.get();
  assert.equal(state.protocol, 'openai-chat'); assert.equal(state.researchSupported, false); assert.equal(state.researchReady, false);
});

test('responses protocol uses native JSON schema for ordinary generation', async t => {
  let url, body;
  const { provider } = await fixture(t, async (value, options) => {
    url = value; body = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: 'resp-1', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":42}' }] }] }), { status: 200 });
  });
  await provider.save({ revision: 0, protocol: 'openai-responses', baseUrl: 'https://api.example.com/v1', model: 'fixture-model', apiKey: 'key' });
  assert.deepEqual(await provider.generate({ prompt: 'test', schema: { type: 'object', properties: { answer: { type: 'integer' } } } }), { answer: 42 });
  assert.equal(url, 'https://api.example.com/v1/responses'); assert.equal(body.tools, undefined); assert.equal(body.text.format.type, 'json_schema');
});

test('research requires a completed web call and every claimed source must be cited', async t => {
  const output = { query: 'example', findings: ['reserved'], limitations: [], sections: [], sources: [{ url: 'https://www.iana.org/help/example-domains', title: 'Example Domains', publisher: 'IANA', official: true, region: 'global', publishedAt: '', summary: 'reserved' }] };
  const response = { id: 'research-1', status: 'completed', output: [
    { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'IANA example domains' } },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [{ type: 'url_citation', url: output.sources[0].url }] }] },
  ] };
  const { provider } = await fixture(t, async () => new Response(JSON.stringify(response), { status: 200 }));
  await provider.save({ revision: 0, protocol: 'openai-responses', baseUrl: 'https://api.example.com/v1', model: 'fixture-model', apiKey: 'key' });
  const result = await provider.search({ queryInput: { purpose: 'guidance_verification' } });
  assert.equal(result.sources.length, 1); assert.match(result.sources[0].fetchedAt, /^\d{4}-/);
  const checked = await provider.verifyResearch(); assert.equal(checked.researchReady, true); assert.equal(checked.lastResearchCheck.sourceCount, 1);

  const missing = structuredClone(response); missing.output[1].content[0].annotations = [];
  assert.throws(() => researchEvidence(missing, 'openai-responses'), /completed|检索|联网|引用|source/i);
});

test('chat completions cannot claim a research qualification', async t => {
  const { provider } = await fixture(t, async () => assert.fail('not called'));
  await provider.save({ revision: 0, protocol: 'openai-chat', baseUrl: 'https://api.example.com/v1', model: 'fixture-model', apiKey: 'key' });
  await assert.rejects(provider.verifyResearch(), error => error.code === 'LLM_API_RESEARCH_UNSUPPORTED' && error.stage === 'not_sent');
});

test('transport interruption is unknown and never described as safe pre-send failure', async t => {
  const { provider } = await fixture(t, async () => { throw Error('socket closed'); });
  await provider.save({ revision: 0, baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-fixture' });
  await assert.rejects(provider.generate({ prompt: '合成输入', schema: { type: 'object', properties: {} } }), error => error.code === 'LLM_API_TRANSPORT_UNKNOWN' && error.stage === 'possibly_sent');
});

test('material digest gives the API fixed text only and host stages the validated artifact', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-llm-digest-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.txt'), outputRoot = path.join(root, 'staging'); const bytes = Buffer.from('合成教育资料 42', 'utf8');
  await fs.writeFile(source, bytes); await fs.mkdir(outputRoot); const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const batch = { projectId: 'project-a', batchId: 'batch-a', outputRoot,
    inputFiles: [{ path: source, location: { relativePath: 'source.txt' }, materialId: 'material-a', version: 1, sha256, size: bytes.length }],
    sources: [{ materialId: 'material-a', version: 1, sha256 }],
    baselines: [{ relativePath: '摘要库/material-a.md', materialIds: ['material-a'] }] };
  let prompt = '';
  const provider = { generate: async input => { prompt = input.prompt; assert.equal(input.schema.properties.projectId.enum[0], 'project-a');
    return { schema: 'edu-manager.project-material-result.v1', projectId: 'project-a', batchId: 'batch-a', status: 'completed', message: 'ok',
      artifacts: [{ relativePath: '摘要库/material-a.md', content: '# 合成摘要\n\n42', sources: [{ materialId: 'material-a', version: 1, sha256 }] }] }; } };
  const receipt = await executeMaterialLlmApi({ provider, batch, sandboxEvidence: { mode: 'host-mediated-no-tools' } });
  assert.match(prompt, /合成教育资料 42/); assert.doesNotMatch(prompt, /读取本机文件.*允许/);
  assert.equal(receipt.artifacts.length, 1); assert.equal(await fs.readFile(path.join(outputRoot, '摘要库', 'material-a.md'), 'utf8'), '# 合成摘要\n\n42');
});
