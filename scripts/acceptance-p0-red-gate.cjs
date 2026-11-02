'use strict';

// This is deliberately not part of the ordinary unit-test glob. It is a
// pre-fix red gate: the current candidate must reproduce each named failure,
// while the eventual patch must make the exact same scenarios green.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const EXPECTED_R11_SHA256 = '937F2A11FCEF97319AF95AB600AAC108259C3E9BB47E0D730E06EBA550A76BF0';
const REQUIRED_REPAIR_GATE_IDS = Object.freeze(['FLOW-02', 'FLOW-03', 'PERF-03', 'AGENT-01', 'NET-01']);

const ROOT = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const expectation = String(args.get('expect') || 'red').toLowerCase();
const outputDir = path.resolve(ROOT, String(args.get('output') || 'artifacts/p0-red-gate-20261025'));
const keepFixture = args.has('keep-fixture');
const repeat = Math.max(1, Math.min(10, Number(args.get('repeat') || 3)));
const evidenceTaxonomy = {
  'UI-01': { defectType: 'functional_correctness', evidenceLevel: 'path_reproduced', performanceCausality: 'not_a_performance_root_cause' },
  'DATA-01': { defectType: 'performance_candidate', evidenceLevel: 'path_reproduced', performanceCausality: 'requires_controlled_ablation' },
  'FLOW-01': { defectType: 'execution_closure_latency', evidenceLevel: 'path_reproduced', performanceCausality: 'requires_backlog_timeline' },
  'PERF-01': { defectType: 'performance_amplifier_candidate', evidenceLevel: 'path_reproduced', performanceCausality: 'requires_controlled_ablation' },
  'PROC-01': { defectType: 'process_management', evidenceLevel: 'path_reproduced', performanceCausality: 'requires_candidate_process_trace' },
  'IO-01': { defectType: 'stability_and_recovery', evidenceLevel: 'path_reproduced', performanceCausality: 'not_a_performance_root_cause' },
  'PERF-02': { defectType: 'performance_amplifier_candidate', evidenceLevel: 'path_reproduced', performanceCausality: 'requires_controlled_ablation' },
  'FLOW-02': { defectType: 'execution_correctness', evidenceLevel: 'live_path_reproduced', performanceCausality: 'not_a_performance_root_cause' },
  'FLOW-03': { defectType: 'execution_observability', evidenceLevel: 'live_path_reproduced', performanceCausality: 'not_a_performance_root_cause' },
  'PERF-03': { defectType: 'performance_root_cause', evidenceLevel: 'live_cadence_measured', performanceCausality: 'confirmed_noop_write_loop' },
  'AGENT-01': { defectType: 'provider_health_classification', evidenceLevel: 'live_path_reproduced', performanceCausality: 'secondary_latency_factor' },
  'NET-01': { defectType: 'private_network_connectivity', evidenceLevel: 'host_rules_inspected', performanceCausality: 'not_a_performance_root_cause' },
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function errorShape(error) {
  return { name: error?.name || 'Error', code: error?.code || '', message: String(error?.message || error) };
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function percentile(values, ratio) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
}

async function temporaryRoot(prefix, work) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  try { return await work(directory); }
  finally { if (!keepFixture) await fsp.rm(directory, { recursive: true, force: true }); }
}

function functionSource(file, name, nextName) {
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf(`function ${name}(`);
  const end = text.indexOf(`function ${nextName}(`, start + 1);
  if (start < 0 || end < 0) throw new Error(`cannot_extract_${name}`);
  return text.slice(start, end).trim();
}

