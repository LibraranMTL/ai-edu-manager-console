const fs = require('fs');
const path = require('path');

function firstExisting(candidates, exists = fs.existsSync) {
  return [...new Set((candidates || []).map((item) => String(item || '')).filter(Boolean))]
    .find((item) => exists(item)) || '';
}

function discoverWorkBuddyRuntime(exePath, options = {}) {
  const executable = String(exePath || '');
  const installDir = executable ? path.dirname(executable) : '';
  const findExecutable = typeof options.findExecutable === 'function' ? options.findExecutable : () => '';
  const bundledCliPath = firstExisting([
    installDir && path.join(installDir, 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
    installDir && path.join(installDir, 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.js'),
    installDir && path.join(installDir, 'resources', 'app.asar.unpacked', 'cli', 'dist', 'codebuddy-headless.js'),
  ], options.exists || fs.existsSync);
  const directCliPath = bundledCliPath ? '' : String(findExecutable(['codebuddy.cmd', 'codebuddy.exe', 'codebuddy']) || '');
  const systemNodePath = bundledCliPath ? String(findExecutable(['node.exe', 'node']) || '') : '';
  const hostNodePath = bundledCliPath && !systemNodePath ? String(options.hostNodePath || '') : '';
  const nodePath = systemNodePath || hostNodePath;
  const mode = bundledCliPath ? 'node' : directCliPath ? 'direct' : '';
  return {
    available: Boolean(mode && (mode === 'direct' || nodePath)),
    exePath: executable,
    installDir,
    cliPath: bundledCliPath || directCliPath,
    nodePath,
    mode,
    useElectronNode: Boolean(mode === 'node' && !systemNodePath && hostNodePath),
  };
}

function workBuddyRuntimeEnv(runtime, baseEnv = process.env) {
  return runtime?.useElectronNode
    ? { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' }
    : { ...baseEnv };
}

function buildWorkBuddyInvocation(runtime, options = {}) {
  if (!runtime?.available || !runtime.cliPath) return null;
  const cwd = path.resolve(String(options.cwd || process.cwd()));
  const additionalRoots = [...new Set((options.additionalRoots || [])
    .map((item) => String(item || ''))
    .filter(Boolean)
    .map((item) => path.resolve(item))
    .filter((item) => item !== cwd))];
  const cliArgs = [
    '--print',
    '--input-format', 'text',
    '--output-format', 'json',
    '--permission-mode', 'acceptEdits',
    '--no-session-persistence',
    '--max-turns', String(Math.max(1, Math.min(40, Number(options.maxTurns || 12)))),
    ...(additionalRoots.length ? ['--add-dir', ...additionalRoots] : []),
  ];
  return {
    executable: runtime.mode === 'direct' ? runtime.cliPath : runtime.nodePath,
    args: runtime.mode === 'direct' ? cliArgs : [runtime.cliPath, ...cliArgs],
    cwd,
    stdinText: `${String(options.command || '').trim()}\n`,
    env: workBuddyRuntimeEnv(runtime, options.baseEnv),
  };
}

module.exports = {
  buildWorkBuddyInvocation,
  discoverWorkBuddyRuntime,
  workBuddyRuntimeEnv,
};
