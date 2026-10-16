'use strict';
// Opt-in real CLI checks use public/synthetic prompts only, never student data.
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const tag = process.argv[2];
if (!/^[a-zA-Z0-9._-]+$/.test(tag || '')) throw Error('candidate tag required');
const directory = path.join(root, 'release/windows/candidates', tag);
const auditName = fs.readdirSync(directory).find(x => x.endsWith('-build-audit.json'));
const audit = JSON.parse(fs.readFileSync(path.join(directory, auditName), 'utf8'));
const resources = path.join(audit.stagingRoot, 'out/win-unpacked/resources');
const codex = process.argv[3], workbuddy = process.argv[4];
for (const file of [codex, workbuddy]) if (!fs.existsSync(file)) throw Error('official CLI installation required');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(__dirname, 'verify-agent-connection-live.cjs'), resources, path.join(directory, 'live-connection-verification.json'), codex, workbuddy, process.execPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
const timeout = setTimeout(() => { child.kill(); process.exitCode = 1; }, 360000);
child.on('exit', code => { clearTimeout(timeout); process.exitCode = code || 0; });
child.on('error', error => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
