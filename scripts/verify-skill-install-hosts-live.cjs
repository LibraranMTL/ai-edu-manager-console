'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createSkillLibraryService } = require('../electron/skill-library-service.cjs');
const { discoverWorkBuddyRuntime, buildControlledWorkBuddyInvocation, workBuddyResultEnvelope } = require('../electron/workbuddy-runtime.cjs');

const EXPECTED = 'EDU_MANAGER_SKILL_ACCEPTANCE_OK';
const SKILL_NAME = 'edu-manager-install-acceptance';
const outputPath = path.resolve(process.argv[2] || path.join(os.tmpdir(), `edu-skill-host-acceptance-${Date.now()}.json`));
const workBuddyExe = path.resolve(process.argv[3] || 'D:/Program Files/WorkBuddy/WorkBuddy.exe');
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-host-acceptance-'));
const userDataDir = path.join(runRoot, 'user-data');
const workspace = path.join(runRoot, 'workspace');
const source = path.join(runRoot, 'source');
fs.mkdirSync(workspace, { recursive: true });

const report = {
  schema: 'edu-manager.skill-host-acceptance.v1',
  startedAt: new Date().toISOString(),
  syntheticOnly: true,
  skillName: SKILL_NAME,
  hosts: {},
  cleanup: { completed: false, retainedRecoveryPathsRemoved: [] },
};

function writeSkill(version, response) {
  fs.rmSync(source, { recursive: true, force: true });
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'SKILL.md'), `---\nname: ${SKILL_NAME}\ndescription: Synthetic host acceptance Skill for the AI Education Manager local installation pipeline.\nversion: ${version}\npublisher: qxmatrix-fixture\n---\n\n# AI Education Manager Skill installation acceptance\n\nUse this Skill only when the user explicitly invokes \`${SKILL_NAME}\`.\n\nDo not read files, browse, or call tools. Reply with exactly:\n\n\`${response}\`\n`, 'utf8');
}

function commandResult(result) {
  return {
    status: result.status,
    signal: result.signal || '',
    error: result.error?.message || '',
    stdout: String(result.stdout || '').trim().slice(-4000),
    stderr: String(result.stderr || '').trim().slice(-4000),
  };
}

function findCodexExe() {
  const found = spawnSync('where.exe', ['codex'], { encoding: 'utf8', windowsHide: true });
  return String(found.stdout || '').split(/\r?\n/).map(item => item.trim()).find(item => /\.exe$/i.test(item)) || '';
}

function invokeCodex() {
  const executable = findCodexExe();
  if (!executable) return { passed: false, message: 'Codex executable not found' };
  const lastMessage = path.join(runRoot, 'codex-last-message.txt');
  const prompt = `Use the ${SKILL_NAME} skill. This is a synthetic host acceptance request. Follow that skill exactly.`;
  const result = spawnSync(executable, ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--ignore-rules', '-C', workspace, '-o', lastMessage, prompt], {
    encoding: 'utf8', timeout: 180000, windowsHide: true,
  });
  const response = fs.existsSync(lastMessage) ? fs.readFileSync(lastMessage, 'utf8').trim() : '';
  return { passed: result.status === 0 && response === EXPECTED, response, command: commandResult(result) };
}

function invokeWorkBuddy() {
  const runtime = discoverWorkBuddyRuntime(workBuddyExe, {
    findExecutable: names => names.some(name => /^node(?:\.exe)?$/i.test(name)) ? process.execPath : '',
    hostNodePath: process.execPath,
  });
  if (!runtime.available) return { passed: false, message: 'WorkBuddy CLI runtime not available', runtime: { available: false } };
  const invocation = buildControlledWorkBuddyInvocation(runtime, {
    cwd: workspace,
    command: `Use the ${SKILL_NAME} skill. This is a synthetic host acceptance request. Follow that skill exactly.`,
    maxTurns: 1,
  });
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: invocation.cwd, env: invocation.env, input: invocation.stdinText, encoding: 'utf8', timeout: 180000, windowsHide: true,
  });
  let response = '', parseError = '';
  try { response = workBuddyResultEnvelope(JSON.parse(String(result.stdout || '').trim())).result.trim(); }
  catch (error) { parseError = error.message; }
  return {
    passed: result.status === 0 && response === EXPECTED,
    response,
    parseError,
    runtime: { available: runtime.available, mode: runtime.mode, version: fs.existsSync(path.join(runtime.installDir, 'version')) ? fs.readFileSync(path.join(runtime.installDir, 'version'), 'utf8').trim() : '' },
    command: commandResult(result),
  };
}

