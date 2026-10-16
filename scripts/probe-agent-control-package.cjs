'use strict';
const { app } = require('electron');
const fs = require('node:fs/promises'), fss = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), vm = require('node:vm'), assert = require('node:assert/strict');
const resources = path.resolve(process.argv[2]), reportPath = path.resolve(process.argv[3]);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const report = { schema: 'edu.agent-control-package.v1', syntheticOnly: true, realVendorExecution: false, checks: [], passed: false };
  let host;
  try {
    const runtime = path.join(resources, 'app.asar', 'electron');
    const modules = ['agent-control-plane.cjs', 'agent-authorization-detection.cjs', 'agent-invocation-service.cjs', 'classification-auth.cjs',
      'ai-executor-registry.cjs', 'executor-adapter-manifests.cjs', 'standard-cli-provider.cjs', 'builtin-structured-provider.cjs', 'structured-contract-check.cjs', 'custom-options.cjs', 'agent-memory-v1.cjs', 'agent-task-channel.cjs',
      'llm-api-provider.cjs', 'main.cjs', 'planning-guidance.cjs', 'practice-cards.cjs', 'preload.cjs', 'project-material-agent.cjs', 'project-material-task.cjs', 'task-recovery-policy.cjs',
      'smart-inbox-agent.cjs', 'structured-generation.cjs', 'workbuddy-controlled.cjs', 'workbuddy-runtime.cjs', 'workbuddy-login.cjs'];
    report.hashes = {};
    for (const file of modules) {
      const source = await fs.readFile(path.join(__dirname, '../electron', file));
      const packed = await fs.readFile(path.join(runtime, file));
      assert.equal(packed.equals(source), true, `packaged source differs: ${file}`);
      report.hashes[file] = crypto.createHash('sha256').update(packed).digest('hex');
    }
    report.checks.push(`${modules.length} packaged production files match source bytes`);
    const packagedRegistry = require(path.join(runtime, 'ai-executor-registry.cjs')).executorRegistry();
    const packagedWorkBuddy = packagedRegistry.find(item => item.id === 'workbuddy');
    assert.ok(packagedWorkBuddy?.automaticProfiles.includes('learning_card_generation.v1'), 'packaged WorkBuddy missing learning-card contract');
    assert.equal(packagedWorkBuddy.automaticProfiles.includes('research.v1'), false, 'WorkBuddy research must remain separately qualified');
    report.checks.push('packaged WorkBuddy enables classification, digest and learning-card automation while research remains separately gated');
    const assets = path.join(resources, 'app.asar', 'dist', 'assets');
    const javascript = (await fs.readdir(assets)).filter(file => file.endsWith('.js'));
    const renderer = (await Promise.all(javascript.map(file => fs.readFile(path.join(assets, file), 'utf8')))).join('\n');
    for (const marker of ['R24 · Windows 候选', 'LLM API 连接设置', '接口协议', '结构化连接测试', '联网研究合同测试', '全局授权', '默认调度顺序',
      '自动优先', '仅手工交接', '选择参与自动调度的任务合同', '编辑接入方式与连接设置', '高级',
      'Agent 数据管理', 'Agent连接管理', '选择 Agent／执行器', 'AI对话采集', '对话分享资料箱', 'Agent会话自动采集']) {
      assert.ok(renderer.includes(marker), `packaged renderer missing: ${marker}`);
    }
    report.checks.push('packaged renderer includes R24 executor modes, contract controls, compact learning pages and grouped Agent settings');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-center-package-'));
    const control = require(path.join(runtime, 'agent-control-plane.cjs'));
    const policyStore = control.createAgentControlStore(path.join(root, 'agent-control', 'policies.json'));
    const student = { id: 'synthetic-student', agentTool: 'workbuddy' }, profile = 'digest_host_mediated.v1';
    const scope = { studentId: student.id };
    await policyStore.saveGlobal({ ...control.globalDefaults('workbuddy'), enabled: true, desktopHandoff: false });
    host = await require('../tests/helpers/smart-inbox-task-host.cjs').createTaskHost(root, { runtime });
    const source = await fs.readFile(path.join(runtime, 'main.cjs'), 'utf8');
    const automaticRoute = ['workbuddy', 'codex', 'qclaw', 'openclaw', 'claude-code', 'trae', 'qoder-work', 'llm-api'];
    const successProvider = { 'codex-success': 'codex', 'builtin-success': 'qclaw', 'api-success': 'llm-api' };
    let mode = 'success', calls = [], state;
    Object.assign(host.context, {
      require: name => require(path.join(runtime, name)), DIGEST_PROFILE: profile, crypto,
      findStudentByKey: () => student,
      agentControlPolicy: () => control.resolvePolicy(policyStore.read(), scope, profile, student),
      writeStudentDigestState: (_, v) => { state = v; }, notify() {}, taskCommandFor: () => 'synthetic command',
      submitProjectMaterialAttempt: async (task, project, providerId) => {
        calls.push(providerId);
        if (mode === 'unknown') return { ok: false, code: 'EXECUTION_UNRESOLVED', stage: 'possibly_sent' };
        if (providerId !== successProvider[mode]) return { ok: false, code: 'AUTHENTICATION_REQUIRED' };
        const store = host.context.readTaskStore(); host.context.transitionTaskInStore(store, task.id, 'running', { executionId: 'synthetic-run', adapterId: providerId }, 'synthetic_started');
        await host.context.writeTaskStoreDurably(store); return { ok: true, executionId: 'synthetic-run' };
      },
      submitWorkBuddyTask: async task => {
        calls.push('desktop'); const store = host.context.readTaskStore();
        host.context.transitionTaskInStore(store, task.id, 'waiting_result', { executionId: 'desktop-run', executionMode: 'desktop_handoff' }, 'synthetic_desktop');
        await host.context.writeTaskStoreDurably(store); return { ok: true, manualSendRequired: true };
      },
    });
    const start = source.indexOf('async function submitProjectMaterialTask(');
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), host.context);
    for (const scenario of ['codex-success', 'builtin-success', 'api-success', 'blocked', 'unknown', 'desktop']) {
      mode = scenario; calls = []; state = null;
      if (scenario === 'desktop') await policyStore.saveGlobal({ ...policyStore.read().global, desktopHandoff: true });
      const store = host.context.readTaskStore();
      const task = { id: `synthetic-${scenario}`, kind: 'student_digest', sourceId: student.id, status: 'approved', attempt: 0 };
      store.tasks.push(task); await host.context.writeTaskStoreDurably(store);
      const result = await host.context.submitProjectMaterialTask(task, { id: 'synthetic-project' }, 'auto', { student });
      const expectedCalls = scenario === 'unknown' ? ['workbuddy']
        : successProvider[scenario] ? automaticRoute.slice(0, automaticRoute.indexOf(successProvider[scenario]) + 1)
          : automaticRoute;
      assert.deepEqual(calls, expectedCalls);
      const saved = host.disk().tasks.find(t => t.id === task.id);
      assert.equal(saved.status, successProvider[scenario] ? 'running' : scenario === 'desktop' ? 'waiting_result' : 'blocked');
      if (scenario === 'blocked') assert.equal(state.status, 'failed');
      report.checks.push({ scenario, calls, status: saved.status, code: result.code || '', attempts: saved.routeDecision.attempts });
    }
    report.checks.push('real packaged main dispatcher and real packaged Worker persist routing and state; synthetic provider responses only');
    report.passed = true;
  } catch (e) { report.error = e.stack; }
  finally {
    await host?.close(); await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, error: report.error, reportPath })); app.exit(report.passed ? 0 : 1);
  }
});
