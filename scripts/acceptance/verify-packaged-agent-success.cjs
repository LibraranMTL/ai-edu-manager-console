'use strict';

// Controlled real-host success acceptance. It loads the packaged candidate's
// production modules but uses only a temporary synthetic project/material.
const { app } = require('electron');
const fs = require('node:fs/promises');
const originalFs = require('original-fs').promises;
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const resources = path.resolve(process.argv[2]);
const reportPath = path.resolve(process.argv[3]);
const codexExecutable = path.resolve(process.argv[4]);
const workBuddyDesktop = path.resolve(process.argv[5]);
const provider = String(process.argv[6] || '').trim().toLowerCase();

if (!['workbuddy', 'codex'].includes(provider)) {
  throw new Error('provider must be workbuddy or codex');
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const runtimeAsarSha256 = crypto.createHash('sha256')
    .update(await originalFs.readFile(path.join(resources, 'app.asar'))).digest('hex');
  const report = {
    schema: 'edu.p0.real-host-agent-success.v1',
    provider,
    runtimeAsarSha256,
    fixture: 'synthetic-only',
    formalStudentDataTouched: false,
    passed: false,
    attempts: [],
    startedAt: new Date().toISOString(),
  };
  let root = '';
  let taskStore = null;
  try {
    const runtime = path.join(resources, 'app.asar', 'electron');
    const load = file => require(path.join(runtime, file));
    root = await fs.mkdtemp(path.join(os.tmpdir(), `p0-${provider}-success-`));
    const raw = path.join(root, 'raw');
    const knowledge = path.join(root, 'knowledge');
    await fs.mkdir(raw);
    await fs.mkdir(knowledge);

    const original = path.join(raw, 'synthetic.txt');
    const text = 'Synthetic teaching experiment. The invented observations are 20, 25 and 30 degrees Celsius. This file has no student author and exists only for controlled software acceptance.';
    await fs.writeFile(original, text);

    const { createProjectMaterialStore } = load('project-materials.cjs');
    const store = createProjectMaterialStore({
      projectId: `p0-synthetic-${provider}`,
      managerPath: path.join(root, 'manager'),
      roots: { workspace: { kind: 'workspace', path: raw } },
    });
    const material = (await store.registerFiles([{ location: { rootId: 'workspace', kind: 'workspace', relativePath: 'synthetic.txt' } }])).result[0];
    const workspace = load('project-material-digest.cjs').createProjectDigestWorkspace({
      store,
      knowledgeRoot: knowledge,
      allowedDirectories: ['summaries'],
    });
    const batch = await workspace.prepare({
      materialIds: [material.materialId],
      ruleVersion: 'p0-real-host-synthetic-v1',
      targets: ['summaries/experiment.md'],
    });

    const taskId = `p0-synthetic-${provider}-task`;
    const workKey = `p0-synthetic-${provider}-digest`;
    const sourceVersion = `${material.materialId}:v${Number(material.version || 1)}`;
    const sessionRunId = `p0-synthetic-${provider}-${crypto.randomUUID()}`;
    const taskDir = path.join(root, 'task-center');
    const taskFile = path.join(taskDir, 'tasks.json');
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(taskFile, JSON.stringify({
      protocolVersion: 'p0-agent0228-synthetic-v1', updatedAt: new Date().toISOString(), runtime: {}, deletedTasks: [], history: [],
      tasks: [{ id: taskId, title: `P0 ${provider} synthetic digest`, kind: 'project_digest', sourceType: 'project',
        sourceId: batch.projectId, status: 'queued', trigger: 'event', executor: provider, requestedExecutor: provider,
        executionMode: 'automatic', automaticExecution: true, requestOrigin: 'recovery', priorityClass: 80,
        queuedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), workKey, sourceVersion,
        pipelineVersion: 'p0-agent0228-synthetic-v1' }],
    }, null, 2));
    taskStore = load('task-state-store.cjs').createTaskStateStore({ legacyPath: taskFile });
    taskStore.open();
    const lifecycle = [];
    const storeAdapter = {
      claimTaskExecution(query) {
        const current = taskStore.detail(taskId);
        return taskStore.claimTaskExecution({ ...query, expectedTaskRevision: current.taskRevision });
      },
      advanceTaskExecution(query) { return taskStore.advanceTaskExecution(query); },
    };
    const barrier = load('task-dispatch-barrier.cjs').createTaskDispatchBarrier({
      store: storeAdapter,
      readTask: () => taskStore.detail(taskId).task,
      readPolicy: () => ({ provider, profile: 'digest_host_mediated.v1', syntheticOnly: true }),
      canSend: async () => ({ ok: true }),
      sessionRunId,
    });
    const claim = await barrier.claim(taskId, provider, 'automatic', 'digest_host_mediated.v1');
    assert.equal(claim.ok, true);
    lifecycle.push({ type: 'claim', executionId: claim.executionId, at: new Date().toISOString() });
    const intent = await barrier.sendIntent(claim, provider);
    assert.equal(intent.ok, true);
    lifecycle.push({ type: 'send_intent', executionId: claim.executionId, at: new Date().toISOString() });
    const recordStarted = async evidence => {
      const started = await barrier.started(claim, evidence);
      if (!lifecycle.some(event => event.type === 'started')) {
        lifecycle.push({ type: 'started', executionId: claim.executionId, at: new Date().toISOString(), ...evidence });
      }
      return started;
    };

    let receipt;
    const result = await load('agent-control-plane.cjs').dispatchAgent({
      policy: { primary: provider, fallbacks: [], enabled: true, desktopHandoff: false },
      profile: 'digest_host_mediated.v1',
      current: () => true,
      record: async event => report.attempts.push(event),
      handoff: async () => { throw new Error('Controlled test must not open desktop handoff'); },
      attempt: async id => {
        assert.equal(id, provider);
        if (id === 'workbuddy') {
          const workbuddy = load('workbuddy-runtime.cjs');
          const authManager = load('classification-auth.cjs').createClassificationAuth({
            directory: path.join(process.env.APPDATA, 'edu-manager-launcher', 'classification-auth'),
          });
          const auth = await authManager.read('workbuddy');
          const wbRuntime = authManager.apply(workbuddy.discoverWorkBuddyRuntime(workBuddyDesktop, {
            findExecutable: () => '',
            hostNodePath: process.execPath,
          }), auth);
          wbRuntime.authVersion = auth.version || 0;
          const dispatchReadiness = load('agent-capability-readiness.cjs').workBuddyDispatchReadiness({
            adapter: { runtime: wbRuntime }, profileId: 'digest_host_mediated.v1', savedQualification: null,
          });
          report.dispatchReadiness = {
            state: dispatchReadiness.state,
            reasonCode: dispatchReadiness.reasonCode,
            desktopSessionAvailable: Boolean(wbRuntime.desktopSessionAvailable),
          };
          assert.equal(dispatchReadiness.state, 'available');
          const probe = await workbuddy.probeWorkBuddyAuthorization(wbRuntime, {
            timeoutMs: 30000,
            spawnProcess: (exe, args, options) => spawn(exe, args, {
              ...options,
              env: { ...options.env, ELECTRON_RUN_AS_NODE: '1' },
              windowsHide: true,
            }),
          });
          report.authorization = {
            authorized: probe.authorized,
            executionUnknown: Boolean(probe.executionUnknown),
            message: probe.message,
            diagnostic: summarizeProbe(probe),
          };
          assert.equal(probe.authorized, true);
          const controlled = load('workbuddy-controlled.cjs');
          const qualification = await controlled.createWorkBuddyQualification().check(wbRuntime);
          report.qualification = { ready: qualification.ready, code: qualification.code || '' };
          assert.equal(qualification.ready, true);
          receipt = await controlled.executeMaterialWorkBuddy({
            runtime: wbRuntime,
            qualification,
            batch,
            projectRules: 'State that the input is synthetic and include 20, 25 and 30. Do not identify a student.',
            extractSource: input => fs.readFile(input.path, 'utf8'),
            timeoutMs: 180000,
            onStarted: recordStarted,
          });
        } else {
          const sandboxEvidence = await load('project-material-sandbox.cjs').verifyMaterialSandbox(codexExecutable);
          report.isolation = {
            mode: sandboxEvidence.mode,
            passed: sandboxEvidence.passed,
            degraded: Boolean(sandboxEvidence.degraded),
            reason: sandboxEvidence.reason || '',
            details: sandboxEvidence.details || {},
          };
          assert.ok(['os-read-only', 'host-mediated-no-tools'].includes(sandboxEvidence.mode));
          receipt = await load('project-material-agent.cjs').executeMaterialCodex({
            executable: codexExecutable,
            sandboxEvidence,
            batch,
            projectRules: 'Summarize in under 100 words. Include 20, 25 and 30, say the observations are synthetic, and do not identify a student.',
            timeoutMs: 180000,
            onStarted: recordStarted,
          });
        }
        return { ok: true, executionId: claim.executionId };
      },
    });

    assert.equal(result.ok, true);
    lifecycle.push({ type: 'receipt', executionId: claim.executionId, at: new Date().toISOString() });
    const committed = await load('project-knowledge-commit.cjs').createProjectKnowledgeCommitter({
      store,
      workspace,
      knowledgeRoot: knowledge,
    }).commit(batch.batchId, receipt);
    assert.equal(committed.fullyCommitted, true);
    const settled = taskStore.advanceTaskExecution({ executionId: claim.executionId, expectedPhase: 'started', nextPhase: 'settled',
      resultKind: 'completed', settlementSessionRunId: sessionRunId,
      evidence: { receiptVerified: true, hostCommitted: true, batchId: batch.batchId } });
    assert.equal(settled.ok, true);
    lifecycle.push({ type: 'settled', executionId: claim.executionId, at: new Date().toISOString(),
      businessOutcome: 'completed', settlementState: 'settled' });
    const output = await fs.readFile(path.join(knowledge, 'summaries', 'experiment.md'), 'utf8');
    assert.ok(['20', '25', '30'].every(value => output.includes(value)));
    assert.match(output, /synthetic|合成|虚构|模拟/i);
    assert.equal(await fs.readFile(original, 'utf8'), text);

    // Persist only synthetic acceptance evidence beside the report. The
    // temporary workspace is intentionally not reused as evidence because it
    // can disappear independently of the acceptance report.
    const evidencePrefix = `${provider}-e2e`;
    const outputEvidence = path.join(path.dirname(reportPath), `${evidencePrefix}-artifact.md`);
    const receiptEvidence = path.join(path.dirname(reportPath), `${evidencePrefix}-receipt.json`);
    const executionId = claim.executionId;
    await fs.writeFile(outputEvidence, output);
    await fs.writeFile(receiptEvidence, JSON.stringify({
      schema: 'edu.agent0228.synthetic-receipt-evidence.v1',
      executionId,
      workKey,
      sourceVersion,
      batchId: batch.batchId,
      artifact: path.basename(outputEvidence),
      validation: { valid: true, hostCommitted: true, syntheticOnly: true },
    }, null, 2));

    report.passed = true;
    report.originalUnchanged = true;
    report.hostCommitted = true;
    report.outputBytes = Buffer.byteLength(output);
    report.resultAttempts = result.attempts;
    report.processedVersion = (await store.read()).materials[0].processing.processedVersion;
    report.executionId = executionId;
    report.workKey = workKey;
    report.sourceVersion = sourceVersion;
    report.batchId = batch.batchId;
    report.acceptanceProcessId = process.pid;
    report.outputArtifact = path.basename(outputEvidence);
    report.receiptArtifact = path.basename(receiptEvidence);
    report.lifecycle = lifecycle;
    report.sessionSummary = taskStore.getTaskSessionSummary(sessionRunId);
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
  }
  report.finishedAt = new Date().toISOString();
  try { taskStore?.close(); } catch { /* Evidence is already written or the failure is retained below. */ }
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(report.passed ? 0 : 1);
});

