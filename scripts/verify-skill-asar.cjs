'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
delete env.NODE_PATH;
const result = spawnSync(require('electron'), [
  '--no-error-dialogs', path.join(__dirname, 'verify-skill-packaged-runtime.cjs'), ...process.argv.slice(2),
], { env, encoding: 'utf8', windowsHide: true, timeout: 100000 });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.error) console.error(result.error);
process.exitCode = result.status === 0 ? 0 : 1;