async function install(service, artifactId, versionId, providerId) {
  const plan = await service.action('previewInstall', { artifactId, versionId, providerId, scope: 'user' });
  const installed = await service.action('install', { planId: plan.planId, planHash: plan.planHash });
  const inventory = await service.action('verifyInstallation', { installationId: installed.record.installationId });
  return { plan, installed, inventory };
}

async function main() {
  const service = createSkillLibraryService({ userDataDir, homeDir: os.homedir() });
  const active = [];
  try {
    writeSkill('1.0.0', EXPECTED);
    const v1 = await service.store.archiveDirectory(source, { sourceType: 'synthetic_host_acceptance', sourceUri: 'fixture:v1' });
    for (const providerId of ['codex', 'workbuddy']) {
      const host = report.hosts[providerId] = { providerId, stages: {} };
      const first = await install(service, v1.artifact.artifactId, v1.version.versionId, providerId);
      active.push(first.inventory.installationId);
      host.stages.firstInstall = { state: first.inventory.state, targetPath: first.plan.targetPath, treeSha256: first.inventory.installedFingerprint };
      host.stages.firstTrigger = providerId === 'codex' ? invokeCodex() : invokeWorkBuddy();
    }

    writeSkill('2.0.0', 'EDU_MANAGER_SKILL_ACCEPTANCE_V2_OK');
    const v2 = await service.store.archiveDirectory(source, { sourceType: 'synthetic_host_acceptance', sourceUri: 'fixture:v2' });
    for (const providerId of ['codex', 'workbuddy']) {
      const host = report.hosts[providerId];
      const updated = await install(service, v2.artifact.artifactId, v2.version.versionId, providerId);
      active.push(updated.inventory.installationId);
      host.stages.update = { state: updated.inventory.state, backupCreated: Boolean(updated.installed.record.backupPath), treeSha256: updated.inventory.installedFingerprint };
      const rollbackPlan = await service.action('previewRollback', { installationId: updated.inventory.installationId });
      const rolledBack = await service.action('rollback', { planId: rollbackPlan.planId, planHash: rollbackPlan.planHash });
      host.stages.rollback = { state: rolledBack.record.state, restoredV1: rolledBack.record.installedFingerprint === host.stages.firstInstall.treeSha256 };
      const removed = await service.action('uninstall', { installationId: updated.inventory.installationId });
      host.stages.uninstall = { state: removed.state, targetRemoved: !fs.existsSync(host.stages.firstInstall.targetPath) };
      if (removed.retainedRecoveryPath && fs.existsSync(removed.retainedRecoveryPath)) {
        fs.rmSync(removed.retainedRecoveryPath, { recursive: true, force: true });
        report.cleanup.retainedRecoveryPathsRemoved.push(removed.retainedRecoveryPath);
      }
      host.passed = host.stages.firstTrigger.passed && host.stages.update.backupCreated && host.stages.rollback.restoredV1 && host.stages.uninstall.targetRemoved;
    }
    report.passed = Object.values(report.hosts).every(host => host.passed);
  } finally {
    for (const providerId of ['codex', 'workbuddy']) {
      const target = path.join(providerId === 'codex' ? (process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) : path.join(os.homedir(), '.codebuddy'), 'skills', SKILL_NAME);
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      const root = path.dirname(target);
      if (fs.existsSync(root)) {
        for (const name of fs.readdirSync(root).filter(name => name.includes(SKILL_NAME) || name.startsWith('.edu-skill-'))) {
          const candidate = path.join(root, name);
          if (name.includes(SKILL_NAME) && fs.existsSync(candidate)) fs.rmSync(candidate, { recursive: true, force: true });
        }
      }
    }
    report.cleanup.completed = true;
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ outputPath, passed: report.passed, hosts: Object.fromEntries(Object.entries(report.hosts).map(([key, value]) => [key, { passed: value.passed, trigger: value.stages.firstTrigger?.response || value.stages.firstTrigger?.message || '', rollback: value.stages.rollback, uninstall: value.stages.uninstall }])) }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch(error => {
  report.error = error.stack || error.message;
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.error(error);
  process.exitCode = 1;
});
