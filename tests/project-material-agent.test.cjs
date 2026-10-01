const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { codexMaterialInvocation, outputSchema, parseCodexMaterialEvents, stageMaterialResponse } = require('../electron/project-material-agent.cjs');
const { RESULT_SCHEMA } = require('../electron/project-material-digest.cjs');

test('material runner uses readonly CLI and no user MCP/config/rules or writable roots', () => {
  const args = codexMaterialInvocation({ cwd: path.resolve('fixture'), schemaPath: path.resolve('fixture/schema.json') });
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  for (const option of ['--ignore-user-config', '--ignore-rules', '--output-schema', '--ephemeral', '--json']) assert.ok(args.includes(option));
  for (const option of ['--add-dir', '--dangerously-bypass-approvals-and-sandbox', '--output-last-message']) assert.equal(args.includes(option), false);
  assert.ok(args.includes('approval_policy="never"'));
  for (const flag of ['shell_tool', 'unified_exec', 'browser_use', 'plugins', 'hooks', 'tool_search', 'builtin_mcp']) {
    assert.ok(args.includes(`features.${flag}=false`));
  }
});

test('unexpected execution or external tool activity rejects even a later successful final message', () => {
  const done = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{}' } }) + '\n{"type":"turn.completed"}';
  for (const type of ['command_execution', 'mcp_tool_call', 'web_search', 'file_change', 'unknown_future_tool']) {
    assert.throws(() => parseCodexMaterialEvents(JSON.stringify({ type: 'item.started', item: { type } }) + '\n' + done),
      { code: 'unexpected_agent_tool' });
  }
});

test('only a completed turn with valid final JSON yields a result', () => {
  const response = { schema: RESULT_SCHEMA, projectId: 'p', batchId: 'b', artifacts: [] };
  const message = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(response) } });
  const done = JSON.stringify({ type: 'turn.completed' });
  assert.deepEqual(parseCodexMaterialEvents(`${message}\n${done}`), response);
  assert.throws(() => parseCodexMaterialEvents(message), { code: 'agent_incomplete' });
  assert.throws(() => parseCodexMaterialEvents(`${message}\n{"type":"turn.failed"}`), { code: 'agent_failed' });
  assert.throws(() => parseCodexMaterialEvents('not json'), { code: 'invalid_agent_stream' });
});

async function fixture(t) {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-stage-test-'));
  t.after(async () => {
    assert.equal(path.dirname(outputRoot), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(outputRoot).startsWith('edu-stage-test-'));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });
  const source = { materialId: 'm1', version: 1, sha256: 'a'.repeat(64) };
  const batch = { projectId: 'p1', batchId: 'b1', outputRoot, sources: [source],
    baselines: [{ relativePath: '摘要库/a.md', materialIds: ['m1'] }, { relativePath: '概念库/b.md', materialIds: ['m1'] }] };
  const response = { schema: RESULT_SCHEMA, projectId: 'p1', batchId: 'b1', status: 'completed', message: '',
    artifacts: [{ relativePath: '摘要库/a.md', content: '# Valid knowledge', sources: [source] }] };
  return { batch, response };
}

test('host writes only declared staged Markdown and returns source metadata without model content fields', async (t) => {
  const { batch, response } = await fixture(t);
  assert.deepEqual(outputSchema(batch).properties.artifacts.items.properties.relativePath.enum, ['摘要库/a.md', '概念库/b.md']);
  const receipt = await stageMaterialResponse(batch, response);
  assert.equal(await fs.readFile(path.join(batch.outputRoot, '摘要库/a.md'), 'utf8'), '# Valid knowledge');
  assert.equal(receipt.artifacts[0].content, undefined);
  assert.deepEqual(await stageMaterialResponse(batch, response), receipt);
  await assert.rejects(stageMaterialResponse(batch, { ...response,
    artifacts: [{ ...response.artifacts[0], content: '# Changed' }] }), { code: 'staging_conflict' });
});

test('invalid final artifact prevents even earlier valid artifacts from being written', async (t) => {
  const { batch, response } = await fixture(t);
  response.artifacts.push({ relativePath: '../escape.md', content: '# Nope', sources: batch.sources });
  await assert.rejects(stageMaterialResponse(batch, response), { code: 'invalid_path' });
  assert.deepEqual(await fs.readdir(batch.outputRoot), []);
});

test('malicious source version, unplanned target and oversized text are rejected', async (t) => {
  const { batch, response } = await fixture(t);
  for (const artifact of [
    { ...response.artifacts[0], sources: [{ ...batch.sources[0], version: 2 }] },
    { ...response.artifacts[0], relativePath: '摘要库/other.md' },
    { ...response.artifacts[0], content: 'x'.repeat(2 * 1024 * 1024 + 1) },
  ]) await assert.rejects(stageMaterialResponse(batch, { ...response, artifacts: [artifact] }));
  assert.deepEqual(await fs.readdir(batch.outputRoot), []);
});

test('explicit failure and error-as-knowledge are not staged or marked as success', async (t) => {
  const { batch, response } = await fixture(t);
  await assert.rejects(stageMaterialResponse(batch, { ...response, status: 'failed', message: 'Cannot read inputs', artifacts: [] }), { code: 'agent_failed' });
  await assert.rejects(stageMaterialResponse(batch, { ...response, artifacts: [{ ...response.artifacts[0], content: 'ERROR: Unable to extract the summary.' }] }), { code: 'agent_failed' });
  assert.deepEqual(await fs.readdir(batch.outputRoot), []);
});
