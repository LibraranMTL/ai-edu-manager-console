'use strict';
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const PROTOCOL = 'edu-manager.standard-cli.v1';
function failure(code, message, stage = 'not_sent') { return Object.assign(Error(message), { code, stage }); }
async function fingerprint(tool) {
  const { sha256 } = await require('./project-materials.cjs').hashStableFile(tool.target);
  return crypto.createHash('sha256').update(sha256).update(JSON.stringify([tool.target, tool.args || [], PROTOCOL])).digest('hex');
}
function invoke(tool, request, { timeoutMs = 120000, signal, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(failure('AGENT_CANCELLED', '任务已取消'));
    let child, sent = false, settled = false, stdout = '', size = 0, timer;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); error ? reject(error) : resolve(result); };
    const stop = (code, message) => { child?.kill(); finish(failure(code, message, sent ? 'unknown' : 'not_sent')); };
    const cancel = () => stop('AGENT_CANCELLED', 'CLI 已请求取消；已发送的任务不自动重派');
    try { child = spawnProcess(tool.target, tool.args || [], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return finish(failure('AGENT_UNAVAILABLE', e.message)); }
    child.once('error', e => finish(failure(sent ? 'EXECUTION_UNRESOLVED' : 'AGENT_UNAVAILABLE', e.message, sent ? 'unknown' : 'not_sent')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => { size += Buffer.byteLength(data); if (size > 4 * 1024 * 1024) stop('EXECUTION_UNRESOLVED', 'CLI 输出超出上限'); else stdout += data; });
    child.stderr.on('data', () => {}); // Never expose command diagnostics which can contain credentials or task data.
    child.stdin.on('error', () => {});
    child.once('spawn', () => { sent = true; child.stdin.end(JSON.stringify({ protocol: PROTOCOL, ...request }) + '\n'); });
    child.once('close', code => {
      if (settled) return;
      if (code !== 0) return finish(failure('EXECUTION_UNRESOLVED', 'CLI 非正常退出，需核对是否已执行', 'unknown'));
      try {
        const value = JSON.parse(stdout);
        if (value.protocol !== PROTOCOL || value.requestId !== request.requestId || value.ok !== true || !value.result || typeof value.result !== 'object') throw Error('invalid envelope');
        finish(null, value.result);
      } catch { finish(failure('AGENT_RESULT_INVALID', 'CLI 返回结果未通过协议校验，不自动重复生成', 'completed')); }
    });
    timer = setTimeout(() => stop('EXECUTION_UNRESOLVED', 'CLI 超时，执行结果未知，不自动重派'), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
async function verify(tool) {
  const hash = await fingerprint(tool), nonce = crypto.randomUUID();
  const result = await invoke(tool, { requestId: nonce, type: 'probe', prompt: '仅返回合成验证 nonce，不得读取文件或联网。', schema: { type: 'object', required: ['nonce'], properties: { nonce: { const: nonce } }, additionalProperties: false }, input: { nonce } }, { timeoutMs: 30000 });
  if (result.nonce !== nonce || await fingerprint(tool) !== hash) throw failure('CLI_CONTRACT_REQUIRED', 'CLI 合成协议验证失败');
  const profiles = require('./ai-executor-registry.cjs').STRUCTURED_PROFILES;
  const card = { title: '合成练习', subject: '数学', knowledgePoint: '乘法', rationale: '合成连接验收', minutes: 5, sourceRefs: ['synthetic'], prompt: '6乘7等于多少？', hint: '', answer: '42', explanation: '6乘7等于42。' };
  const batch = { projectId: 'synthetic-project', batchId: nonce, baselines: [{ relativePath: '摘要库/synthetic.md' }], sources: [{ materialId: 'synthetic', version: 1, sha256: 'a'.repeat(64) }] };
  const examples = [
    { schema: require('./smart-inbox-policy.cjs').ROUTING_SCHEMA, result: { candidates: [], sensitive: false, conflict: false, reason: '合成资料，无归属证据' } },
    { schema: require('./project-material-agent.cjs').outputSchema(batch), result: { schema: require('./project-material-digest.cjs').RESULT_SCHEMA, projectId: batch.projectId, batchId: batch.batchId, status: 'completed', message: '合成验收', artifacts: [{ relativePath: batch.baselines[0].relativePath, content: '6乘7等于42。', sources: batch.sources }] } },
    { schema: require('./practice-cards.cjs').CONTENT_SCHEMA, result: card },
  ];
  for (const example of examples) {
    const value = await invoke(tool, { requestId: crypto.randomUUID(), type: 'generate', prompt: `无学生数据的任务合同测试。按 schema 原样返回以下合成 JSON：${JSON.stringify(example.result)}`, schema: example.schema }, { timeoutMs: 30000 });
    require('./structured-contract-check.cjs').check(value, example.schema);
    if (JSON.stringify(value) !== JSON.stringify(example.result)) {
      const assert = require('node:assert/strict'); assert.deepEqual(value, example.result, 'CLI 合成任务合同未通过');
    }
  }
  if (await fingerprint(tool) !== hash) throw failure('CLI_CONTRACT_REQUIRED', 'CLI 验证期间程序已变化');
  return { runtimeHash: hash, checkedAt: new Date().toISOString(), protocol: PROTOCOL, profiles };
}
async function createAdapter(tool) {
  const hash = await fingerprint(tool);
  if (tool.verification?.runtimeHash !== hash || !require('./ai-executor-registry.cjs').STRUCTURED_PROFILES.every(p => tool.verification.profiles?.includes(p))) throw failure('CLI_CONTRACT_REQUIRED', 'CLI 尚未验证任务合同，或程序及参数已变化');
  return { id: tool.id, runtimeHash: hash, authScope: tool.id, authVersion: hash, standardCli: true,
    generate: async ({ prompt, schema, timeoutMs, signal, images }) => {
      if (images?.length) throw failure('CLI_CONTRACT_REQUIRED', '标准 CLI 暂不支持图像输入');
      if (await fingerprint(tool) !== hash) throw failure('CLI_CONTRACT_REQUIRED', 'CLI 程序已变化');
      const result = await invoke(tool, { requestId: crypto.randomUUID(), type: 'generate', prompt, schema }, { timeoutMs, signal });
      return require('./structured-contract-check.cjs').check(result, schema);
    } };
}
module.exports = { PROTOCOL, fingerprint, invoke, verify, createAdapter };
