'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const provider = require('../electron/builtin-structured-provider.cjs');

async function runtimeFixture(t, id) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'builtin-provider-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'runtime.bin');
  const configPath = path.join(root, 'config.json');
  await fs.writeFile(executable, 'synthetic-runtime');
  await fs.writeFile(configPath, '{}');
  if (['openclaw', 'claude-code'].includes(id)) return { executable };
  if (id === 'qclaw') return { nodePath: executable, cliPath: executable, configPath, agentId: 'main' };
  return { cliPath: executable };
}

test('vendor JSON envelopes are reduced to the schema-bound result only', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'integer' } } };
  assert.deepEqual(provider.extractStructuredResult({ result: '{"answer":42}' }, schema), { answer: 42 });
  assert.deepEqual(provider.extractStructuredResult({ payloads: [{ text: '```json\n{"answer":42}\n```' }] }, schema), { answer: 42 });
  assert.equal(provider.extractStructuredResult({ result: { answer: '42' } }, schema), null);
});

test('all five built-in channels qualify classification, digest and both card contracts with synthetic data', async t => {
  for (const id of provider.PROVIDERS) {
    const runtime = await runtimeFixture(t, id);
    const adapter = await provider.createAdapter({ id, runtime, invoke: async request => {
      const match = request.prompt.match(/以下 JSON：([\s\S]+)$/);
      assert.ok(match, `${id} qualification must contain a synthetic sentinel`);
      return JSON.parse(match[1]);
    } });
    for (const profile of provider.PROFILES) {
      const result = await provider.qualifyProfile(adapter, profile);
      assert.equal(result.ready, true);
      assert.equal(result.runtimeHash, adapter.runtimeHash);
    }
  }
});

test('qualification identity changes with the authenticated runtime configuration', async t => {
  const runtime = await runtimeFixture(t, 'openclaw');
  const first = await provider.runtimeFingerprint('openclaw', { ...runtime, authScope: 'profile', authVersion: 'model-a' });
  const changed = await provider.runtimeFingerprint('openclaw', { ...runtime, authScope: 'profile', authVersion: 'model-b' });
  assert.notEqual(first, changed);
});

test('provider-specific invocations are noninteractive and read-only where the CLI supports it', () => {
  const openclaw = provider.buildInvocation('openclaw', { executable: 'openclaw.cmd', local: true }, 'prompt', 30000, 'C:\\Temp');
  assert.deepEqual(openclaw.args.slice(0, 3), ['agent', '--local', '--message']);
  assert.equal(openclaw.args.includes('--json'), true);
  const trae = provider.buildInvocation('trae', { cliPath: 'traecli.exe' }, 'prompt', 30000, 'C:\\Temp');
  assert.equal(trae.args.includes('read-only'), true);
  assert.equal(trae.stdinText, 'prompt\n');
  const qoder = provider.buildInvocation('qoder-work', { cliPath: 'qoder.cmd' }, 'prompt', 30000, 'C:\\Temp');
  assert.equal(qoder.args.includes('Read,Grep,Glob'), true);
  assert.equal(qoder.args.includes('json'), true);
  const schema = { type: 'object', required: ['answer'], properties: { answer: { type: 'integer' } } };
  const claude = provider.buildInvocation('claude-code', { executable: 'claude.cmd' }, 'prompt', 30000, 'C:\\Temp', schema);
  assert.equal(claude.args.includes('--json-schema'), true);
  assert.equal(claude.args.includes('--no-session-persistence'), true);
  assert.equal(claude.args.includes('--safe-mode'), true);
  assert.equal(claude.args.includes('--restricted'), true);
  assert.equal(claude.stdinText, 'prompt\n');
});

test('argument-based Windows channels reject oversized input before spawning', async () => {
  await assert.rejects(provider.invokeRuntime('qoder-work', { cliPath: 'unused' }, {
    prompt: 'x'.repeat(25000), schema: { type: 'object', properties: {} },
  }), { code: 'AGENT_INPUT_TOO_LARGE', stage: 'not_sent' });
});

test('production host wires built-in adapters into all three task entry points and the center exposes explicit verification', async () => {
  const root = path.join(__dirname, '..');
  const main = await fs.readFile(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const ui = await fs.readFile(path.join(root, 'src', 'GlobalAgentControlCenter.tsx'), 'utf8');
  assert.match(main, /builtinStructuredProvider\.createAdapter/);
  assert.match(main, /ensureBuiltinStructuredQualification\(adapter, DIGEST_PROFILE\)/);
  assert.match(main, /ensureBuiltinStructuredQualification\(adapter, LEARNING_CARD_PROFILE\)/);
  assert.match(main, /action === 'verifyBuiltin'/);
  assert.match(ui, /检测并验证三类合同/);
});
