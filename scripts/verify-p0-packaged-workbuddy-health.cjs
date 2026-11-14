'use strict';

const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const resources = path.resolve(process.argv[2] || '');
const outputPath = path.resolve(process.argv[3] || 'p0-packaged-workbuddy-health.json');
const workBuddyDesktop = path.resolve(process.argv[4] || '');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const report = {
    schema: 'edu.p0.packaged-workbuddy-health.v1',
    candidateResources: resources,
    readOnly: true,
    modelContractInvocations: 0,
    startedAt: new Date().toISOString(),
    passed: false,
  };
  try {
    const runtimeModule = require(path.join(resources, 'app.asar', 'electron', 'workbuddy-runtime.cjs'));
    const runtime = runtimeModule.discoverWorkBuddyRuntime(workBuddyDesktop, {
      findExecutable: names => names.includes('node.exe') ? process.execPath : '',
      hostNodePath: process.execPath,
    });
    const started = performance.now();
    const connection = await runtimeModule.probeWorkBuddyConnection(runtime, {
      qualify: async () => { report.modelContractInvocations += 1; },
    });
    const durationMs = performance.now() - started;
    report.runtime = {
      available: runtime.available,
      desktopSessionAvailable: runtime.desktopSessionAvailable,
      mode: runtime.mode,
    };
    report.connection = connection;
    report.durationMs = durationMs;
    report.assertions = {
      installed: connection.installed === true,
      connected: connection.connected === true,
      boundedUnderTenSeconds: durationMs < 10_000,
      noModelContract: report.modelContractInvocations === 0,
    };
    report.passed = Object.values(report.assertions).every(Boolean);
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
  }
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  app.exit(report.passed ? 0 : 1);
});