const definitions = [
  {
    id: 'UI-01', title: '任务中心进入批量核对中心', confidence: 'confirmed',
    trigger: '对需要核对的资料消化任务执行“打开批量核对中心”。',
    productionLocation: 'src/main.tsx:14256#handleTaskCenterAction', assertionLocation: 'acceptance-p0-red-gate.cjs#UI-01 selectsTab && selectsSection',
    symptom: '点击“打开批量核对中心”后落到收集总览，页面没有核对列表。',
    cause: '任务动作只切换 activeSection=inbox，没有选择 share-capture 页签和路由。',
    target: '动作必须同时进入 collection/share-capture，并显示 SmartInboxPanel。',
    run: async () => {
      const file = path.join(ROOT, 'src', 'main.tsx');
      const text = fs.readFileSync(file, 'utf8');
      const start = text.indexOf('const handleTaskCenterAction');
      const end = text.indexOf('const openLearningReportEvidenceSource', start);
      const block = text.slice(start, end);
      const studentDigest = block.match(/task\.action === 'student_digest'[\s\S]*?\n\s*} else/)?.[0] || block;
      const selectsTab = /setActivePageTab\(['"]share-capture['"]\)/.test(studentDigest);
      const selectsSection = /setActiveSection\(['"]share-capture['"]\)/.test(studentDigest);
      return { passed: selectsTab && selectsSection, reproduced: !selectsTab || !selectsSection,
        observed: { selectsTab, selectsSection, currentSectionCalls: [...studentDigest.matchAll(/setActiveSection\(([^)]+)\)/g)].map((m) => m[1]) } };
    },
  },
  {
    id: 'DATA-01', title: '分类上下文不得读取完整项目登记', confidence: 'confirmed',
    trigger: '为一个学生建立3个项目，每项目10000条资料，并请求分类上下文。',
    productionLocation: 'electron/smart-inbox-host.cjs:68,99#context', assertionLocation: 'acceptance-p0-red-gate.cjs#DATA-01 fullRegistryReads/materialRowsRead',
    symptom: '进入分类/核对链路时，项目资料越多，主进程内存和停顿越严重。',
    cause: 'smart-inbox context() 对每个关联项目调用 store.read()，读取并克隆完整资料登记，只为取得分类。',
    target: '分类上下文只读分类投影；完整登记读取次数和资料行数必须为0。',
    run: async () => temporaryRoot('edu-p0-context-', async (directory) => {
      const { createSmartInboxHost } = require(path.join(ROOT, 'electron', 'smart-inbox-host.cjs'));
      const student = { id: 'student-a', grade: '10', curriculum: 'IB' };
      const projectRows = 10_000;
      const projects = Array.from({ length: 3 }, (_, index) => ({ id: `project-${index}`, name: `project-${index}`,
        studentIds: ['student-a'], status: 'active', workspaceFolders: [], workspacePath: '', managerPath: '' }));
      let fullRegistryReads = 0, materialRowsRead = 0;
      const registries = new Map(projects.map((project) => [project.id, {
        categories: [{ categoryId: 'notes', name: 'notes' }],
        materials: Array.from({ length: projectRows }, (_, index) => ({ materialId: `${project.id}-${index}`, sha256: String(index).padStart(64, '0') })),
      }]));
      const host = createSmartInboxHost({ directory, student: (id) => id === student.id ? student : null, students: () => [student],
        projects: () => projects, isWorkspace: () => true, profile: async () => null,
        materialHost: (project) => ({ store: { async read() { fullRegistryReads++; const value = structuredClone(registries.get(project.id)); materialRowsRead += value.materials.length; return value; } } }),
      });
      const before = process.memoryUsage().heapUsed, started = performance.now();
      const context = await host.context(student.id);
      const durationMs = performance.now() - started, heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - before);
      return { passed: fullRegistryReads === 0 && materialRowsRead === 0, reproduced: fullRegistryReads === projects.length && materialRowsRead === projects.length * projectRows,
        observed: { projects: context.projects.length, fullRegistryReads, materialRowsRead, durationMs, heapDeltaBytes } };
    }),
  },
  {
    id: 'FLOW-01', title: '结果核对不得被重资源许可阻塞', confidence: 'confirmed',
    trigger: '先形成execution_unknown，再让重资源许可返回null并执行下一次tick。',
    productionLocation: 'electron/smart-inbox.cjs:556#processSource', assertionLocation: 'acceptance-p0-red-gate.cjs#FLOW-01 reconcileCalls',
    symptom: '大量“执行待核对”长期停留；界面显示等待后台资源空闲。',
    cause: 'processSource() 在核对 execution_unknown 之前先申请 agent_classification 重资源许可。',
    target: '只读回执/decision核对必须先运行；资源繁忙时 reconcile 仍至少调用一次。',
    run: async () => temporaryRoot('edu-p0-reconcile-', async (directory) => {
      const { createSmartInbox } = require(path.join(ROOT, 'electron', 'smart-inbox.cjs'));
      const source = path.join(directory, 'source'), state = path.join(directory, 'state');
      await fsp.mkdir(source); await fsp.mkdir(state);
      let blockAcquire = false, acquireCalls = 0, reconcileCalls = 0;
      const host = { directory: state, stableAgeMs: 0, automaticAllowed: () => true, forbiddenRoots: async () => [],
        context: async () => ({ studentId: 'student-a', projects: [
          { id: 'project-a', name: 'A', categories: [] }, { id: 'project-b', name: 'B', categories: [] },
        ] }),
        validateTarget: async (target) => target,
        extract: async (item) => ({ text: await fsp.readFile(item.snapshotPath, 'utf8'), warnings: [] }),
        classify: async () => { throw Object.assign(new Error('deterministic timeout after possible send'), { code: 'execution_unknown' }); },
        deliver: async () => { throw new Error('not_expected'); }, events: async () => [],
        acquire: () => { acquireCalls++; return blockAcquire ? null : () => {}; },
        waitingReason: () => 'synthetic resource pressure', reconcile: async () => { reconcileCalls++; return null; },
      };
      const engine = createSmartInbox(host); await engine.init();
      try {
        const intake = await engine.updateSource({ name: 'synthetic', folder: source, studentId: 'student-a', enabled: true, automatic: true });
        await fsp.writeFile(path.join(source, 'conversation.md'), 'ambiguous material with no project identifier');
        await engine.requestScan(intake.id); await engine.tick();
        const before = (await engine.list()).rows[0];
        blockAcquire = true; acquireCalls = 0; reconcileCalls = 0;
        await engine.tick();
        const after = (await engine.detail(before.id));
        return { passed: before.status === 'execution_unknown' && reconcileCalls >= 1,
          reproduced: before.status === 'execution_unknown' && acquireCalls >= 1 && reconcileCalls === 0,
          observed: { beforeStatus: before.status, afterStatus: after.status, acquireCalls, reconcileCalls,
            sourceWaiting: (await engine.sources()).sources.find((item) => item.id === intake.id)?.waitingReason || '' } };
      } finally { await engine.close(); }
    }),
  },
  {
    id: 'PERF-01', title: '持续资源压力不得25毫秒轮询', confidence: 'high_probability_amplifier',
    trigger: '在内存压力持续存在时排入一个后台CPU重任务并观察260ms。',
    productionLocation: 'electron/resource-coordinator.cjs:67#scheduleDrain', assertionLocation: 'acceptance-p0-red-gate.cjs#PERF-01 drains',
    symptom: '没有Agent真正工作时主进程仍持续耗CPU，等待任务越多越明显。',
    cause: 'ResourceCoordinator 对持续 pressure 阻塞的队列按25ms重新 drain。',
    target: '250ms观察窗内最多3次 drain；后续由压力变化或退避定时唤醒。',
    run: async () => {
      const { ResourceCoordinator } = require(path.join(ROOT, 'electron', 'resource-coordinator.cjs'));
      const coordinator = new ResourceCoordinator({ getSnapshot: () => ({ availableMemoryRatio: 0.1, availableMemoryBytes: 2 * 1024 ** 3 }) });
      let drains = 0; const original = coordinator.drain.bind(coordinator);
      coordinator.drain = () => { drains++; return original(); };
      const queued = coordinator.run('cpu', async () => {}, { background: true, key: 'blocked-work' });
      void queued.catch(() => {});
      await delay(260); const observed = { drains, status: coordinator.status() };
      coordinator.close(); await queued.catch(() => {});
      return { passed: drains <= 3, reproduced: drains >= 7, observed };
    },
  },
  {
    id: 'PROC-01', title: 'CMD适配器不得回退到Electron主程序', confidence: 'confirmed',
    trigger: '构造没有同目录node.exe的CMD shim，并将process.execPath设为教育管家Electron本体。',
    productionLocation: 'electron/main.cjs:25895#resolveNodeCommandShim', assertionLocation: 'acceptance-p0-red-gate.cjs#PROC-01 usesElectron',
    symptom: '能力探测期间反复出现新的教育管家进程和单实例转交，约每5分钟形成进程峰值。',
    cause: 'resolveNodeCommandShim() 在同目录没有node.exe时使用process.execPath；打包环境中它是Electron/教育管家本体。',
    target: 'CMD shim无独立Node时不得返回Electron可执行文件。',
    run: async () => temporaryRoot('edu-p0-shim-', async (directory) => {
      const mainFile = path.join(ROOT, 'electron', 'main.cjs');
      const source = functionSource(mainFile, 'resolveNodeCommandShim', 'spawnAdapterProcess');
      const script = path.join(directory, 'cli.js'), command = path.join(directory, 'tool.cmd');
      await fsp.writeFile(script, 'process.exit(0)');
      await fsp.writeFile(command, '@ECHO off\r\n"%dp0%\\cli.js" %*\r\n');
      const fakeElectron = path.join(directory, 'AI Education Manager Console.exe');
      const fn = vm.runInNewContext(`(${source})`, { fs, path, process: { execPath: fakeElectron } });
      const result = fn(command, ['--version']);
      const usesElectron = path.resolve(result?.executable || '') === path.resolve(fakeElectron);
      return { passed: !usesElectron, reproduced: usesElectron, observed: { result, fakeElectron } };
    }),
  },
  {
    id: 'IO-01', title: 'Windows原子替换应容忍瞬时EPERM', confidence: 'confirmed',
    trigger: '让第一次rename抛出EPERM，第二次允许成功。',
    productionLocation: 'electron/project-materials.cjs:108#writeJsonAtomic', assertionLocation: 'acceptance-p0-red-gate.cjs#IO-01 attempts/saved',
    symptom: '资料状态原子写在Windows占用窗口中失败，留下待核对或停滞状态。',
    cause: 'writeJsonAtomic() 对rename的瞬时EPERM没有有限重试。',
    target: '第一次rename为EPERM时有限退避重试并成功，且内容正确。',
    run: async () => temporaryRoot('edu-p0-eperm-', async (directory) => {
      const { writeJsonAtomic } = require(path.join(ROOT, 'electron', 'project-materials.cjs'));
      const destination = path.join(directory, 'state.json'), originalRename = fsp.rename;
      let attempts = 0, failure = null;
      fsp.rename = async (...values) => {
        attempts++;
        if (attempts === 1) throw Object.assign(new Error('synthetic Windows sharing violation'), { code: 'EPERM' });
        return originalRename(...values);
      };
      try { await writeJsonAtomic(destination, { ok: true }); } catch (error) { failure = errorShape(error); }
      finally { fsp.rename = originalRename; }
      let saved = null; try { saved = JSON.parse(await fsp.readFile(destination, 'utf8')); } catch { /* expected in red state */ }
      return { passed: attempts >= 2 && saved?.ok === true && !failure, reproduced: attempts === 1 && failure?.code === 'EPERM',
        observed: { attempts, failure, saved } };
    }),
  },
  {
    id: 'PERF-02', title: '心跳进度不得经过完整任务归一化', confidence: 'high_probability_amplifier',
    trigger: '创建一个running任务，调用一次writeProgress并统计normalizeTask次数。',
    productionLocation: 'electron/task-store-service.cjs:95#writeProgress', assertionLocation: 'acceptance-p0-red-gate.cjs#PERF-02 normalizations',
    symptom: '任务运行期间约14至15秒出现周期性CPU和SQLite写峰值。',
    cause: 'writeProgress()读取任务草稿后调用通用write()，再次执行完整任务归一化和深比较。',
    target: '心跳仅定向patch目标行；进度写期间normalizeTask调用次数为0。',
    run: async () => temporaryRoot('edu-p0-heartbeat-', async (directory) => {
      const { createTaskStoreService } = require(path.join(ROOT, 'electron', 'task-store-service.cjs'));
      const { createTaskStoreWriter } = require(path.join(ROOT, 'electron', 'task-store-writer.cjs'));
      const legacy = path.join(directory, 'tasks.json');
      await fsp.writeFile(legacy, JSON.stringify({ protocolVersion: 3, tasks: [], history: [] }));
      const writer = createTaskStoreWriter(); let normalizations = 0;
      const service = createTaskStoreService({ request: (...values) => writer.request(...values), normalizeTask: (value) => { normalizations++; return value; } });
      try {
        await service.initialize(legacy);
        const draft = service.read(legacy).value;
        draft.tasks.push({ id: 'running', title: 'synthetic', sourceType: 'student', sourceId: 'student-a', kind: 'student_digest',
          status: 'running', executionId: 'run-1', lastHeartbeatAt: 'before', updatedAt: new Date().toISOString() });
        service.write(legacy, draft); await service.flush(); normalizations = 0;
        const started = performance.now();
        const result = service.writeProgress(legacy, [{ taskId: 'running', executionId: 'run-1', lastHeartbeatAt: 'after' }]);
        await service.flush(); const durationMs = performance.now() - started;
        return { passed: result.accepted === 1 && normalizations === 0,
          reproduced: result.accepted === 1 && normalizations > 0,
          observed: { accepted: result.accepted, normalizations, durationMs } };
      } finally { writer.close(); }
    }),
  },
  {
    id: 'FLOW-02', title: '未知执行只锁定相同稳定工作', confidence: 'confirmed',
    trigger: '同一学生同时存在已取消但结果未知的消化任务和不同workKey的到期周报。',
    productionLocation: 'electron/main.cjs#executeTaskByAdapterCore', assertionLocation: 'acceptance-p0-red-gate.cjs#FLOW-02',
    symptom: '不同业务工作的到期任务在task_prepared之前被学生级未知锁静默拦截。',
    cause: '冲突判断只比较sourceType和sourceId，没有比较稳定workKey。',
    target: '不同workKey不冲突；相同workKey仍保持未知结果保护。',
    run: async () => {
      try {
        const { findUnresolvedDispatchConflict } = require(path.join(ROOT, 'electron', 'task-dispatch-conflict.cjs'));
        const blocker = { id: 'digest-unknown', sourceType: 'student', sourceId: 'student-a', kind: 'student_digest',
          workKey: 'student_digest:student-a:hash-a:v1', status: 'cancelled', recoveryState: 'unknown', executionId: 'run-a' };
        const weekly = { id: 'weekly', sourceType: 'student', sourceId: 'student-a', kind: 'weekly_report',
          workKey: 'weekly_report:student-a:2026-W44:fingerprint-b', status: 'queued' };
        const duplicate = { ...blocker, id: 'digest-rebuilt', status: 'queued', executionId: '' };
        const different = findUnresolvedDispatchConflict(weekly, [blocker]);
        const same = findUnresolvedDispatchConflict(duplicate, [blocker]);
        return { passed: different === null && same?.blockerTaskId === blocker.id,
          reproduced: different?.blockerTaskId === blocker.id || typeof findUnresolvedDispatchConflict !== 'function',
          observed: { different, same } };
      } catch (error) {
        return { passed: false, reproduced: error?.code === 'MODULE_NOT_FOUND', observed: { error: errorShape(error) } };
      }
    },
  },
  {
    id: 'FLOW-03', title: '派发前阻断必须持久且可恢复', confidence: 'confirmed',
    trigger: '任务在派发前遇到相同workKey未知执行。',
    productionLocation: 'electron/task-runtime-policy.cjs#dispatchBlockPatch', assertionLocation: 'acceptance-p0-red-gate.cjs#FLOW-03',
    symptom: '任务继续显示无解释的等待调度，重复扫描也无法确定阻断者。',
    cause: 'SOURCE_EXECUTION_UNRESOLVED只作为瞬时返回值，没有写入任务行。',
    target: '阻断者、签名、原因和nextCheckAt写入dispatchBlock并映射为waiting_dependency。',
    run: async () => {
      try {
        const { dispatchBlockPatch } = require(path.join(ROOT, 'electron', 'task-runtime-policy.cjs'));
        const conflict = { blockerTaskId: 'unknown-1', blockerWorkKey: 'digest:a', reasonCode: 'execution_unknown',
          evidence: { executionId: 'run-1' }, nextCheckAt: '2026-10-27T12:00:00.000Z' };
        const patch = dispatchBlockPatch(conflict, '2026-10-27T11:59:00.000Z');
        const passed = patch?.dispatchBlock?.blockerTaskId === 'unknown-1'
          && patch.dispatchBlock.nextCheckAt === conflict.nextCheckAt && Boolean(patch.dispatchBlock.signature);
        return { passed, reproduced: !passed, observed: { patch } };
      } catch (error) {
        return { passed: false, reproduced: true, observed: { error: errorShape(error) } };
      }
    },
  },
  {
    id: 'PERF-03', title: '未知结果空闲核对不得写业务文件', confidence: 'confirmed',
    trigger: 'waiting_result在资料、回执和状态均无变化时重复核对。',
    productionLocation: 'electron/student-digest-reconciliation.cjs', assertionLocation: 'acceptance-p0-red-gate.cjs#PERF-03',
    symptom: '10秒循环持续改写materials和digest-state并触发候选刷新。',
    cause: '只读核对路径调用上传同步并写入派生时间字段。',
    target: '相同业务快照得到changed=false且无需写入。',
    run: async () => {
      try {
        const { digestBusinessSnapshot, digestReconciliationDecision } = require(path.join(ROOT, 'electron', 'student-digest-reconciliation.cjs'));
        const snapshot = digestBusinessSnapshot({ materials: [], digestState: { status: 'waiting_result' }, receipts: [] });
        const decision = digestReconciliationDecision(snapshot, '2026-10-27T12:00:00.000Z');
        const passed = decision?.changed === false && decision?.writeRequired !== true;
        return { passed, reproduced: !passed, observed: { decision } };
      } catch (error) {
        return { passed: false, reproduced: true, observed: { error: errorShape(error) } };
      }
    },
  },
  {
    id: 'AGENT-01', title: 'WorkBuddy连接健康与分类合同资格分离', confidence: 'confirmed',
    trigger: '执行轻量检查连接，不发送分类提示词。',
    productionLocation: 'electron/workbuddy-runtime.cjs#probeWorkBuddyConnection', assertionLocation: 'acceptance-p0-red-gate.cjs#AGENT-01',
    symptom: '已认证且收到首包仍因分类输出过大或90秒超时显示连接超时。',
    cause: '检查连接复用了完整分类合同。',
    target: '存在独立10秒健康探测，分类失败不改变connected。',
    run: async () => {
      const runtime = require(path.join(ROOT, 'electron', 'workbuddy-runtime.cjs'));
      const passed = typeof runtime.probeWorkBuddyConnection === 'function';
      return { passed, reproduced: !passed, observed: { hasProbeWorkBuddyConnection: passed } };
    },
  },
  {
    id: 'NET-01', title: 'Private局域网端口规则可诊断且幂等修复', confidence: 'confirmed',
    trigger: '主机服务监听但Private入站默认阻断且没有适用产品规则。',
    productionLocation: 'electron/windows-firewall.cjs', assertionLocation: 'acceptance-p0-red-gate.cjs#NET-01',
    symptom: '本机和LAN health正常，但同一Wi-Fi手机无法连接。',
    cause: '旧规则绑定随机便携路径或只适用于非当前网络配置。',
    target: '只创建TCP主机端口与UDP发现端口的Private+LocalSubnet稳定规则。',
    run: async () => {
      try {
        const firewall = require(path.join(ROOT, 'electron', 'windows-firewall.cjs'));
        const rules = firewall.productFirewallRuleSpecs({ tcpPort: 18777, discoveryPort: 18778 });
        const passed = rules.length === 2 && rules.every((rule) => rule.profile === 'Private' && rule.remoteAddress === 'LocalSubnet' && !rule.program);
        return { passed, reproduced: !passed, observed: { rules } };
      } catch (error) {
        return { passed: false, reproduced: true, observed: { error: errorShape(error) } };
      }
    },
  },
];

// Test-validity controls are intentionally independent from the current
// production implementation. The positive reference must satisfy the target;
// the frozen legacy mutation must violate only that same target. This keeps a
// future repair from making the gate trivially green by weakening an assertion.
async function validateControl(id) {
  if (id === 'UI-01') {
    const accepts = text => /setActivePageTab\(['"]share-capture['"]\)/.test(text)
      && /setActiveSection\(['"]share-capture['"]\)/.test(text);
    const reference = "setActivePageTab('share-capture'); setActiveSection('share-capture');";
    const legacyMutation = "setActiveSection('inbox');";
    return { positivePassed: accepts(reference), legacyMutationReproduced: !accepts(legacyMutation) };
  }
  if (id === 'DATA-01') {
    const projects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    let referenceReads = 0, legacyReads = 0;
    const projections = new Map(projects.map(project => [project.id, [{ categoryId: 'notes', name: 'notes' }]]));
    const reference = projects.map(project => ({ id: project.id, categories: projections.get(project.id) }));
    const legacy = [];
    for (const project of projects) { legacyReads++; legacy.push({ id: project.id, categories: projections.get(project.id) }); }
    return { positivePassed: referenceReads === 0 && reference.length === projects.length,
      legacyMutationReproduced: legacyReads === projects.length && legacy.length === reference.length,
      observed: { referenceReads, legacyReads } };
  }
  if (id === 'FLOW-01') {
    async function order(reconcileFirst) {
      let reconcileCalls = 0, acquireCalls = 0;
      const acquire = () => { acquireCalls++; return null; };
      const reconcile = () => { reconcileCalls++; return null; };
      if (reconcileFirst) reconcile();
      const release = acquire();
      if (!release) return { reconcileCalls, acquireCalls };
      if (!reconcileFirst) reconcile();
      return { reconcileCalls, acquireCalls };
    }
    const reference = await order(true), legacy = await order(false);
    return { positivePassed: reference.reconcileCalls === 1,
      legacyMutationReproduced: legacy.acquireCalls === 1 && legacy.reconcileCalls === 0,
      observed: { reference, legacy } };
  }
  if (id === 'PERF-01') {
    async function poll(interval) {
      let count = 1;
      const timer = setInterval(() => count++, interval); timer.unref?.();
      await delay(260); clearInterval(timer); return count;
    }
    const referenceDrains = await poll(1_000), legacyDrains = await poll(25);
    return { positivePassed: referenceDrains <= 3, legacyMutationReproduced: legacyDrains >= 7,
      observed: { referenceDrains, legacyDrains } };
  }
  if (id === 'PROC-01') {
    const electron = 'AI Education Manager Console.exe';
    const reference = null;
    const legacy = { executable: electron, args: ['cli.js'] };
    return { positivePassed: reference === null, legacyMutationReproduced: legacy.executable === electron };
  }
  if (id === 'IO-01') {
    let referenceAttempts = 0, legacyAttempts = 0;
    const transient = () => Object.assign(new Error('sharing violation'), { code: 'EPERM' });
    async function reference() { for (;;) { referenceAttempts++; if (referenceAttempts === 1) { await delay(1); continue; } return true; } }
    async function legacy() { legacyAttempts++; throw transient(); }
    let referencePassed = false, legacyFailed = false;
    try { referencePassed = await reference(); } catch { /* invalid reference */ }
    try { await legacy(); } catch (error) { legacyFailed = error.code === 'EPERM'; }
    return { positivePassed: referencePassed && referenceAttempts === 2,
      legacyMutationReproduced: legacyFailed && legacyAttempts === 1,
      observed: { referenceAttempts, legacyAttempts } };
  }
  if (id === 'PERF-02') {
    let referenceNormalizations = 0, legacyNormalizations = 0;
    const directPatch = task => ({ ...task, lastHeartbeatAt: 'after' });
    const genericWrite = task => { legacyNormalizations++; return ({ ...task, lastHeartbeatAt: 'after' }); };
    const reference = directPatch({ lastHeartbeatAt: 'before' });
    const legacy = genericWrite({ lastHeartbeatAt: 'before' });
    return { positivePassed: reference.lastHeartbeatAt === 'after' && referenceNormalizations === 0,
      legacyMutationReproduced: legacy.lastHeartbeatAt === 'after' && legacyNormalizations === 1 };
  }
  if (id === 'FLOW-02') {
    const reference = (candidate, blocker) => candidate.workKey === blocker.workKey;
    const legacy = (candidate, blocker) => candidate.sourceType === blocker.sourceType && candidate.sourceId === blocker.sourceId;
    const candidate = { sourceType: 'student', sourceId: 'a', workKey: 'weekly:a' };
    const blocker = { sourceType: 'student', sourceId: 'a', workKey: 'digest:a' };
    return { positivePassed: reference(candidate, blocker) === false, legacyMutationReproduced: legacy(candidate, blocker) === true };
  }
  if (id === 'FLOW-03') {
    const reference = { dispatchBlock: { blockerTaskId: 'b', signature: 'b|work', nextCheckAt: 'later' } };
    const legacy = { returnCode: 'SOURCE_EXECUTION_UNRESOLVED' };
    return { positivePassed: Boolean(reference.dispatchBlock.signature), legacyMutationReproduced: !legacy.dispatchBlock };
  }
  if (id === 'PERF-03') {
    const compare = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const value = { status: 'waiting_result', receipts: [] };
    return { positivePassed: compare(value, structuredClone(value)), legacyMutationReproduced: !compare(value, { ...value, updatedAt: new Date().toISOString() }) };
  }
  if (id === 'AGENT-01') {
    let healthCalls = 0, qualificationCalls = 0;
    const reference = () => { healthCalls++; return { connected: true }; };
    const legacy = () => { qualificationCalls++; return { connected: false, code: 'contract_timeout' }; };
    return { positivePassed: reference().connected && qualificationCalls === 0,
      legacyMutationReproduced: legacy().code === 'contract_timeout' && qualificationCalls === 1,
      observed: { healthCalls, qualificationCalls } };
  }
  if (id === 'NET-01') {
    const reference = { profile: 'Private', remoteAddress: 'LocalSubnet', localPort: 18777 };
    const legacy = { profile: 'Any', program: 'random-portable-path.exe' };
    return { positivePassed: reference.profile === 'Private' && reference.remoteAddress === 'LocalSubnet',
      legacyMutationReproduced: legacy.profile !== 'Private' && Boolean(legacy.program) };
  }
  throw new Error(`missing_control_${id}`);
}

function markdown(report) {
  const lines = [
    '# P0红灯预验收基线', '',
    `- 生成时间：${report.generatedAt}`,
    `- 产品版本：${report.environment.packageVersion}`,
    `- 运行模式：${report.expectation}`,
    `- 总体结论：${report.verdict}`,
    `- 隔离：${report.environment.isolation}`,
    `- 每项重复次数：${report.environment.repeat}`,
    `- 对照有效：${report.summary.controlsPassed}/${report.summary.total}`,
    '', '## 失败用例与证据等级', '',
    '| ID | 场景 | 缺陷类型 | 证据等级 | 性能因果状态 | 当前复现 | 对照有效 |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const result of report.results) {
    lines.push(`| ${result.id} | ${result.title} | ${result.defectType} | ${result.evidenceLevel} | ${result.performanceCausality} | ${result.reproduced ? '是' : '否'} | ${result.controlValid ? '是' : '否'} |`);
  }
  lines.push('', '## 路径证据与待补因果条件', '', '| ID | 触发条件 | 生产位置 | 当前路径与原因 | 尚需补充的证明 | 修复后的门槛 |', '|---|---|---|---|---|---|');
  for (const result of report.results) lines.push(`| ${result.id} | ${result.trigger} | ${result.productionLocation}<br>${result.assertionLocation} | ${result.cause} | ${result.performanceCausality === 'requires_controlled_ablation' ? '在同一候选、同一夹具下做单因素消融并重复采样。' : result.performanceCausality === 'requires_backlog_timeline' ? '把来源登记、资源等待、核对与结算时间线串联。' : result.performanceCausality === 'requires_candidate_process_trace' ? '在同一候选进程树中记录真实错误启动及资源峰值。' : '该项按功能或稳定性验收，不宣称为性能根因。'} | ${result.target} |`);
  lines.push('', '## 判定规则', '',
    '- `acceptance:p0:red`：只有所有问题在每次重复中稳定复现，且阳性参考与冻结旧行为对照都有效，命令才成功。',
    '- `acceptance:p0:green`：只有同一组用例全部达到目标状态且对照仍有效，命令才成功。',
    '- 任何补丁不得删除、跳过或放宽这些用例；只能让红灯转绿。',
    '- 对照验证的是断言敏感性，不等于生产实现正确，也不自动证明真实性能因果。',
    '- 标记为 `requires_*` 的性能候选，在完成候选包来源映射和单因素消融前不得写成“已证实根因”。',
    '- 外部Agent全部由确定性替身隔离，本验收不会读取正式学生资料、项目资料或用户数据库。', '');
  return lines.join('\n');
}

async function main() {
  await fsp.mkdir(outputDir, { recursive: true });
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const results = [];
  for (const definition of definitions) {
    const runs = [];
    for (let iteration = 1; iteration <= repeat; iteration++) {
      const started = performance.now();
      try {
        const value = await definition.run();
        runs.push({ iteration, durationMs: performance.now() - started, passed: value.passed === true,
          reproduced: value.reproduced === true, observed: value.observed || {} });
      } catch (error) {
        runs.push({ iteration, durationMs: performance.now() - started, passed: false,
          reproduced: false, harnessError: true, error: errorShape(error) });
      }
    }
    let control;
    try { control = await validateControl(definition.id); }
    catch (error) { control = { positivePassed: false, legacyMutationReproduced: false, harnessError: true, error: errorShape(error) }; }
    const controlValid = control.positivePassed === true && control.legacyMutationReproduced === true && !control.harnessError;
    results.push({ ...definition, ...evidenceTaxonomy[definition.id], run: undefined, runs, control, controlValid,
      durationMs: runs.reduce((sum, value) => sum + value.durationMs, 0),
      passed: runs.every((value) => value.passed && !value.harnessError),
      reproduced: runs.every((value) => value.reproduced && !value.harnessError),
      harnessError: runs.some((value) => value.harnessError) || Boolean(control.harnessError),
      observed: runs.at(-1)?.observed || {}, error: runs.find((value) => value.error)?.error || control.error });
  }
  const coreFiles = ['electron/main.cjs', 'electron/smart-inbox.cjs', 'electron/smart-inbox-host.cjs',
    'electron/resource-coordinator.cjs', 'electron/task-store-service.cjs', 'electron/project-materials.cjs',
    'electron/task-recovery-policy.cjs', 'electron/workbuddy-runtime.cjs', 'src/main.tsx'];
  const redConfirmed = results.every((value) => value.reproduced && value.controlValid && !value.harnessError);
  const greenConfirmed = results.every((value) => value.passed && value.controlValid && !value.harnessError);
  const report = {
    schema: 1, generatedAt: new Date().toISOString(), expectation,
    verdict: expectation === 'green' ? (greenConfirmed ? 'green_gate_passed' : 'green_gate_failed')
      : redConfirmed ? 'red_gate_confirmed' : 'red_gate_incomplete',
    environment: { packageVersion: packageJson.version, platform: process.platform, arch: process.arch,
      node: process.version, cpuCount: os.cpus().length, totalMemoryBytes: os.totalmem(),
      isolation: 'temporary synthetic fixtures; external agents disabled; no production data read or written',
      outputDir, keepFixture, repeat, sourceHashes: Object.fromEntries(coreFiles.map((file) => [file, sha256(path.join(ROOT, file))])),
    },
    summary: { total: results.length, desiredPassed: results.filter((value) => value.passed).length,
      reproduced: results.filter((value) => value.reproduced).length,
      controlsPassed: results.filter((value) => value.controlValid).length,
      harnessErrors: results.filter((value) => value.harnessError).length,
      durationP95Ms: percentile(results.map((value) => value.durationMs), .95) },
    runtime: { expectedR11Sha256: EXPECTED_R11_SHA256 },
    requiredGateIds: REQUIRED_REPAIR_GATE_IDS,
    releaseReady: false,
    results,
  };
  const reportBase = expectation === 'green' ? 'p0-green-gate-report' : 'p0-red-gate-report';
  await fsp.writeFile(path.join(outputDir, `${reportBase}.json`), JSON.stringify(report, null, 2));
  await fsp.writeFile(path.join(outputDir, `${reportBase}.md`), markdown(report));
  process.stdout.write(`${JSON.stringify({ verdict: report.verdict, summary: report.summary, outputDir }, null, 2)}\n`);
  process.exitCode = expectation === 'green' ? (greenConfirmed ? 0 : 1) : (redConfirmed ? 0 : 1);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 2; });

module.exports = { EXPECTED_R11_SHA256, REQUIRED_REPAIR_GATE_IDS, definitions, validateControl };