function summarizeProbe(probe = {}) {
  const output = String(probe.output || '');
  const errorOutput = String(probe.errorOutput || '');
  let envelope = { format: 'non_json' };
  try {
    const parsed = JSON.parse(output.trim());
    const events = Array.isArray(parsed) ? parsed : [parsed];
    const last = events.at(-1) || {};
    envelope = {
      format: Array.isArray(parsed) ? 'event_array' : 'object',
      eventCount: events.length,
      eventTypes: events.slice(0, 20).map((event) => String(event?.type || '')),
      lastType: String(last.type || ''),
      lastSubtype: String(last.subtype || ''),
      lastResult: typeof last.result === 'string' ? last.result.slice(0, 200) : '',
    };
  } catch { /* Shape and hashes are sufficient for non-JSON output. */ }
  return {
    code: Number(probe.code),
    authRequired: Boolean(probe.authRequired),
    timedOut: Boolean(probe.timedOut),
    stopConfirmed: probe.stopConfirmed !== false,
    outputBytes: Buffer.byteLength(output),
    errorBytes: Buffer.byteLength(errorOutput),
    outputSha256: crypto.createHash('sha256').update(output).digest('hex'),
    errorSha256: crypto.createHash('sha256').update(errorOutput).digest('hex'),
    envelope,
  };
}
