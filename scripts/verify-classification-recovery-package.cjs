'use strict';
// Runs packaged host selection/routing and the real Worker task store with
// synthetic files only. No student ledger or authentication files are modified.
const { app } = require('electron');
const fs = require('node:fs/promises'), fss = require('node:fs'), path = require('node:path'), os = require('node:os');
const vm = require('node:vm'), assert = require('node:assert/strict'), { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const resources = path.resolve(process.argv[2]), reportFile = path.resolve(process.argv[3]);
const codexPath = process.argv[4], workbuddyPath = process.argv[5];
if (!codexPath || !workbuddyPath) throw Error('Provide installed Codex CLI and WorkBuddy executable paths; input is synthetic only.');
const runtime = path.join(resources, 'app.asar', 'electron');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-classification-live-'));
  const report = { schema: 'edu.classification-recovery-package.v1', fixture: 'synthetic-only', actualAuthenticationEnvironment: true,
    startedAt: new Date().toISOString(), checks: [], runs: [], passed: false };
  let service, taskHost;
  try {
    Object.defineProperty(process, 'resourcesPath', { value: resources });
    const source = await fs.readFile(path.join(runtime, 'main.cjs'), 'utf8');
    // Production ASAR may be minified; use the syntax tree instead of looking
    // for a closing brace at the beginning of a line.
    const ts = require('typescript');
    const parsed = ts.createSourceFile('packaged-main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const load = (name, context) => {
      let found = null;
      function visit(node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
        if (!found) ts.forEachChild(node, visit);
      }
      visit(parsed);
      assert.ok(found, `packaged function ${name} missing`);
      vm.runInContext(source.slice(found.getStart(parsed), found.end), context);
    };
    const context = vm.createContext({ fs: fss, path, os, process, spawn, Buffer,
      require: name => name.startsWith('./') ? require(path.join(runtime, name)) : require(name),
      app: { isPackaged: true, getPath: name => { assert.equal(name, 'userData'); return path.join(process.env.APPDATA, 'edu-manager-launcher'); } },
      mainWindow: null, shell: { openExternal: () => { throw Error('Probe must not start login'); } },
      findPreferredCodexCliInstall: () => ({ exePath: codexPath }), findAgentToolInstall: () => ({ exePath: workbuddyPath }),
      refreshPreferredCodexCliInstall: async () => ({ exePath: codexPath }),
      builtinStructuredProvider: require(path.join(runtime, 'builtin-structured-provider.cjs')),
      findExecutableInPath: () => process.execPath,
      discoverWorkBuddyRuntime: require(path.join(runtime, 'workbuddy-runtime.cjs')).discoverWorkBuddyRuntime,
    });
    vm.runInContext('let classificationAuthRuntime;', context);
    load('resolveNodeCommandShim', context);
    context.spawn = (exe, args, options) => {
      const entry = { provider: /codex/i.test([exe, ...args].join(' ')) ? 'codex' : 'workbuddy', startedAt: new Date().toISOString() };
      report.runs.push(entry);
      const child = spawn(exe, args, { ...options, windowsHide: true,
        env: { ...(options.env || process.env), ELECTRON_RUN_AS_NODE: '1' } });
      child.once('close', code => { entry.code = code; entry.finishedAt = new Date().toISOString(); });
      return child;
    };
    load('commandWrapperPath', context); load('ensureCommandWrapper', context); load('spawnAdapterProcess', context);
    load('classificationAuth', context); load('classificationAdapter', context);
    const adapters = {};
    for (const id of ['workbuddy', 'codex']) adapters[id] = await context.classificationAdapter(id);
    report.checks.push('packaged main classificationAdapter uses actual persisted authentication descriptors and default vendor profiles');
    const student = { id: 'synthetic-recovery-student', agentTool: 'workbuddy', classificationFallback: { enabled: true, providerId: 'codex', version: 1 } };
    const secondStudent = { ...student, id: 'synthetic-second-student' };
    const students = [student, secondStudent];
    const project = { id: 'synthetic-recovery-project-42', name: '合成实验项目', studentIds: students.map(s => s.id),
      materialStorageMode: 'workspace-v1', workspacePath: path.join(root, 'destination'), managerPath: path.join(root, 'manager'), rawPath: path.join(root, 'raw') };
    const folder = path.join(root, 'source'), destination = path.join(root, 'destination'); await fs.mkdir(folder); await fs.mkdir(destination);
    const original = path.join(folder, 'synthetic.txt'); await fs.writeFile(original, `这是合成教育实验记录，项目编号：${project.id}。测量六次，每次七个单位，总数42。`);
    await fs.utimes(original, new Date(Date.now() - 10000), new Date(Date.now() - 10000));
    const hash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    const originalHash = await hash(original), deliveredReceipts = [];
    taskHost = await require('../tests/helpers/smart-inbox-task-host.cjs').createTaskHost(path.join(root, 'tasks'), { runtime });
    const qualifiers = new Map();
    const { createSmartInboxHost } = require(path.join(runtime, 'smart-inbox-host.cjs'));
    const materialHost = require(path.join(runtime, 'project-material-host.cjs')).createProjectMaterialHost(project);
    service = createSmartInboxHost({ directory: path.join(root, 'inbox'), students: () => [], student: id => students.find(s => s.id === id),
      projects: () => [project], isWorkspace: () => true, materialHost: () => materialHost, legacySettings: () => ({}), forbiddenRoots: () => [destination],
      automaticAllowed: () => true, acquire: () => () => {}, beginBatch: taskHost.beginBatch, endBatch: taskHost.endBatch,
      agent: { route: () => require(path.join(runtime, 'agent-invocation-service.cjs')).classificationRoute(student),
        select: (_, id) => adapters[id], spawnProcess: context.spawnAdapterProcess,
        qualification: { load: (_, key) => qualifiers.get(key), save: async (_, key, value) => { qualifiers.set(key, value); } } },
      validateTarget: target => { assert.ok(students.some(s => s.id === target.studentId)); assert.equal(target.id, project.id); return target; },
      // Isolated orchestration uses the packaged production material registry;
      // it does not exercise the application's main-process IPC delivery path.
      deliver: async (snapshot, target, item, checkpoint) => {
        const file = path.join(destination, '收件箱', target.studentId + '.txt');
        await checkpoint({ destinationPath: file });
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.copyFile(snapshot, file);
        assert.equal(await hash(snapshot), await hash(file));
        const result = await materialHost.registerTerminalUpload(file, { eventId: item.operationId, studentId: target.studentId,
          sourceType: 'host_material_source', intakeAssociation: { itemId: item.id, operationId: item.operationId } });
        const receipt = { ok: true, path: file, recordId: result.material.materialId };
        assert.ok(receipt.recordId); deliveredReceipts.push(receipt); return receipt;
      },
    });
    await service.initialize();
    const registered = await service.engine.updateSource({ folder, studentId: student.id, enabled: true, automatic: true });
    await service.engine.requestScan(registered.id); await service.engine.tick();
    const rows = (await service.engine.list({ status: 'delivered' })).rows;
    const pending = (await service.engine.list()).rows;
    const row = rows[0] || pending[0]; assert.ok(row);
    const detail = await service.engine.detail(row.id);
    report.status = row.status; report.execution = detail.execution;
    report.blockReason = detail.blockReason; report.message = detail.message;
    report.taskStatuses = taskHost.disk().tasks.map(t => t.status);
    assert.equal(row.status, 'delivered'); assert.equal(detail.target.id, project.id);
    assert.equal(await hash(original), originalHash);
    assert.equal(await hash(path.join(destination, '收件箱', student.id + '.txt')), originalHash);
    assert.equal(deliveredReceipts.length, 1);
    const registry = await materialHost.store.read();
    assert.ok(registry.materials.some(m => m.materialId === deliveredReceipts[0].recordId));
    report.checks.push('real Agent classified synthetic project; packaged material registry registered copy, original and copy hashes match');
    report.deliveryScope = 'isolated project using packaged production material registration; main-process IPC delivery path not exercised';
    if (detail.execution?.attempts?.length) report.checks.push('primary failed before student transmission and fallback completed');
    else report.checks.push('primary completed; real fallback scenario was not exercised');
    const before = report.runs.length; await service.engine.requestScan(registered.id); await service.engine.tick();
    assert.equal(report.runs.length, before); report.checks.push('unchanged rescan makes no additional Agent call');
    const secondFolder = path.join(root, 'second'); await fs.mkdir(secondFolder);
    const secondFile = path.join(secondFolder, 'second.txt');
    await fs.writeFile(secondFile, `另一名虚构学生的合成实验，项目编号：${project.id}。独立记录八组观察，只用于测试共享登录，不包含真实资料。`);
    const secondHash = await hash(secondFile);
    await fs.utimes(secondFile, new Date(Date.now() - 10000), new Date(Date.now() - 10000));
    const secondSource = await service.engine.updateSource({ folder: secondFolder, studentId: secondStudent.id, enabled: true, automatic: true });
    await service.engine.requestScan(secondSource.id); await service.engine.tick();
    const secondRow = (await service.engine.list({ studentId: secondStudent.id, status: 'delivered' })).rows[0];
    assert.ok(secondRow); assert.equal(secondRow.studentId, secondStudent.id);
    assert.equal(await hash(secondFile), secondHash);
    assert.equal(await hash(path.join(destination, '收件箱', secondStudent.id + '.txt')), secondHash);
    assert.equal(deliveredReceipts.length, 2);
    const secondRegistry = await materialHost.store.read();
    assert.ok(secondRegistry.materials.some(m => m.materialId === deliveredReceipts[1].recordId));
    assert.equal(report.runs.length - before, 1, 'second authorized student reuses login and qualification; only a classification invocation is added');
    report.secondStudent = { status: secondRow.status, newExternalCalls: report.runs.length - before, sharedQualification: true };
    report.checks.push('second authorized synthetic student uses same login and cached qualification, with one classification call and no extra login/probe');
    report.taskStatuses = taskHost.disk().tasks.map(t => t.status);
    report.passed = true;
  } catch (error) { report.error = error.message; }
  finally {
    await service?.engine.close(); await taskHost?.close();
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(reportFile), { recursive: true }); await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('edu-classification-live-')) await fs.rm(root, { recursive: true, force: true });
    console.log(JSON.stringify(report, null, 2)); app.exit(report.passed ? 0 : 1);
  }
});
