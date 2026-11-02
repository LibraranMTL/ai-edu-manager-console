'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'create-p0-runtime-fixture.cjs');

function sourceFixture(t) {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-p0-source-'));
  fs.writeFileSync(path.join(source, 'settings.json'), JSON.stringify({
    theme: 'must-not-copy',
    apiToken: 'must-not-copy',
    license: { code: 'synthetic-signed-license-placeholder', licenseId: 'fixture-license' },
  }));
  fs.writeFileSync(path.join(source, 'host-identity.json'), JSON.stringify({ hostId: 'fixture-host', hostCode: 'SECRET-HOST-CODE' }));
  const authRoot = path.join(source, 'classification-auth', 'workbuddy-profile');
  const cliPath = path.join(source, 'classification-auth', 'official-workbuddy-cli', 'codebuddy.js');
  fs.mkdirSync(authRoot, { recursive: true });
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  fs.writeFileSync(cliPath, 'synthetic cli descriptor target');
  fs.writeFileSync(path.join(source, 'classification-auth', 'workbuddy.json'), JSON.stringify({
    version: 7, root: authRoot, cliPath, loginRequestId: 'must-not-copy', secret: 'must-not-copy',
  }));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  return source;
}

function create(t, scenario, options = {}) {
  const source = sourceFixture(t);
  const output = path.join(os.tmpdir(), `edu-p0-${scenario}-${process.pid}-${Date.now()}`);
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [script, `--scenario=${scenario}`, `--output=${output}`, `--source-user-data=${source}`,
    ...Object.entries(options).map(([key, value]) => `--${key}=${value === '$sourceWorkBuddyAuth'
      ? path.join(source, 'classification-auth', 'workbuddy.json') : value}`)], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { output, report: JSON.parse(result.stdout) };
}

test('real Agent P0 runtime fixture creates one isolated automatic project digest task', t => {
  const { output, report } = create(t, 'agent-project-task', { 'agent-provider': 'workbuddy' });
  assert.equal(report.synthetic, true);
  assert.equal(report.externalAgentCallsExpected, 1);
  assert.equal(report.executor, 'workbuddy');
  assert.equal(report.taskKind, 'project_digest');
  assert.equal(report.studentCount, 1);

  const students = JSON.parse(fs.readFileSync(path.join(output, 'students.json'), 'utf8'));
  assert.equal(students[0].activityStatus, 'paused');
  assert.equal(students[0].automaticTasksPaused, true);

  const projects = JSON.parse(fs.readFileSync(path.join(output, 'projects.json'), 'utf8'));
  assert.equal(projects.projects.length, 1);
  assert.equal(projects.projects[0].id, 'p0-synthetic-project-01');
  assert.equal(projects.projects[0].materialStorageMode, 'workspace-v1');
  assert.equal(projects.projects[0].digestState.pendingCount, 1);
  assert.equal(projects.projects[0].materialAutomation.nextRunAt, report.createdAt);
  assert.deepEqual(projects.projects[0].studentIds, ['p0-synthetic-agent-student-01']);
  assert.ok(path.resolve(projects.projects[0].projectRootPath).startsWith(path.resolve(output)));
  assert.equal(fs.existsSync(path.join(projects.projects[0].projectRootPath, 'AGENT.md')), true);
  const registry = JSON.parse(fs.readFileSync(path.join(projects.projects[0].managerPath, 'project-materials', 'registry.json'), 'utf8'));
  assert.equal(registry.materials.length, 1);
  assert.equal(registry.materials[0].adoption.state, 'accepted');
  assert.equal(registry.materials[0].processing.state, 'pending');

  const taskFile = path.join(output, 'student-data', '.edu-manager', 'task-center', 'tasks.json');
  const store = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  assert.equal(store.tasks.length, 1);
  assert.equal(store.tasks[0].kind, 'project_digest');
  assert.equal(store.tasks[0].requestedExecutor, 'workbuddy');
  assert.equal(store.tasks[0].executionMode, 'adapter');
  assert.equal(store.tasks[0].automaticExecution, true);
  assert.equal(store.tasks[0].status, 'pending');
  assert.equal(store.tasks[0].expectedOutput.hostManaged, true);
  assert.equal(store.tasks[0].input.projectScopeContract, 'edu-manager.agent-capabilities.v2');
});

test('research fixture creates one isolated automatic competition task routed through production scheduler', t => {
  const { output, report } = create(t, 'agent-research-codex', { 'source-workbuddy-auth': '$sourceWorkBuddyAuth' });
  assert.equal(report.externalAgentCallsExpected, 1);
  assert.equal(report.executor, 'codex');
  assert.equal(report.taskKind, 'competition_research_check');
  assert.equal(report.studentCount, 1);
  const students = JSON.parse(fs.readFileSync(path.join(output, 'students.json'), 'utf8'));
  assert.equal(students[0].activityStatus, 'active');
  assert.equal(students[0].automaticTasksPaused, false);
  const taskFile = path.join(output, 'student-data', '.edu-manager', 'task-center', 'tasks.json');
  const fixtureStore = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  const task = fixtureStore.tasks.find(item => item.kind === 'competition_research_check');
  assert.equal(task.kind, 'competition_research_check');
  assert.equal(task.executionMode, 'internal');
  assert.equal(task.automaticExecution, true);
  const maintenance = fixtureStore.tasks.find(item => item.kind === 'maintenance_lint');
  assert.equal(maintenance.status, 'succeeded');
  assert.equal(maintenance.businessOutcome, 'completed');
  const reportDir = path.join(students[0].summaryPath, '学情报告');
  for (const name of ['整体画像.md', '历史变化.md', '每日行动建议.md', '阶段总结.md']) {
    assert.match(fs.readFileSync(path.join(reportDir, name), 'utf8'), /status:\s*published/);
  }
  const policies = JSON.parse(fs.readFileSync(path.join(output, 'agent-control', 'policies.json'), 'utf8'));
  assert.deepEqual(policies.global.order, ['codex', 'workbuddy']);
  const descriptor = JSON.parse(fs.readFileSync(path.join(output, 'classification-auth', 'workbuddy.json'), 'utf8'));
  assert.deepEqual(Object.keys(descriptor).sort(), ['cliPath', 'root', 'version']);
});

