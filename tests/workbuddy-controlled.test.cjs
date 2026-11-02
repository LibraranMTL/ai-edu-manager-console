const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { EventEmitter } = require('node:events');
const { parseFixedResult, runFixedWorkBuddy, createWorkBuddyQualification, createWorkBuddyStructuredAdapter, executeMaterialWorkBuddy } = require('../electron/workbuddy-controlled.cjs');
const { RESULT_SCHEMA } = require('../electron/project-material-digest.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-wb-controlled-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const cliPath=path.join(root,'synthetic-cli.js'); await fs.writeFile(cliPath,'synthetic CLI, never executed');
  return { root, runtime:{ available:true, mode:'node', cliPath, nodePath:process.execPath, configDir:path.join(root,'empty-profile'),version:'v1' } };
}
function resultFor(prompt) {
  const data=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
  return {schema:RESULT_SCHEMA,projectId:data.projectId,batchId:data.batchId,status:'completed',message:'synthetic',
    artifacts:[{relativePath:'probe.md',content:'6 * 7 = 42',sources:data.sources}]};
}
test('final JSON is required; authentication, tool activity and successful error exits fail closed',()=>{
  assert.deepEqual(parseFixedResult('{"result":"{\\"ready\\":true}"}','',0),{ready:true});
  assert.throws(() => parseFixedResult('输出在上一条消息被截断','',0), { code: 'AGENT_RESULT_INVALID', stage: 'completed' });
  assert.throws(() => parseFixedResult('{"result":"输出在上一条消息被截断"}','',0), { code: 'AGENT_RESULT_INVALID', stage: 'completed' });
  for(const stdout of ['READY','{"result":"{}","is_error":true}','{"result":"{}","permission_denials":[{}]}','{"type":"tool_use","result":"{}"}']) assert.throws(()=>parseFixedResult(stdout,'',0));
  assert.throws(()=>parseFixedResult('{"result":"{}"}','authentication required',0),{code:'AUTHENTICATION_REQUIRED'});
  assert.throws(()=>parseFixedResult('','429 too many requests',1),{code:'429'});
});

