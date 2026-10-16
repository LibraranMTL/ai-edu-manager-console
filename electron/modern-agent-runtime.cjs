'use strict';

const path = require('node:path');

function uniqueRoots(values = []) {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean).map((item) => path.resolve(item)))];
}

function buildTraeInvocation(runtime = {}, options = {}) {
  if (!runtime.cliPath) return null;
  const cwd = path.resolve(String(options.cwd || process.cwd()));
  const readOnly = options.readOnly === true;
  return {
    executable: runtime.cliPath,
    args: [
      'exec',
      '--cd', cwd,
      '--sandbox', readOnly ? 'read-only' : 'workspace-write',
      '--ask-for-approval', 'never',
      '-',
    ],
    cwd,
    stdinText: `${String(options.command || '').trim()}\n`,
  };
}

function buildQoderInvocation(runtime = {}, options = {}) {
  if (!runtime.cliPath) return null;
  const cwd = path.resolve(String(options.cwd || process.cwd()));
  const readOnly = options.readOnly === true;
  const additionalRoots = uniqueRoots(options.additionalRoots).filter((item) => item !== cwd);
  const args = [
    '--print',
    '--output-format', 'json',
    '--cwd', cwd,
    '--permission-mode', 'auto',
    ...(readOnly ? ['--tools', 'Read,Grep,Glob'] : []),
    ...additionalRoots.flatMap((item) => ['--add-dir', item]),
    String(options.command || '').trim(),
  ];
  return { executable: runtime.cliPath, args, cwd, stdinText: '' };
}

function modernAgentRuntime({ desktop = {}, cliPath = '' } = {}) {
  return {
    installed: Boolean(desktop.installed || desktop.exePath || cliPath),
    desktopPath: String(desktop.exePath || ''),
    cliPath: String(cliPath || ''),
    automatic: Boolean(cliPath),
    desktopHandoff: Boolean(desktop.exePath && !cliPath),
  };
}

module.exports = { buildQoderInvocation, buildTraeInvocation, modernAgentRuntime };
