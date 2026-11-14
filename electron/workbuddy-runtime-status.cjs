'use strict';

const { spawn } = require('node:child_process');
const { discoverWorkBuddyRuntime, probeWorkBuddyConnection,
  probeWorkBuddyDesktopIpc } = require('./workbuddy-runtime.cjs');

function probeWindowsProcessImages(images = ['WorkBuddy.exe'], options = {}) {
  if ((options.platform || process.platform) !== 'win32') return Promise.resolve(false);
  const normalized = [...new Set(images.map(value => String(value || '').trim()).filter(Boolean))];
  if (!normalized.length) return Promise.resolve(false);
  return new Promise((resolve) => {
    let output = '', settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(Boolean(value)); } };
    let child;
    try {
      child = (options.spawnProcess || spawn)('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true });
    } catch { finish(false); return; }
    child.stdout?.on('data', chunk => { output = `${output}${chunk}`.slice(-2 * 1024 * 1024); });
    child.once('error', () => finish(false));
    child.once('close', code => finish(code === 0 && normalized.some(image =>
      new RegExp(`^"${image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'im').test(output))));
  });
}

function validCachedQualification(taskRuntime = {}, now = Date.now()) {
  const profiles = Object.values(taskRuntime.agentQualifications?.workbuddy || {});
  return profiles.some(item => item?.ready === true && Date.parse(item.expiresAt || '') > now);
}

function createWorkBuddyRuntimeStatusProbe(options = {}) {
  const now = options.now || Date.now;
  const cacheMs = Math.max(500, Number(options.cacheMs || 3000));
  let cached = null, pending = null;
  async function run() {
    const install = await options.findInstall();
    const auth = await options.readAuthorization().catch(() => ({ version: 0 }));
    const discoverRuntime = options.discoverRuntime || discoverWorkBuddyRuntime;
    const runtime = (options.applyAuthorization || ((value) => value))(discoverRuntime(install?.exePath || '', {
      findExecutable: options.findExecutable,
      hostNodePath: options.hostNodePath,
    }), auth);
    runtime.authVersion = Number(auth?.version || 0);
    const [processRunning, connection] = await Promise.all([
      (options.processProbe || probeWindowsProcessImages)(['WorkBuddy.exe', 'CodeBuddy.exe']),
      probeWorkBuddyConnection(runtime, {
        timeoutMs: 1500,
        ping: value => (options.ipcProbe || probeWorkBuddyDesktopIpc)(value, { timeoutMs: 1500 }),
      }),
    ]);
    const taskRuntime = options.readTaskRuntime?.() || {};
    const qualified = validCachedQualification(taskRuntime, now());
    const installed = Boolean(install?.installed || runtime.exePath || runtime.cliPath || runtime.available);
    const desktopSessionFound = Boolean(runtime.desktopSessionAvailable || connection.authenticated);
    const ipcReachable = connection.connected === true;
    const authorized = desktopSessionFound || qualified;
    const dispatchReady = Boolean(runtime.available && qualified);
    const startedByManager = Boolean(options.startedByManager?.());
    const reasonCode = !installed ? 'not_installed'
      : dispatchReady ? 'dispatch_ready'
        : ipcReachable ? 'desktop_connected'
          : desktopSessionFound ? 'ipc_unreachable'
            : !processRunning && !runtime.available ? 'not_running'
              : runtime.available ? 'cli_verification_pending' : 'not_running';
    return {
      installed,
      processRunning: Boolean(processRunning),
      desktopSessionFound,
      ipcReachable,
      authorized,
      dispatchReady,
      startedByManager,
      reasonCode,
      lastSeenAt: new Date(now()).toISOString(),
      // Compatibility projection: a live authenticated desktop pipe is
      // stronger evidence than a best-effort tasklist query.
      workbuddyOpened: Boolean(processRunning || ipcReachable),
    };
  }
  return async function probe({ force = false } = {}) {
    if (!force && cached && cached.until > now()) return cached.value;
    if (pending) return pending;
    pending = run().then(value => { cached = { value, until: now() + cacheMs }; return value; })
      .finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { createWorkBuddyRuntimeStatusProbe, probeWindowsProcessImages,
  validCachedQualification };