test('material execution asks WorkBuddy to repair one malformed completed result before failing the task', async t => {
  const f = await fixture(t);
  const sourcePath = path.join(f.root, 'source.md');
  const outputRoot = path.join(f.root, 'output');
  await fs.writeFile(sourcePath, 'fixed source');
  await fs.mkdir(outputRoot);
  const source = { materialId: 'material-1', version: 1,
    sha256: (await require('../electron/project-materials.cjs').hashStableFile(sourcePath)).sha256 };
  const batch = { projectId: 'project-1', batchId: 'batch-1', outputRoot,
    inputFiles: [{ ...source, path: sourcePath }], sources: [source],
    baselines: [{ relativePath: 'knowledge.md', materialIds: [source.materialId] }] };
  const qualification = { ready: true,
    cliHash: (await require('../electron/project-materials.cjs').hashStableFile(f.runtime.cliPath)).sha256 };
  let calls = 0;
  const result = await executeMaterialWorkBuddy({ runtime: f.runtime, qualification, batch,
    extractSource: async () => 'fixed source', run: async (_runtime, prompt) => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('malformed'), { code: 'AGENT_RESULT_INVALID', stage: 'completed' });
      assert.match(prompt, /上一次返回未满足结构化合同/);
      return { schema: RESULT_SCHEMA, projectId: batch.projectId, batchId: batch.batchId,
        status: 'completed', message: 'repaired', artifacts: [{ relativePath: 'knowledge.md',
          content: '# Knowledge', sources: [source] }] };
    } });
  assert.equal(calls, 2);
  assert.equal(result.artifacts[0].relativePath, 'knowledge.md');
  assert.equal(await fs.readFile(path.join(outputRoot, 'knowledge.md'), 'utf8'), '# Knowledge');
});
test('material execution repairs one completed response whose batch identity is wrong', async t => {
  const f = await fixture(t);
  const sourcePath = path.join(f.root, 'source.md'), outputRoot = path.join(f.root, 'output');
  await fs.writeFile(sourcePath, 'fixed source'); await fs.mkdir(outputRoot);
  const source = { materialId: 'material-1', version: 1,
    sha256: (await require('../electron/project-materials.cjs').hashStableFile(sourcePath)).sha256 };
  const batch = { projectId: 'project-1', batchId: 'batch-1', outputRoot,
    inputFiles: [{ ...source, path: sourcePath }], sources: [source],
    baselines: [{ relativePath: 'knowledge.md', materialIds: [source.materialId] }] };
  const qualification = { ready: true,
    cliHash: (await require('../electron/project-materials.cjs').hashStableFile(f.runtime.cliPath)).sha256 };
  let calls = 0;
  const receipt = await executeMaterialWorkBuddy({ runtime: f.runtime, qualification, batch,
    extractSource: async () => 'fixed source', run: async (_runtime, prompt) => {
      calls++;
      if (calls === 2) assert.match(prompt, /上一次返回的项目或批次身份不匹配/);
      return { schema: RESULT_SCHEMA, projectId: batch.projectId, batchId: calls === 1 ? 'wrong-batch' : batch.batchId,
        status: 'completed', message: calls === 1 ? 'wrong identity' : 'repaired',
        artifacts: [{ relativePath: 'knowledge.md', content: '# Knowledge', sources: [source] }] };
    } });
  assert.equal(calls, 2);
  assert.equal(receipt.batchId, batch.batchId);
  assert.equal(await fs.readFile(path.join(outputRoot, 'knowledge.md'), 'utf8'), '# Knowledge');
});
test('material execution stops after one batch-identity repair attempt', async t => {
  const f = await fixture(t);
  const sourcePath = path.join(f.root, 'source.md'), outputRoot = path.join(f.root, 'output');
  await fs.writeFile(sourcePath, 'fixed source'); await fs.mkdir(outputRoot);
  const source = { materialId: 'material-1', version: 1,
    sha256: (await require('../electron/project-materials.cjs').hashStableFile(sourcePath)).sha256 };
  const batch = { projectId: 'project-1', batchId: 'batch-1', outputRoot,
    inputFiles: [{ ...source, path: sourcePath }], sources: [source],
    baselines: [{ relativePath: 'knowledge.md', materialIds: [source.materialId] }] };
  const qualification = { ready: true,
    cliHash: (await require('../electron/project-materials.cjs').hashStableFile(f.runtime.cliPath)).sha256 };
  let calls = 0;
  await assert.rejects(executeMaterialWorkBuddy({ runtime: f.runtime, qualification, batch,
    extractSource: async () => 'fixed source', run: async () => {
      calls++;
      return { schema: RESULT_SCHEMA, projectId: batch.projectId, batchId: 'still-wrong',
        status: 'completed', message: 'wrong identity',
        artifacts: [{ relativePath: 'knowledge.md', content: '# Knowledge', sources: [source] }] };
    } }), error => error?.code === 'receipt_scope_mismatch');
  assert.equal(calls, 2);
  await assert.rejects(fs.stat(path.join(outputRoot, 'knowledge.md')), error => error?.code === 'ENOENT');
});
test('vendor sensitive approval denial/expiry/protection failures remain blocked and cannot be retried as network errors', () => {
  const { taskRetryDecision } = require('../electron/task-recovery-policy.cjs');
  for (const marker of ['sensitive_approval_timeout', 'sensitive_access_denied', 'sensitive_protection_failed',
    'Sensitive content approval timed out. The operation was not authorized and was blocked.', '[SENSITIVE_APPROVAL=TIMED_OUT. Content withheld]']) {
    for (const code of [0, 1]) {
      let failure;
      try { parseFixedResult('{"result":"{}"}', `${marker} network connection ETIMEDOUT`, code); } catch (error) { failure = error; }
      assert.equal(failure.code, 'SENSITIVE_REVIEW_REQUIRED');
      assert.equal(taskRetryDecision({ attempt: 1, maxAttempts: 3 }, failure, { stopConfirmed: true }).autoRetry, false);
    }
  }
  assert.deepEqual(parseFixedResult(JSON.stringify({ result: JSON.stringify({ sensitive: true, reason: 'medical record' }) }), '', 0),
    { sensitive: true, reason: 'medical record' });
});
test('runner confirms vendor sensitive rejection only on process close and never launches a replacement', async t => {
  const f = await fixture(t); let launches = 0, closed = false;
  await assert.rejects(runFixedWorkBuddy(f.runtime, 'synthetic only', { spawnProcess: (_exe, _args, options) => {
    launches++;
    assert.equal(options.env.CBC_SANDBOX_APPROVAL_TIMEOUT_MS, '1000');
    const child = new EventEmitter(); child.pid = 123;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.end = () => setImmediate(() => {
      child.stderr.emit('data', Buffer.from('sensitive_approval_'));
      child.stderr.emit('data', Buffer.from('timeout'));
      child.stderr.emit('data', Buffer.from('x'.repeat(8192) + ' ETIMEDOUT'));
      setImmediate(() => { closed = true; child.emit('close', 1); });
    });
    child.kill = () => { throw Error('vendor has already refused; no host kill needed'); };
    return child;
  } }), error => {
    assert.equal(error.code, 'SENSITIVE_REVIEW_REQUIRED');
    assert.equal(error.stopConfirmed, true); assert.equal(closed, true);
    return true;
  });
  assert.equal(launches, 1);
});

