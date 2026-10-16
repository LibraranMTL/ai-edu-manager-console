'use strict';
const { app } = require('electron');
const path = require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const { routingRuntimeHash } = require(path.join(path.resolve(process.argv[2]), 'smart-inbox-agent.cjs'));
    const adapter = { id: 'codex', executable: process.execPath };
    const a = await routingRuntimeHash(adapter), b = await routingRuntimeHash(adapter);
    require('node:assert/strict').equal(a, b); console.log(JSON.stringify({ passed: true, fingerprint: a })); app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
});
