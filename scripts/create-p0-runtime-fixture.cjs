'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { localDate, weekRange } = require('../electron/learning-report-workflow.cjs');

const args = new Map(process.argv.slice(2).map(entry => {
  const separator = entry.indexOf('=');
  return separator < 0
    ? [entry.replace(/^--/, ''), 'true']
    : [entry.slice(0, separator).replace(/^--/, ''), entry.slice(separator + 1)];
}));

function required(name) {
  const value = String(args.get(name) || '').trim();
  if (!value) throw new Error(`--${name} is required`);
  return path.resolve(value);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function stableTaskId(kind, sourceType, sourceId) {
  const digest = crypto.createHash('sha1').update([kind, sourceType, sourceId].join('|')).digest('hex').slice(0, 12);
  return `task-${kind}-${digest}`;
}

const scenario = String(args.get('scenario') || '').trim();
if (!['idle', 'normal-task', 'backlog-recovery', 'agent-project-task', 'agent-backlog-workbuddy', 'agent-research-codex'].includes(scenario)) {
  throw new Error('scenario must be idle, normal-task, backlog-recovery, agent-project-task, agent-backlog-workbuddy or agent-research-codex');
}
const projectAgentScenario = ['agent-project-task', 'agent-backlog-workbuddy'].includes(scenario);
const researchScenario = scenario === 'agent-research-codex';
const agentScenario = projectAgentScenario || researchScenario;
const agentProvider = String(args.get('agent-provider') || (researchScenario ? 'codex' : 'workbuddy')).trim().toLowerCase();
if (agentScenario && !['workbuddy', 'codex'].includes(agentProvider)) {
  throw new Error('agent-provider must be workbuddy or codex');
}
const output = required('output');
const sourceUserData = required('source-user-data');
const sourceWorkBuddyAuth = String(args.get('source-workbuddy-auth') || '').trim();
const studentActive = String(args.get('student-active') || '').toLowerCase() === 'true';
const temporaryRoot = path.resolve(os.tmpdir());
const explicitAllowedRoot = String(args.get('allowed-root') || '').trim();
const allowedRoot = explicitAllowedRoot ? path.resolve(explicitAllowedRoot) : temporaryRoot;
const repositoryArtifactsRoot = path.resolve(__dirname, '..', 'artifacts');
const allowedRootRelative = path.relative(repositoryArtifactsRoot, allowedRoot);
if (explicitAllowedRoot && (!allowedRootRelative || allowedRootRelative === '..'
  || allowedRootRelative.startsWith(`..${path.sep}`) || path.isAbsolute(allowedRootRelative))) {
  throw new Error('explicit allowed root must be a directory under repository artifacts');
}
const outputRelative = path.relative(allowedRoot, output);
if (!outputRelative || outputRelative === '..' || outputRelative.startsWith(`..${path.sep}`) || path.isAbsolute(outputRelative)
  || !path.basename(output).startsWith('edu-p0-')) {
  throw new Error('output must be a new edu-p0-* directory under the approved fixture root');
}
if (fs.existsSync(output)) throw new Error('destination already exists');

const sourceSettingsPath = path.join(sourceUserData, 'settings.json');
const sourceIdentityPath = path.join(sourceUserData, 'host-identity.json');
if (!fs.existsSync(sourceSettingsPath) || !fs.existsSync(sourceIdentityPath)) throw new Error('source settings and host identity are required');
const sourceSettings = readJson(sourceSettingsPath);
const hostIdentity = readJson(sourceIdentityPath);
if (!sourceSettings.license || !hostIdentity.hostId) throw new Error('source license and bound host identity are required');

let workBuddyAuthorizationDescriptor = null;
if (sourceWorkBuddyAuth) {
  if (!agentScenario || (agentProvider !== 'workbuddy' && !researchScenario)) {
    throw new Error('source-workbuddy-auth is only valid for a WorkBuddy Agent or research fallback fixture');
  }
  const authFile = path.resolve(sourceWorkBuddyAuth);
  const expectedAuthFile = path.resolve(sourceUserData, 'classification-auth', 'workbuddy.json');
  if (authFile.toLowerCase() !== expectedAuthFile.toLowerCase()) {
    throw new Error('source-workbuddy-auth must be the source user-data WorkBuddy descriptor');
  }
  const descriptor = readJson(authFile);
  if (!descriptor.root || !descriptor.cliPath || !fs.statSync(descriptor.root).isDirectory()
    || !fs.statSync(descriptor.cliPath).isFile()) {
    throw new Error('source WorkBuddy authorization descriptor is incomplete');
  }
  // The host descriptor contains paths only. WorkBuddy credentials stay inside
  // the official CLI profile and are referenced in place, never copied into
  // the isolated fixture or emitted in its manifest.
  workBuddyAuthorizationDescriptor = {
    version: Number(descriptor.version || 0),
    root: path.resolve(descriptor.root),
    cliPath: path.resolve(descriptor.cliPath),
  };
}

const studentBaseDir = path.join(output, 'student-data');
const taskCenterDir = path.join(studentBaseDir, '.edu-manager', 'task-center');
const count = ['idle', 'agent-project-task', 'agent-research-codex'].includes(scenario) ? 0 : scenario === 'normal-task' ? 1 : 12;
const createdAt = new Date().toISOString();
const students = [];
const tasks = [];
const events = [];
fs.mkdirSync(output, { recursive: false });
for (let index = 0; index < count; index += 1) {
  const suffix = String(index + 1).padStart(2, '0');
  const studentId = `p0-synthetic-student-${suffix}`;
  const studentRoot = path.join(studentBaseDir, `synthetic-${suffix}`);
  const rawPath = path.join(studentRoot, '原始资料');
  const managerDir = path.join(studentRoot, 'AI教育管家');
  fs.mkdirSync(rawPath, { recursive: true });
  fs.mkdirSync(path.join(managerDir, 'planning-guidance'), { recursive: true });
  fs.writeFileSync(path.join(rawPath, 'fixture-note.md'), `# Synthetic fixture ${suffix}\n\nThis file contains no student data.\n`, 'utf8');
  students.push({
    id: studentId,
    name: `P0合成学生${suffix}`,
    loginId: `P0-${suffix}`,
    status: studentActive ? 'active' : 'inactive',
    activityStatus: studentActive ? 'active' : 'inactive',
    active: studentActive,
    archived: false,
    rootPath: studentRoot,
    rawPath,
    agentTool: 'workbuddy',
    digestTime: '00:00',
    automaticTasksPaused: !studentActive,
  });
  const kind = 'topic_suggestion_refresh';
  const taskId = stableTaskId(kind, 'student', studentId);
  const task = {
    id: taskId,
    title: `P0合成学生${suffix}选题建议更新`,
    kind,
    sourceType: 'student',
    sourceId: studentId,
    sourceName: `P0合成学生${suffix}`,
    status: 'pending',
    // A manual-origin task remains runnable but suppresses unrelated periodic
    // cards for the inactive synthetic student. This keeps the fixture's
    // workload deterministic without weakening production routing rules.
    trigger: 'manual',
    executor: 'internal',
    requestedExecutor: 'internal',
    executionMode: 'internal',
    automaticExecution: true,
    requestOrigin: 'recovery',
    attempt: 0,
    priorityClass: scenario === 'normal-task' ? 80 : 60,
    queuedAt: createdAt,
    updatedAt: createdAt,
    idempotencyKey: `p0:${scenario}:${studentId}:topic-v1`,
    workKey: `topic_suggestion_refresh:${studentId}:fixture-v1`,
    sourceVersion: 'fixture-v1',
    pipelineVersion: 'p0-runtime-fixture-v1',
    completionPolicy: 'auto_after_validation',
    input: { studentId, operation: kind },
    expectedOutput: { type: 'topic_suggestion_revision' },
    permissions: {
      read: [managerDir],
      write: [path.join(managerDir, 'planning-guidance')],
      operations: ['read_planning_evidence', 'write_planning_suggestions'],
    },
    riskLevel: 'low',
  };
  tasks.push(task);
  events.push({
    id: `p0-fixture-created-${scenario}-${suffix}`,
    taskId,
    type: 'task_created',
    at: createdAt,
    payload: { synthetic: true, scenario },
  });
}

const projects = [];
if (projectAgentScenario) {
  const studentId = 'p0-synthetic-agent-student-01';
  const studentRoot = path.join(studentBaseDir, 'synthetic-agent-01');
  const studentRawPath = path.join(studentRoot, '原始资料');
  fs.mkdirSync(studentRawPath, { recursive: true });
  students.push({
    id: studentId,
    name: 'P0合成Agent学生01',
    loginId: 'P0-AGENT-01',
    status: 'paused',
    activityStatus: 'paused',
    active: true,
    archived: false,
    rootPath: studentRoot,
    rawPath: studentRawPath,
    agentTool: agentProvider,
    digestTime: '00:00',
    // Keep the synthetic student eligible for project scope resolution while
    // suppressing unrelated periodic student tasks during the Agent queue test.
    automaticTasksPaused: true,
  });
  const projectId = 'p0-synthetic-project-01';
  const projectRootPath = path.join(output, 'project-data', projectId);
  const workspacePath = path.join(projectRootPath, '项目工作空间');
  const knowledgeRootPath = path.join(projectRootPath, '项目知识空间');
  const rawPath = path.join(knowledgeRootPath, 'P0合成项目项目原始资料库');
  const managerPath = path.join(projectRootPath, '.edu-manager');
  const outputPath = path.join(projectRootPath, '输出结果');
  const inboxPath = path.join(workspacePath, '收件箱');
  fs.mkdirSync(rawPath, { recursive: true });
  fs.mkdirSync(inboxPath, { recursive: true });
  fs.mkdirSync(knowledgeRootPath, { recursive: true });
  fs.mkdirSync(managerPath, { recursive: true });
  fs.mkdirSync(outputPath, { recursive: true });
  fs.writeFileSync(path.join(projectRootPath, 'AGENT.md'), [
    '# P0 synthetic project rules',
    '',
    '- Read only the isolated synthetic project material provided by this fixture.',
    '- Write knowledge artifacts only below the declared project knowledge root.',
    '- Return a structured per-file receipt; never access formal student or project data.',
    '',
  ].join('\n'), 'utf8');
  const materialPath = path.join(inboxPath, 'agent-fixture-note.md');
  fs.writeFileSync(materialPath, [
    '# P0 real Agent fixture',
    '',
    'This is isolated synthetic material. Summarize it into the project knowledge space and return a per-file receipt.',
    '',
  ].join('\n'), 'utf8');
  const materialBytes = fs.readFileSync(materialPath);
  const materialStat = fs.statSync(materialPath);
  const materialSha256 = crypto.createHash('sha256').update(materialBytes).digest('hex');
  const materialSha1 = crypto.createHash('sha1').update(materialBytes).digest('hex');
  const materialId = 'material-p0-agent-fixture-01';
  writeJson(path.join(managerPath, 'project-materials', 'registry.json'), {
    schema: 'edu-manager.project-materials.v1',
    projectId,
    revision: 2,
    updatedAt: createdAt,
    categories: [],
    materials: [{
      projectId,
      materialId,
      version: 1,
      createdAt,
      sources: [],
      versions: [{ version: 1, sha256: materialSha256, sha1: materialSha1, size: materialBytes.length,
        registeredAt: createdAt, snapshot: null }],
      legacyAliases: [],
      links: {},
      adoption: { state: 'accepted', decidedAt: createdAt },
      classification: { categoryId: '', tags: [], source: 'fixture', manualLocked: false },
      organizationState: 'unclassified',
      processing: { state: 'pending' },
      recordRevision: 1,
      sha256: materialSha256,
      sha1: materialSha1,
      size: materialBytes.length,
      mtimeMs: materialStat.mtimeMs,
      fileKey: `${materialStat.dev}:${materialStat.ino}`,
      location: { kind: 'workspace', rootId: 'workspace', relativePath: '收件箱/agent-fixture-note.md' },
      availability: 'available',
      contentVerifiedAt: createdAt,
      updatedAt: createdAt,
    }],
    receipts: [],
    commits: [],
    adoptionReceipts: [],
  });
  projects.push({
    id: projectId,
    name: 'P0合成项目',
    storageName: 'P0合成项目',
    type: '学习项目',
    status: 'active',
    agentTool: agentProvider,
    projectRootPath,
    managerPath,
    workspacePath,
    workspaceMode: 'managed',
    knowledgeRootPath,
    rawPath,
    outputPath,
    studentIds: [studentId],
    studentNames: ['P0合成Agent学生01'],
    assetIds: [],
    materialStorageMode: 'workspace-v1',
    materialRegistryVersion: 1,
    materialMigrationState: 'complete',
    inboxRelativePath: '收件箱',
    materialAutomation: {
      enabled: true,
      processingPaused: false,
      autoAdoptPathClassified: true,
      autoDigest: true,
      maxBatch: 20,
      onWorkspaceChange: true,
      intervalMinutes: 15,
      nextRunAt: createdAt,
    },
    digestState: { status: 'pending', pendingCount: 1, pendingFiles: [{ materialId, relativePath: '收件箱/agent-fixture-note.md',
      sha256: materialSha256, sha1: materialSha1, size: materialBytes.length, version: 1 }] },
    createdAt,
    updatedAt: createdAt,
  });
  const kind = 'project_digest';
  const taskId = stableTaskId(kind, 'project', projectId);
  tasks.push({
    id: taskId,
    title: 'P0合成项目资料消化',
    kind,
    sourceType: 'project',
    sourceId: projectId,
    sourceName: 'P0合成项目',
    status: 'pending',
    trigger: 'event',
    executor: agentProvider,
    requestedExecutor: agentProvider,
    executionMode: 'adapter',
    automaticExecution: true,
    requestOrigin: 'recovery',
    attempt: 0,
    priorityClass: 80,
    queuedAt: createdAt,
    updatedAt: createdAt,
    idempotencyKey: `p0:agent-project-task:${agentProvider}:project-v1`,
    workKey: `project_digest:${projectId}:fixture-v1`,
    sourceVersion: 'fixture-v1',
    pipelineVersion: 'p0-real-agent-fixture-v1',
    completionPolicy: 'auto_after_validation',
    input: { projectId, knowledgeRoot: knowledgeRootPath, controlledMaterial: true, projectScopeContract: 'edu-manager.agent-capabilities.v2' },
    expectedOutput: { type: 'project_digest_host_receipt', hostManaged: true },
    permissions: {
      read: [rawPath, knowledgeRootPath, managerPath],
      write: [knowledgeRootPath, managerPath],
      operations: ['read', 'write_project_knowledge'],
    },
    riskLevel: 'medium',
  });
  events.push({
    id: `p0-fixture-created-${scenario}-01`,
    taskId,
    type: 'task_created',
    at: createdAt,
    payload: { synthetic: true, scenario, agentProvider },
  });
  writeJson(path.join(output, 'agent-control', 'policies.json'), {
    schema: 'edu-manager.agent-control.v4',
    revision: 1,
    policies: {},
    history: [],
    global: {
      enabled: true,
      version: 1,
      order: [agentProvider],
      disabledProviders: [],
      providerModes: { [agentProvider]: 'automatic_preferred' },
      providerProfiles: {},
      desktopHandoff: true,
      authorizedAt: createdAt,
      captureEpoch: crypto.randomUUID(),
      capturedConversationRouting: { enabled: true, authorizedAt: createdAt },
    },
  });
}

if (researchScenario) {
  const studentId = 'p0-synthetic-research-student-01';
  const studentRoot = path.join(studentBaseDir, 'synthetic-research-01');
  const rawPath = path.join(studentRoot, '原始资料');
  const managerDir = path.join(studentRoot, 'AI教育管家');
  const summaryPath = path.join(studentRoot, '学情分析汇总');
  const reportDir = path.join(summaryPath, '学情报告');
  fs.mkdirSync(rawPath, { recursive: true });
  fs.mkdirSync(path.join(managerDir, 'planning-guidance'), { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(rawPath, 'synthetic-interest.md'), [
    '# Synthetic acceptance profile', '',
    'The fictional student is interested in public science competitions. No real student data is present.', '',
  ].join('\n'), 'utf8');
  students.push({
    id: studentId, name: 'P0合成研究学生01', loginId: 'P0-RESEARCH-01',
    status: 'active', activityStatus: 'active', active: true, archived: false,
    rootPath: studentRoot, rawPath, summaryPath, agentTool: 'codex', digestTime: '00:00',
    automaticTasksPaused: false,
  });
  const today = localDate(new Date());
  for (const name of ['整体画像.md', '历史变化.md', '每日行动建议.md', '阶段总结.md']) {
    fs.writeFileSync(path.join(reportDir, name), `---\nstatus: published\nstudent_id: ${studentId}\nupdated: ${today}\n---\n\n# ${path.basename(name, '.md')}\n\n本合成夹具的当前报告。\n`, 'utf8');
  }
  const maintenanceWeek = weekRange(new Date());
  const maintenanceReport = path.join(managerDir, 'maintenance-report.md');
  fs.writeFileSync(maintenanceReport, '# P0 synthetic maintenance report\n\nCurrent and complete.\n', 'utf8');
  const maintenanceTaskId = stableTaskId('maintenance_lint', 'student', studentId);
  tasks.push({
    id: maintenanceTaskId, title: 'P0合成研究学生01知识库维护检查', kind: 'maintenance_lint',
    sourceType: 'student', sourceId: studentId, sourceName: 'P0合成研究学生01',
    status: 'succeeded', trigger: 'schedule', executor: 'codex', requestedExecutor: 'codex',
    executionMode: 'adapter', automaticExecution: true, attempt: 1, scheduleKey: maintenanceWeek.key,
    idempotencyKey: `maintenance_lint:${studentId}:${maintenanceWeek.key}`,
    workKey: `maintenance_lint:${studentId}:${maintenanceWeek.key}`, sourceVersion: maintenanceWeek.key,
    pipelineVersion: 'p0-research-runtime-fixture-v1', completionPolicy: 'auto_after_validation',
    input: { studentId, knowledgeRoot: studentRoot }, expectedOutput: { type: 'markdown', path: maintenanceReport },
    permissions: { read: [studentRoot], write: [maintenanceReport], operations: ['read', 'create_report'] },
    result: { valid: true, artifacts: [{ path: maintenanceReport }] }, settlementState: 'settled',
    businessOutcome: 'completed', completedAt: createdAt, updatedAt: createdAt, riskLevel: 'low',
  });
  const kind = 'competition_research_check';
  const taskId = stableTaskId(kind, 'student', studentId);
  tasks.push({
    id: taskId, title: 'P0合成学生比赛推荐来源检查', kind,
    sourceType: 'student', sourceId: studentId, sourceName: 'P0合成研究学生01',
    status: 'pending', trigger: 'manual', executor: 'internal', requestedExecutor: 'internal',
    executionMode: 'internal', automaticExecution: true, requestOrigin: 'recovery',
    attempt: 0, priorityClass: 80, queuedAt: createdAt, updatedAt: createdAt,
    idempotencyKey: `p0:research:codex:${studentId}:fixture-v1`,
    workKey: `competition_research_check:${studentId}:fixture-v1`, sourceVersion: 'fixture-v1',
    pipelineVersion: 'p0-research-runtime-fixture-v1', completionPolicy: 'auto_after_validation',
    input: { studentId, operation: kind, syntheticOnly: true },
    expectedOutput: { type: 'competition_recommendation_revision' },
    permissions: { read: [managerDir], write: [path.join(managerDir, 'planning-guidance')],
      operations: ['read_planning_evidence', 'write_planning_suggestions'] },
    riskLevel: 'low',
  });
  events.push({ id: `p0-fixture-created-${scenario}-01`, taskId, type: 'task_created', at: createdAt,
    payload: { synthetic: true, scenario, agentProvider: 'codex' } });
  writeJson(path.join(output, 'agent-control', 'policies.json'), {
    schema: 'edu-manager.agent-control.v4', revision: 1, policies: {}, history: [],
    global: { enabled: true, version: 1, order: workBuddyAuthorizationDescriptor ? ['codex', 'workbuddy'] : ['codex'], disabledProviders: [],
      providerModes: { codex: 'automatic_preferred', ...(workBuddyAuthorizationDescriptor ? { workbuddy: 'automatic_preferred' } : {}) }, providerProfiles: {}, desktopHandoff: true,
      authorizedAt: createdAt, captureEpoch: crypto.randomUUID(),
      capturedConversationRouting: { enabled: true, authorizedAt: createdAt } },
  });
}

writeJson(path.join(output, 'settings.json'), {
  license: sourceSettings.license,
  studentBaseDir,
  taskAutomationEnabled: true,
});
writeJson(path.join(output, 'host-identity.json'), hostIdentity);
if (workBuddyAuthorizationDescriptor) {
  writeJson(path.join(output, 'classification-auth', 'workbuddy.json'), workBuddyAuthorizationDescriptor);
}
writeJson(path.join(output, 'students.json'), students);
writeJson(path.join(output, 'projects.json'), { version: 1, updatedAt: createdAt, projects });
writeJson(path.join(taskCenterDir, 'tasks.json'), {
  protocolVersion: 'p0-runtime-fixture-v1',
  updatedAt: createdAt,
  runtime: {},
  deletedTasks: [],
  history: [],
  tasks,
});
fs.writeFileSync(path.join(taskCenterDir, 'events.jsonl'), `${events.map(event => JSON.stringify(event)).join('\n')}\n`, 'utf8');

const manifest = {
  schema: 1,
  synthetic: true,
  scenario,
  createdAt,
  userDataDir: output,
  studentBaseDir,
  taskDatabasePath: path.join(taskCenterDir, 'task-state.sqlite3'),
  studentCount: students.length,
  taskCount: tasks.length,
  externalAgentCallsExpected: agentScenario ? 1 : 0,
  executor: agentScenario ? agentProvider : 'internal',
  taskKind: researchScenario ? 'competition_research_check' : agentScenario ? 'project_digest' : 'topic_suggestion_refresh',
  workBuddyAuthorizationDescriptor: Boolean(workBuddyAuthorizationDescriptor),
  expected: {
    completedTasks: tasks.length,
    terminalStatus: 'succeeded',
    manualTasks: 0,
    duplicateExecutions: 0,
  },
  allowedWrites: [output],
  prohibitedReads: ['formal student roots', 'formal project state', 'formal task state'],
  credentialScope: workBuddyAuthorizationDescriptor
    ? 'The signed license and host identity are copied. A path-only WorkBuddy official CLI descriptor is copied; official CLI credentials remain in place and are never copied or emitted.'
    : 'Only the local signed license and its bound host identity are copied; neither value is included in this manifest.',
  files: {
    settings: { path: 'settings.json', sha256: sha256(path.join(output, 'settings.json')) },
    hostIdentity: { path: 'host-identity.json', sha256: sha256(path.join(output, 'host-identity.json')) },
    students: { path: 'students.json', sha256: sha256(path.join(output, 'students.json')) },
    tasks: { path: path.relative(output, path.join(taskCenterDir, 'tasks.json')), sha256: sha256(path.join(taskCenterDir, 'tasks.json')) },
    events: { path: path.relative(output, path.join(taskCenterDir, 'events.jsonl')), sha256: sha256(path.join(taskCenterDir, 'events.jsonl')) },
  },
  reset: 'Create a new fixture directory for every run; never overwrite or reuse a prior run.',
};
writeJson(path.join(output, 'p0-fixture-manifest.json'), manifest);
process.stdout.write(`${JSON.stringify(manifest)}\n`);