test('full CLI event arrays preserve the single final result and reject tools, errors, duplicates and unknown events', () => {
  const events = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'synthetic' }] },
    { type: 'reasoning', summary: [{ type: 'summary_text', text: 'synthetic' }], rawContent: [{ type: 'reasoning_text', text: 'synthetic' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"ready":true}' }] },
    { type: 'result', subtype: 'success', is_error: false, result: '{"ready":true}' }];
  assert.deepEqual(parseFixedResult(JSON.stringify(events), '', 0), { ready: true });
  for (const extra of [{ type: 'function_call', name: 'Read' }, { type: 'tool_result' }, { type: 'unknown' },
    { type: 'message', content: [{ type: 'tool_use', name: 'Read' }] }, { type: 'message', tool_calls: [{}] },
    { type: 'reasoning', error: 'failed' }, { type: 'message', status: 'incomplete' }, events.at(-1)]) {
    assert.throws(() => parseFixedResult(JSON.stringify([extra, ...events]), '', 0));
  }
  assert.throws(() => parseFixedResult(JSON.stringify(events.slice(0, -1)), '', 0));
  assert.throws(() => parseFixedResult(JSON.stringify([...events, events[0]]), '', 0));
});
test('only a single exact JSON presentation fence is accepted; surrounding prose and extra blocks fail', () => {
  const parse = result => parseFixedResult(JSON.stringify({ type: 'result', result }), '', 0);
  assert.deepEqual(parse('```json\n{"ready":true}\n```'), { ready: true });
  assert.deepEqual(parse('```json\n{"ready":true}'), { ready: true });
  for (const result of ['prefix\n```json\n{}\n```', '```json\n{}\n```\ntrailing', '```json\n{}\n```\n```json\n{}\n```', '```js\n{}\n```']) assert.throws(() => parse(result));
  assert.throws(() => parse('```json\n{"ready":true}\ntrailing'));
  const blocked = { candidates: [], sensitive: false, conflict: true, reason: '拒绝越权要求' };
  assert.deepEqual(parse(`${JSON.stringify(blocked)}\n\n仅保留人工确认。`), blocked);
  assert.throws(() => parse('{"candidates":[{"id":"project"}],"sensitive":false,"conflict":false,"reason":"route"}\ntrailing'));
  assert.throws(() => parse('{"candidates":[],"sensitive":false,"conflict":false,"reason":"none"}\ntrailing'));
});
test('actual runner exposes no tools/MCP/plugins; uses empty cwd and only provided stdin',async t=>{
  const f=await fixture(t); let captured;
  const result=await runFixedWorkBuddy(f.runtime,'synthetic only',{spawnProcess:(exe,args,options)=>{
    captured={exe,args,options};const child=new EventEmitter(); child.pid=123;
    child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
    child.stdin.end=input=>setImmediate(()=>{assert.equal(input,'synthetic only\n');child.stdout.emit('data',Buffer.from('{"type":"result","result":"{\\"ready\\":true}"}'));child.emit('close',0);});
    child.kill=()=>{child.emit('close',1);return true;};return child;
  }});
  assert.equal(result.ready,true);assert.equal(captured.args[captured.args.indexOf('--tools')+1],'');
  assert.equal(captured.args[captured.args.indexOf('--setting-sources')+1],'local');
  assert(captured.args.includes('--strict-mcp-config')); assert(captured.args.includes('--no-plugin-management'));
  assert.equal(captured.options.env.CODEBUDDY_DISABLE_PLUGIN_INSTALLS, '1');
  assert.equal(captured.options.env.CODEBUDDY_PLUGIN_DIRS, undefined);
  assert.equal(captured.options.env.CODEBUDDY_IS_SANDBOX, '0');
  assert.equal(captured.options.windowsHide,true);assert.equal(captured.options.shell,false);
  assert.notEqual(captured.options.cwd,f.root);assert.equal(captured.options.env.CODEBUDDY_CONFIG_DIR,f.runtime.configDir);
});
test('qualification traverses host schema/staging, caches, coalesces and expires',async t=>{
  const f=await fixture(t);let calls=0,now=0;
  const qualification=createWorkBuddyQualification({now:()=>now,run:async(_runtime,prompt)=>{calls++;return resultFor(prompt);}});
  const [a,b]=await Promise.all([qualification.check(f.runtime),qualification.check(f.runtime)]);
  assert.equal(a.ready,true);assert.equal(b.cliHash,a.cliHash);assert.equal(calls,1);
  assert.equal(qualification.peek(f.runtime).ready,true);
  now+=30*60000+1;assert.equal(qualification.peek(f.runtime),null);
  await qualification.check(f.runtime);assert.equal(calls,2);
});
test('qualification rejects forged source/target; never enables broad directory execution',async t=>{
  const f=await fixture(t);let calls=0,now=0;
  const q=createWorkBuddyQualification({now:()=>now,run:async(_runtime,prompt)=>{
    calls++;const response=resultFor(prompt);response.artifacts[0].relativePath='../outside.md';return response;
  }});
  assert.equal((await q.check(f.runtime)).ready,false);await q.check(f.runtime);assert.equal(calls,1);
  now+=5*60000+1;await q.check(f.runtime);assert.equal(calls,2);
});
test('learning-card qualification and execution use a separate no-tool structured contract', async t => {
  const f = await fixture(t), { CONTENT_SCHEMA } = require('../electron/practice-cards.cjs');
  const card = { title: '乘法练习', subject: '数学', knowledgePoint: '乘法', rationale: '依据 E0', minutes: 5,
    sourceRefs: ['E0'], prompt: '6 × 7 等于多少？', hint: '使用乘法表', answer: '42', explanation: '6 × 7 = 42。' };
  const calls = [];
  const run = async (_runtime, prompt) => { calls.push(prompt); return card; };
  const qualification = createWorkBuddyQualification({ run });
  const material = await qualification.check(f.runtime);
  assert.equal(material.ready, false, 'card output cannot satisfy the material qualification');
  const qualified = await qualification.checkProfile(f.runtime, 'learning_card_generation.v1');
  assert.equal(qualified.ready, true); assert.equal(qualified.profile, 'learning_card_generation.v1');
  const adapter = await createWorkBuddyStructuredAdapter({ runtime: f.runtime, qualification: qualified, run });
  assert.deepEqual(await adapter.generate({ prompt: 'synthetic', schema: CONTENT_SCHEMA }), card);
  assert.match(calls.at(-1), /禁止读取本机文件、使用工具、访问网络/);
});
test('learning-card adapter rejects images, stale runtime and invalid results without fallback eligibility', async t => {
  const f = await fixture(t), { CONTENT_SCHEMA } = require('../electron/practice-cards.cjs');
  const cliHash = (await require('../electron/project-materials.cjs').hashStableFile(f.runtime.cliPath)).sha256;
  const qualification = { ready: true, profile: 'learning_card_generation.v1', cliHash };
  const adapter = await createWorkBuddyStructuredAdapter({ runtime: f.runtime, qualification, run: async () => ({}) });
  await assert.rejects(adapter.generate({ prompt: 'x', schema: CONTENT_SCHEMA, images: [{ bytes: Buffer.from('x') }] }), { code: 'AGENT_CONTRACT_REQUIRED' });
  await assert.rejects(adapter.generate({ prompt: 'x', schema: CONTENT_SCHEMA }), { code: 'AGENT_RESULT_INVALID' });
  await fs.writeFile(f.runtime.cliPath, 'changed');
  await assert.rejects(adapter.generate({ prompt: 'x', schema: CONTENT_SCHEMA }), { code: 'AGENT_POLICY_CHANGED' });
});
test('a CLI changed after qualification is refused before any student input or model call',async t=>{
  const f=await fixture(t),q=createWorkBuddyQualification({run:async(_r,p)=>resultFor(p)});
  const qualified=await q.check(f.runtime);assert.equal(qualified.ready,true);
  await fs.writeFile(f.runtime.cliPath,'new CLI bytes');let calls=0;
  await assert.rejects(executeMaterialWorkBuddy({runtime:f.runtime,qualification:qualified,batch:{},run:async()=>calls++}),/版本/);
  assert.equal(calls,0);
});
test('cancel waits for real process close, does not mistake kill request for exit',async t=>{
  const f=await fixture(t),controller=new AbortController();let child,killed=false,settled=false;
  const work=runFixedWorkBuddy(f.runtime,'synthetic',{signal:controller.signal,spawnProcess:()=>{
    child=new EventEmitter();child.pid=5;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.end=()=>{};child.kill=()=>{killed=true;return true;};return child;
  }}).finally(()=>{settled=true;});
  const rejected=assert.rejects(work,{code:'cancelled'});
  while(!child) await new Promise(r=>setImmediate(r));
  controller.abort();await new Promise(r=>setImmediate(r));assert.equal(killed,true);assert.equal(settled,false);
  child.emit('close',1);await rejected;
});

