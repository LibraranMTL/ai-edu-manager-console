'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveExternalMcpRuntime } = require('../electron/external-mcp-runtime.cjs');

test('external MCP prefers a validated Node 20+ runtime and otherwise keeps Electron fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-mcp-runtime-'));
  const node = path.join(root, process.platform === 'win32' ? 'node.exe' : 'node'); fs.writeFileSync(node, 'fixture');
  const selected = resolveExternalMcpRuntime({ env: { EDU_MANAGER_MCP_NODE: node, PATH: '' }, home: root, execPath: path.join(root, 'app.exe'),
    spawnSync: candidate => ({ status: candidate === node ? 0 : 1, stdout: candidate === node ? 'v22.1.0\n' : '' }) });
  assert.equal(selected.useElectronNode, false); assert.equal(selected.executable, fs.realpathSync(node));
  const fallback = resolveExternalMcpRuntime({ env: { PATH: '' }, home: path.join(root, 'missing'), execPath: path.join(root, 'app.exe'), spawnSync: () => ({ status: 1, stdout: '' }) });
  assert.equal(fallback.useElectronNode, true); assert.equal(fallback.executable, path.resolve(root, 'app.exe'));
});
