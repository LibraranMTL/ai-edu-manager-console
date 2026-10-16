'use strict';
// Runs packaged host selection/routing and the real Worker task store with
// synthetic files only. No student ledger or authentication files are modified.
const { app } = require('electron');
const fs = require('node:fs/promises'), fss = require('node:fs'), path = require('node:path'), os = require('node:os');
const vm = require('node:vm'), assert = require('node:assert/strict'), { spawn } = require('node:child_process');
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
    const load = (name, context) => {
      const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
      assert.ok(start >= 0); vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
    };
    const context = vm.createContext({ fs: fss, path, os, process, spawn, Buffer,
      require: name => name.startsWith('./') ? require(path.join(runtime, name)) : require(name),
      app: { isPackaged: true, getPath: name => { assert.equal(name, 'userData'); return path.join(process.env.APPDATA, 'edu-manager-launcher'); } },
      mainWindow: null, shell: { openExternal: () => { throw Error('Probe must not start login'); } },
      findPreferredCodexCliInstall: () => ({ exePath: codexPath }), findAgentToolInstall: () => ({ exePath: workbuddyPath }),
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
    const project = { id: 'synthetic-recovery-project-42', name: '合成实验项目', studentIds: students.map(s => s.id) };
    const folder = path.join(root, 'source'), destination = path.join(root, 'destination'); await fs.mkdir(folder); await fs.mkdir(destination);
    const original = path.join(folder, 'synthetic.txt'); await fs.writeFile(original, `这是合成教育实验记录，项目编号：${project.id}。测量六次，每次七个单位，总数42。`);
    await fs.utimes(original, new Date(Date.now() - 10000), new Date(Date.now() - 10000));
    taskHost = await require('../tests/helpers/smart-inbox-task-host.cjs').createTaskHost(path.join(root, 'tasks'), { runtime });
    const qualifiers = new Map();
    const { createSmartInboxHost } = require(path.join(runtime, 'smart-inbox-host.cjs'));
    service = createSmartInboxHost({ directory: path.join(root, 'inbox'), students: () => [], student: id => students.find(s => s.id === id),
      projects: () => [project], isWorkspace: () => false, legacySettings: () => ({}), forbiddenRoots: () => [destination],
      automaticAllowed: () => true, acquire: () => () => {}, beginBatch: taskHost.beginBatch, endBatch: taskHost.endBatch,
      agent: { route: () => require(path.join(runtime, 'agent-invocation-service.cjs')).classificationRoute(student),
        select: (_, id) => adapters[id], spawnProcess: context.spawnAdapterProcess,
        qualification: { load: (_, key) => qualifiers.get(key), save: async (_, key, value) => { qualifiers.set(key, value); } } },
      validateTarget: target => { assert.ok(students.some(s => s.id === target.studentId)); assert.equal(target.id, project.id); return target; },
      deliver: async (snapshot, target, item) => { const file = path.join(destination, target.studentId + '.txt'); await fs.copyFile(snapshot, file); return { ok: true, path: file, recordId: item.operationId }; },
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
    await fs.access(original);
    report.checks.push('real Agent classified exact synthetic project and host verified and registered one copy through actual task center');
    if (detail.execution?.attempts?.length) report.checks.push('primary failed before student transmission and fallback completed');
    else report.checks.push('primary completed; real fallback scenario was not exercised');
    const before = report.runs.length; await service.engine.requestScan(registered.id); await service.engine.tick();
    assert.equal(report.runs.length, before); report.checks.push('unchanged rescan makes no additional Agent call');
    const secondFolder = path.join(root, 'second'); await fs.mkdir(secondFolder);
    const secondFile = path.join(secondFolder, 'second.txt');
    await fs.writeFile(secondFile, `另一名虚构学生的合成实验，项目编号：${project.id}。独立记录八组观察，只用于测试共享登录，不包含真实资料。`);
    await fs.utimes(secondFile, new Date(Date.now() - 10000), new Date(Date.now() - 10000));
    const secondSource = await service.engine.updateSource({ folder: secondFolder, studentId: secondStudent.id, enabled: true, automatic: true });
    await service.engine.requestScan(secondSource.id); await service.engine.tick();
    const secondRow = (await service.engine.list({ studentId: secondStudent.id, status: 'delivered' })).rows[0];
    assert.ok(secondRow); assert.equal(secondRow.studentId, secondStudent.id);
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