test('streaming past output budget reports contract_output_excessive without changing connection health', async t => {
  const f = await fixture(t);
  await assert.rejects(runFixedWorkBuddy(f.runtime, 'synthetic', { maxOutputBytes: 32, spawnProcess: () => {
    const child = new EventEmitter(); child.pid = 7;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.end = () => setImmediate(() => child.stdout.emit('data', Buffer.from('x'.repeat(64))));
    child.kill = () => { setImmediate(() => child.emit('close', 1)); return true; };
    return child;
  } }), error => {
    assert.equal(error.code, 'contract_output_excessive');
    assert.equal(error.stage, 'possibly_sent');
    assert.equal(error.stopConfirmed, true);
    return true;
  });
});

test('qualification timeout after first token reports contract_timeout', async t => {
  const f = await fixture(t);
  await assert.rejects(runFixedWorkBuddy(f.runtime, 'synthetic', { timeoutMs: 20, spawnProcess: () => {
    const child = new EventEmitter(); child.pid = 8;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.end = () => child.stdout.emit('data', Buffer.from('{'));
    child.kill = () => { setImmediate(() => child.emit('close', 1)); return true; };
    return child;
  } }), error => {
    assert.equal(error.code, 'contract_timeout');
    assert.equal(error.stage, 'possibly_sent');
    assert.equal(error.stopConfirmed, true);
    return true;
  });
});