test('real WorkBuddy fixture can opt into the existing official CLI descriptor without copying credentials', t => {
  const { output, report } = create(t, 'agent-project-task', {
    'agent-provider': 'workbuddy', 'source-workbuddy-auth': '$sourceWorkBuddyAuth',
  });
  const descriptor = JSON.parse(fs.readFileSync(path.join(output, 'classification-auth', 'workbuddy.json'), 'utf8'));
  assert.deepEqual(Object.keys(descriptor).sort(), ['cliPath', 'root', 'version']);
  assert.equal(descriptor.version, 7);
  assert.equal(path.isAbsolute(descriptor.root), true);
  assert.equal(path.isAbsolute(descriptor.cliPath), true);
  assert.equal(descriptor.loginRequestId, undefined);
  assert.equal(descriptor.secret, undefined);
  assert.equal(report.workBuddyAuthorizationDescriptor, true);
  assert.doesNotMatch(JSON.stringify(report), /must-not-copy/);
});

test('normal P0 runtime fixture copies only host license identity and creates one internal closed-loop task', t => {
  const { output, report } = create(t, 'normal-task');
  assert.equal(report.synthetic, true);
  assert.equal(report.taskCount, 1);
  assert.equal(report.externalAgentCallsExpected, 0);
  assert.equal(JSON.stringify(report).includes('synthetic-signed-license-placeholder'), false);
  assert.equal(JSON.stringify(report).includes('SECRET-HOST-CODE'), false);

  const settings = JSON.parse(fs.readFileSync(path.join(output, 'settings.json'), 'utf8'));
  assert.deepEqual(Object.keys(settings).sort(), ['license', 'studentBaseDir', 'taskAutomationEnabled']);
  assert.equal(settings.license.licenseId, 'fixture-license');
  assert.equal(settings.apiToken, undefined);
  const students = JSON.parse(fs.readFileSync(path.join(output, 'students.json'), 'utf8'));
  assert.equal(students.length, 1);
  assert.equal(students[0].activityStatus, 'inactive');
  assert.ok(path.resolve(students[0].rootPath).startsWith(path.resolve(output)));

  const taskFile = path.join(output, 'student-data', '.edu-manager', 'task-center', 'tasks.json');
  const store = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  assert.equal(store.tasks.length, 1);
  assert.equal(store.tasks[0].kind, 'topic_suggestion_refresh');
  assert.equal(store.tasks[0].requestedExecutor, 'internal');
  assert.equal(store.tasks[0].automaticExecution, true);
  assert.equal(store.tasks[0].trigger, 'manual');
  const events = fs.readFileSync(path.join(path.dirname(taskFile), 'events.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(events.map(event => event.type), ['task_created']);
});

test('idle P0 runtime fixture contains no students, tasks, or external Agent work', t => {
  const { output, report } = create(t, 'idle');
  assert.equal(report.scenario, 'idle');
  assert.equal(report.studentCount, 0);
  assert.equal(report.taskCount, 0);
  assert.equal(report.externalAgentCallsExpected, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'students.json'), 'utf8')), []);
  const taskFile = path.join(output, 'student-data', '.edu-manager', 'task-center', 'tasks.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(taskFile, 'utf8')).tasks, []);
});

test('backlog P0 runtime fixture is bounded, deterministic and cannot overwrite an existing destination', t => {
  const { output, report } = create(t, 'backlog-recovery');
  assert.equal(report.taskCount, 12);
  assert.equal(report.studentCount, 12);
  const store = JSON.parse(fs.readFileSync(path.join(output, 'student-data', '.edu-manager', 'task-center', 'tasks.json'), 'utf8'));
  assert.equal(store.tasks.length, 12);
  assert.equal(new Set(store.tasks.map(task => task.id)).size, 12);
  assert.ok(store.tasks.every(task => task.sourceId.startsWith('p0-synthetic-student-')));
  const rerun = spawnSync(process.execPath, [script, '--scenario=backlog-recovery', `--output=${output}`, `--source-user-data=${sourceFixture(t)}`], { cwd: root, encoding: 'utf8' });
  assert.notEqual(rerun.status, 0);
  assert.match(rerun.stderr, /destination.*exist/i);
});

test('real Agent backlog fixture combines twelve internal tasks with one isolated WorkBuddy digest', t => {
  const { output, report } = create(t, 'agent-backlog-workbuddy', {
    'agent-provider': 'workbuddy', 'source-workbuddy-auth': '$sourceWorkBuddyAuth',
  });
  assert.equal(report.taskCount, 13);
  assert.equal(report.studentCount, 13);
  assert.equal(report.externalAgentCallsExpected, 1);
  assert.equal(report.executor, 'workbuddy');
  const store = JSON.parse(fs.readFileSync(path.join(output, 'student-data', '.edu-manager', 'task-center', 'tasks.json'), 'utf8'));
  assert.equal(store.tasks.filter(task => task.requestedExecutor === 'internal').length, 12);
  assert.equal(store.tasks.filter(task => task.requestedExecutor === 'workbuddy').length, 1);
  assert.equal(JSON.stringify(report).includes('must-not-copy'), false);
});
