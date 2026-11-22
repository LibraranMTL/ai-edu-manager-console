'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { active, activeSources, applicationDecision, installed, readJson, rootPath, statePath, ROLES } = require('./learning-mode-rules.cjs');

const root = rootPath();
const args = process.argv.slice(2);
const own = args[1];
if (args[0] === 'browser') serveBrowser();
else if (args[0] === 'worker' && ROLES.includes(own)) serveApplications(own);

function serveBrowser() {
  let buffer = Buffer.alloc(0);
  let connected = false;
  let previous = '';
  let reportedAt = 0;
  const refresh = () => {
    if (!connected) return;
    const json = JSON.stringify({ sources: activeSources(root).map(({ role, revision, rules }) => ({
      role, revision, rules: { websites: rules.websites, allowedUrls: rules.allowedUrls },
    })) });
    if (json === previous) return;
    previous = json;
    const content = Buffer.from(json);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(content.length);
    process.stdout.write(Buffer.concat([header, content]));
  };
  process.stdin.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(0);
      if (size > 4096) { process.exit(1); return; }
      if (buffer.length < 4 + size) break;
      let message;
      try { message = JSON.parse(buffer.subarray(4, 4 + size)); } catch {}
      buffer = buffer.subarray(4 + size);
      if (message?.action === 'connect') {
        connected = true;
        previous = '';
        refresh();
      }
      if (message?.action === 'applied' && ['chrome', 'edge'].includes(message.browser) && Date.now() - reportedAt > 4000) {
        reportedAt = Date.now();
        fs.writeFileSync(path.join(root, message.browser + '-browser.json'), JSON.stringify({ at: reportedAt }));
      }
    }
  });
  const timer = setInterval(refresh, 750);
  process.stdin.on('end', () => clearInterval(timer));
}

function serveApplications(role) {
  const folder = path.join(root, role);
  const lock = path.join(folder, 'worker.pid');
  const status = path.join(folder, 'status.json');
  const psScript = path.join(__dirname, 'learning-mode-processes.ps1');
  const psArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psScript];
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const shellEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
  fs.mkdirSync(folder, { recursive: true });
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
  } catch {
    const old = Number(fs.readFileSync(lock, 'utf8'));
    if (old > 0) {
      try { process.kill(old, 0); return; } catch (error) { if (error.code !== 'ESRCH') return; }
    }
    fs.unlinkSync(lock);
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); } catch { return; }
  }
  const closeRequests = new Map();
  let scanner = null;
  let lastScan = 0;
  let lastError = '';
  let events = readJson(status, {}).events || [];
  let inventory = [];
  const remember = event => {
    events = [event, ...events].slice(0, 24);
  };
  const writeStatus = (state, ready) => {
    const pending = status + '.tmp';
    fs.writeFileSync(pending, JSON.stringify({
      at: Date.now(), active: active(state), ready, lastScan, lastError, apps: inventory, events,
    }));
    fs.renameSync(pending, status);
  };
  const handleSnapshot = line => {
    const state = readJson(statePath(role, root));
    if (!active(state)) return;
    let apps;
    try { apps = JSON.parse(line); } catch { return; }
    if (!Array.isArray(apps)) return;
    lastScan = Date.now();
    lastError = '';
    inventory = apps.slice(0, 100).map(({ file, product, hash, signer }) => ({ file, product, hash, signer }));
    for (const [key, time] of closeRequests) if (lastScan - time > 60_000) closeRequests.delete(key);
    for (const app of apps) {
      const decision = applicationDecision(app, state.rules);
      const key = [app.start, app.id, decision].join(':');
      if (decision === 'allow' || closeRequests.has(key)) continue;
      closeRequests.set(key, lastScan);
      const event = { at: lastScan, kind: decision, file: app.file, product: app.product, hash: app.hash };
      if (decision === 'review') { remember(event); continue; }
      const child = spawn(powershell, [...psArgs, '-Action', 'close'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'], env: shellEnvironment });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ id: app.id, path: app.path, start: app.start }));
      child.on('error', () => remember({ ...event, kind: 'close_failed' }));
      child.on('exit', code => remember({ ...event, kind: code === 0 ? 'block' : 'close_failed' }));
    }
  };
  function tick() {
    if (!installed(role, root)) { process.exit(0); return; }
    const state = readJson(statePath(role, root));
    if (active(state) && !scanner) {
      scanner = spawn(powershell, [...psArgs, '-Action', 'scan'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: shellEnvironment });
      readline.createInterface({ input: scanner.stdout }).on('line', handleSnapshot);
      scanner.on('error', error => { lastError = error.code || 'scan_error'; });
      scanner.on('close', code => { scanner = null; if (code !== 0 && code !== null) lastError = 'scan_exit_' + code; });
    } else if (!active(state) && scanner) {
      scanner.kill();
      lastScan = 0;
    }
    try { writeStatus(state, Boolean(scanner) && lastScan > Date.now() - 15_000); } catch {}
  }
  process.on('exit', () => {
    if (scanner) scanner.kill();
    try { fs.unlinkSync(lock); } catch {}
  });
  tick();
  setInterval(tick, 1200);
}
