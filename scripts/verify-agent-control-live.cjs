'use strict';
// Opt-in packaged control-plane acceptance; generated teaching text only.
const { app } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const resources = path.resolve(process.argv[2]), reportPath = path.resolve(process.argv[3]);
const executable = process.argv[4], desktop = process.argv[5];
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const report = { schema: 'edu.agent-control-live.v1', fixture: 'synthetic-only', passed: false, attempts: [], startedAt: new Date().toISOString() };
  try {
    const runtime = path.join(resources, 'app.asar', 'electron');
    const load = file => require(path.join(runtime, file));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-control-live-'));
    const raw = path.join(root, 'raw'), knowledge = path.join(root, 'knowledge'); await fs.mkdir(raw); await fs.mkdir(knowledge);
    const original = path.join(raw, 'synthetic.txt');
    const text = 'Synthetic teaching experiment. The observations are 20, 25 and 30 degrees Celsius. These are invented observations for software acceptance, with no student author.';
    await fs.writeFile(original, text);
    const { createProjectMaterialStore } = load('project-materials.cjs');
    const store = createProjectMaterialStore({ projectId: 'synthetic-center-project', managerPath: path.join(root, 'manager'), roots: { workspace: { kind: 'workspace', path: raw } } });
    const material = (await store.registerFiles([{ location: { rootId: 'workspace', kind: 'workspace', relativePath: 'synthetic.txt' } }])).result[0];
    const workspace = load('project-material-digest.cjs').createProjectDigestWorkspace({ store, knowledgeRoot: knowledge, allowedDirectories: ['summaries'] });
    const batch = await workspace.prepare({ materialIds: [material.materialId], ruleVersion: 'synthetic-v1', targets: ['summaries/experiment.md'] });
    const workbuddy = load('workbuddy-runtime.cjs');
    const authManager = load('classification-auth.cjs').createClassificationAuth({ directory: path.join(process.env.APPDATA, 'edu-manager-launcher', 'classification-auth') });
    const auth = await authManager.read('workbuddy');
    const wbRuntime = authManager.apply(workbuddy.discoverWorkBuddyRuntime(desktop, { findExecutable: () => '', hostNodePath: process.execPath }), auth);
    wbRuntime.authVersion = auth.version || 0;
    const controlled = load('workbuddy-controlled.cjs');
    const qualification = controlled.createWorkBuddyQualification();
    let receipt;
    const result = await load('agent-control-plane.cjs').dispatchAgent({
      policy: { primary: 'workbuddy', fallbacks: process.argv.includes('--workbuddy-only') ? [] : ['codex'], enabled: true, desktopHandoff: false }, profile: 'digest_host_mediated.v1',
      current: () => true, record: async e => { report.attempts.push(e); await fs.writeFile(path.join(root, 'routing.json'), JSON.stringify(report.attempts)); },
      handoff: async () => { throw Error('Live test must never open a desktop handoff'); },
      attempt: async id => {
        if (id === 'workbuddy') {
          const probe = await workbuddy.probeWorkBuddyAuthorization(wbRuntime, { timeoutMs: 30000,
            spawnProcess: (exe, args, options) => spawn(exe, args, { ...options, env: { ...options.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true }) });
          report.workbuddy = { authorized: probe.authorized, executionUnknown: Boolean(probe.executionUnknown), message: probe.message };
          if (!probe.authorized) return { ok: false, code: probe.executionUnknown ? 'EXECUTION_UNRESOLVED' : 'AUTHENTICATION_REQUIRED' };
          const checked = await qualification.check(wbRuntime);
          if (!checked.ready) return { ok: false, code: checked.code === 'execution_unknown' ? 'EXECUTION_UNRESOLVED' : checked.code === 'SENSITIVE_REVIEW_REQUIRED' ? checked.code : 'WORKBUDDY_QUALIFICATION_REQUIRED' };
          receipt = await controlled.executeMaterialWorkBuddy({ runtime: wbRuntime, qualification: checked, batch, projectRules: 'State that this is synthetic and include 20,25,30.', extractSource: input => fs.readFile(input.path, 'utf8'), timeoutMs: 120000 });
        } else {
          const sandboxEvidence = await load('project-material-sandbox.cjs').verifyMaterialSandbox(executable);
          report.codexIsolation = { mode: sandboxEvidence.mode, passed: sandboxEvidence.passed };
          receipt = await load('project-material-agent.cjs').executeMaterialCodex({ executable, sandboxEvidence, batch,
            projectRules: 'Summarize in under 100 words; include the observed values 20,25,30 and clearly say this is synthetic data. Do not invent an author.', timeoutMs: 120000 });
        }
        return { ok: true, executionId: 'synthetic-live-digest' };
      },
    });
    assert.equal(result.ok, true);
    const committed = await load('project-knowledge-commit.cjs').createProjectKnowledgeCommitter({ store, workspace, knowledgeRoot: knowledge }).commit(batch.batchId, receipt);
    assert.equal(committed.fullyCommitted, true);
    const output = await fs.readFile(path.join(knowledge, 'summaries/experiment.md'), 'utf8');
    assert.ok(['20', '25', '30'].every(v => output.includes(v))); assert.match(output, /synthetic|合成|虚构|模拟/i);
    assert.equal(await fs.readFile(original, 'utf8'), text);
    report.passed = true; report.originalUnchanged = true; report.hostCommitted = true; report.resultAttempts = result.attempts;
    report.processedVersion = (await store.read()).materials[0].processing.processedVersion;
  } catch (e) { report.error = e.stack; }
  report.finishedAt = new Date().toISOString(); await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); app.exit(report.passed ? 0 : 1);
});
