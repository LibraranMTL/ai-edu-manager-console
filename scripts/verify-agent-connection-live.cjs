'use strict';
// Explicit opt-in, synthetic-only verification of packaged production modules.
// Reads authorization descriptors, never credentials; does not mutate task stores
// or start/recover student tasks. Vendor CLI retains ownership of its login state.
const { app } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path');
const resources = path.resolve(process.argv[2]), reportPath = path.resolve(process.argv[3]);
const codexExecutable = process.argv[4], workBuddyDesktop = process.argv[5], nodeExecutable = process.argv[6];
app.setPath('userData', require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'edu-connection-probe-')));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const report = { schema: 'edu.agent-connection-live.v1', syntheticOnly: true, studentTasksDispatched: false, startedAt: new Date().toISOString(), checks: [], passed: false };
  const load = file => require(path.join(resources, 'app.asar', 'electron', file));
  try {
    const auth = load('classification-auth.cjs').createClassificationAuth({ directory: path.join(process.env.APPDATA, 'edu-manager-launcher', 'classification-auth') });
    const state = await auth.read('workbuddy'), codexAuth = await auth.read('codex');
    const runtime = auth.apply(load('workbuddy-runtime.cjs').discoverWorkBuddyRuntime(workBuddyDesktop, { findExecutable: () => nodeExecutable, hostNodePath: process.execPath }), state);
    runtime.authVersion = state.version || 0;
    const routing = load('smart-inbox-agent.cjs').createRoutingAgent();
    const verify = async (name, operation) => {
      const at = Date.now();
      try { const result = await operation(); report.checks.push({ name, passed: true, durationMs: Date.now() - at, ...(result?.sourceCount ? { sourceCount: result.sourceCount } : {}) }); }
      catch (error) { report.checks.push({ name, passed: false, durationMs: Date.now() - at, code: error.code || '', message: error.message }); }
      console.log(JSON.stringify(report.checks.at(-1)));
    };
    const researchOnly = process.env.EDU_LIVE_RESEARCH_ONLY === '1';
    report.mode = researchOnly ? 'research-only' : 'connections-and-research';
    if (!researchOnly) {
      await verify('codex-classification', () => routing.qualify({ id: 'codex', executable: codexExecutable, authScope: process.env.CODEX_HOME || path.join(require('node:os').homedir(), '.codex'), authVersion: codexAuth.version || 0 }));
      await verify('workbuddy-classification', () => routing.qualify({ id: 'workbuddy', runtime, authScope: runtime.authRoot || runtime.configDir, authVersion: state.version || 0 }));
    }
    await verify('workbuddy-research', () => load('workbuddy-research.cjs').verifyWorkBuddyResearch({ runtime }));
    report.passed = report.checks.length === (researchOnly ? 1 : 3) && report.checks.every(item => item.passed);
  } catch (error) { report.error = { code: error.code || '', message: error.message }; }
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(reportPath), { recursive: true }); await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  app.exit(report.passed ? 0 : 1);
}).catch(error => { console.error(error.message); app.exit(1); });
