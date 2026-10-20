'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function existingNodeCandidates({ env = process.env, home = os.homedir(), execPath = process.execPath } = {}) {
  const candidates = [];
  if (path.basename(execPath).toLowerCase() === (process.platform === 'win32' ? 'node.exe' : 'node')) candidates.push(execPath);
  if (env.EDU_MANAGER_MCP_NODE) candidates.push(String(env.EDU_MANAGER_MCP_NODE));
  for (const segment of String(env.PATH || '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(segment, process.platform === 'win32' ? 'node.exe' : 'node'));
  candidates.push(path.join(home, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', process.platform === 'win32' ? 'node.exe' : 'node'));
  const workbuddyVersions = path.join(home, '.workbuddy', 'binaries', 'node', 'versions');
  if (fs.existsSync(workbuddyVersions)) {
    for (const version of fs.readdirSync(workbuddyVersions).sort().reverse()) candidates.push(path.join(workbuddyVersions, version, process.platform === 'win32' ? 'node.exe' : 'node'));
  }
  return [...new Set(candidates.map(candidate => path.resolve(candidate)))];
}

function validatedNode(candidate, run = spawnSync) {
  try {
    if (!fs.statSync(candidate).isFile() || fs.lstatSync(candidate).isSymbolicLink()) return null;
    const result = run(candidate, ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 3000 });
    const match = String(result.stdout || '').trim().match(/^v(\d+)\./);
    if (result.status !== 0 || Number(match?.[1] || 0) < 20) return null;
    return { executable: fs.realpathSync(candidate), useElectronNode: false, nodeVersion: String(result.stdout || '').trim() };
  } catch { return null; }
}

function resolveExternalMcpRuntime(options = {}) {
  for (const candidate of existingNodeCandidates(options)) {
    const resolved = validatedNode(candidate, options.spawnSync || spawnSync);
    if (resolved) return resolved;
  }
  return { executable: path.resolve(options.execPath || process.execPath), useElectronNode: true, nodeVersion: '' };
}

module.exports = { existingNodeCandidates, resolveExternalMcpRuntime, validatedNode };
