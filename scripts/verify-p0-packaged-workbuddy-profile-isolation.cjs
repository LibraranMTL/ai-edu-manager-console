'use strict';

const { app } = require('electron');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const resources = path.resolve(process.argv[2] || '');
const outputPath = path.resolve(process.argv[3] || 'p0-packaged-workbuddy-profile-isolation.json');

function syntheticChild({ firstChunk = '', excessiveChunk = '', closeOnKill = true } = {}) {
  const child = new EventEmitter();
  child.pid = 7319;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = () => setImmediate(() => {
    if (firstChunk) child.stdout.emit('data', Buffer.from(firstChunk));
    if (excessiveChunk) child.stdout.emit('data', Buffer.from(excessiveChunk));
  });
  child.kill = () => {
    if (closeOnKill) setImmediate(() => child.emit('close', 1));
    return true;
  };
  return child;
}

async function captureFailure(work) {
  try {
    await work();
    return { code: 'unexpected_success', stage: '', stopConfirmed: false };
  } catch (error) {
    return { code: String(error.code || ''), stage: String(error.stage || ''), stopConfirmed: error.stopConfirmed === true };
  }
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const report = {
    schema: 'edu.p0.packaged-workbuddy-profile-isolation.v1',
    candidateResources: resources,
    syntheticOnly: true,
    formalStudentDataTouched: false,
    passed: false,
    startedAt: new Date().toISOString(),
  };
  let root = '';
  try {
    const load = file => require(path.join(resources, 'app.asar', 'electron', file));
    const { runFixedWorkBuddy } = load('workbuddy-controlled.cjs');
    const { createAgentQualification, validAgentQualification, agentProfileStatus,
      CLASSIFICATION_PROFILE, DIGEST_PROFILE } = load('agent-invocation-service.cjs');
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-p0-workbuddy-profile-'));
    const cliPath = path.join(root, 'synthetic-cli.js');
    await fs.writeFile(cliPath, 'synthetic CLI never executed', 'utf8');
    const runtime = { available: true, mode: 'node', cliPath, nodePath: process.execPath,
      configDir: path.join(root, 'profile'), version: 'synthetic-v1' };

    const excessive = await captureFailure(() => runFixedWorkBuddy(runtime, 'synthetic classification', {
      maxOutputBytes: 32,
      spawnProcess: () => syntheticChild({ excessiveChunk: 'x'.repeat(64) }),
    }));
    const timeout = await captureFailure(() => runFixedWorkBuddy(runtime, 'synthetic classification', {
      timeoutMs: 20,
      spawnProcess: () => syntheticChild({ firstChunk: '{' }),
    }));

    const runtimeHash = 'synthetic-runtime-hash';
    const measuredAt = new Date().toISOString();
    const digestQualification = createAgentQualification({
      providerId: 'workbuddy', profile: DIGEST_PROFILE, runtimeHash, ready: true, measuredAt,
    });
    const classificationQualification = createAgentQualification({
      providerId: 'workbuddy', profile: CLASSIFICATION_PROFILE, runtimeHash, ready: false,
      message: `${excessive.code}; ${timeout.code}`, measuredAt,
    });
    const capability = { available: true, authorized: true, label: 'WorkBuddy' };
    const digestStatus = agentProfileStatus({ providerId: 'workbuddy', profile: DIGEST_PROFILE,
      capability, qualification: digestQualification });
    const classificationStatus = agentProfileStatus({ providerId: 'workbuddy', profile: CLASSIFICATION_PROFILE,
      capability, qualification: classificationQualification });

    report.failures = { excessive, timeout };
    report.profileStatus = {
      digest: { state: digestStatus.state, automaticReady: digestStatus.automaticReady },
      classification: { state: classificationStatus.state, automaticReady: classificationStatus.automaticReady },
    };
    report.assertions = {
      excessiveBounded: excessive.code === 'contract_output_excessive'
        && excessive.stage === 'possibly_sent' && excessive.stopConfirmed,
      timeoutBounded: timeout.code === 'contract_timeout'
        && timeout.stage === 'possibly_sent' && timeout.stopConfirmed,
      digestStillQualified: validAgentQualification(digestQualification, {
        providerId: 'workbuddy', profile: DIGEST_PROFILE, runtimeHash,
      }) && digestStatus.state === 'ready',
      classificationOnlyRed: classificationStatus.state === 'qualification_required'
        && classificationStatus.automaticReady === false,
    };
    report.passed = Object.values(report.assertions).every(Boolean);
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
  } finally {
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  app.exit(report.passed ? 0 : 1);
});
