'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { install } = require('../electron/external-agent-install.cjs');
const { toolDefinitions } = require('../electron/external-agent-mcp.cjs');
const { PRESETS } = require('../electron/external-agent-connector.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-unified-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['.codex', '.workbuddy', '.codebuddy']) fs.mkdirSync(path.join(root, dir));
  const codex = path.join(root, '.codex/config.toml'), wb = path.join(root, '.workbuddy/mcp.json'), cb = path.join(root, '.codebuddy/.mcp.json');
  fs.writeFileSync(codex, '# unrelated\n[mcp_servers.other]\ncommand = "unrelated"\n# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:START\n[mcp_servers.edu-manager-knowledge]\ncommand = "powershell.exe"\nargs = []\n# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:END\n');
  const original = { custom: true, mcpServers: { other: { command: 'unrelated' }, 'edu-manager-knowledge': { command: 'powershell.exe', args: ['agent-knowledge-mcp.ps1'], allowedTools: ['old'] } } };
  for (const file of [wb, cb]) fs.writeFileSync(file, JSON.stringify(original));
  const args = { home: root, bridgePath: path.resolve(__dirname, '../electron/agent-knowledge-mcp.ps1'), descriptorPath: path.join(root, 'legacy.json'), connectionConfig: path.join(root, 'connection.json') };
  return { root, codex, wb, cb, args };
}
test('upgrade existing identity keeps other MCPs, backs up configs and is repeatable', t => {
  const f = fixture(t);
  for (const host of ['codex', 'workbuddy']) {
    const r = install({ ...f.args, host }); assert.equal(r.serverName, 'edu-manager-knowledge');
    assert.ok(r.backups.every(fs.existsSync)); install({ ...f.args, host });
  }
  const text = fs.readFileSync(f.codex, 'utf8'); assert.equal((text.match(/\[mcp_servers.edu-manager-knowledge\]/g) || []).length, 1);
  assert.match(text, /command = "unrelated"/); assert.match(text, /-ConnectorConfig/);
  for (const file of [f.wb, f.cb]) {
    const value = JSON.parse(fs.readFileSync(file)); assert.equal(value.custom, true); assert.equal(value.mcpServers.other.command, 'unrelated');
    assert.equal(Object.keys(value.mcpServers).length, 2); assert.equal(value.mcpServers['edu-manager-knowledge'].allowedTools, undefined);
  }
});
test('malformed second WorkBuddy config is rejected before changing first config', t => {
  const f = fixture(t), before = fs.readFileSync(f.wb, 'utf8'); fs.writeFileSync(f.cb, '{broken');
  assert.throws(() => install({ ...f.args, host: 'workbuddy' })); assert.equal(fs.readFileSync(f.wb, 'utf8'), before);
});
test('all twelve legacy tool names survive with explicit scoped-session parameters', () => {
  const tools = toolDefinitions(PRESETS.full);
  for (const name of ['query_education_knowledge', 'submit_education_conversation', 'list_education_archive', 'get_education_task_status', 'execute_education_write', 'get_education_write_status', 'get_recent_education_context', 'start_education_session', 'record_authorized_education_turn', 'finalize_education_session', 'accept_education_handoff', 'cancel_education_handoff']) {
    assert.ok(tools.find(t => t.name === name)?.inputSchema.required.includes('sessionId'));
  }
  assert.ok(tools.some(t => t.name === 'list_authorized_students'));
  assert.equal(new Set(tools.map(t => t.name)).size, tools.length);
});
test('upgraded bridge with missing runtime never falls back to legacy descriptor', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  fs.writeFileSync(f.args.descriptorPath, JSON.stringify({ defaults: { scopeId: 'must-not-use-legacy-student' } }));
  const result = require('node:child_process').spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', f.args.bridgePath, '-Descriptor', f.args.descriptorPath, '-ConnectorConfig', f.args.connectionConfig], { windowsHide: true, encoding: 'utf8', timeout: 10000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n' });
  assert.equal(result.status, 1); assert.equal(result.stdout.trim(), ''); assert.match(result.stderr, /legacy student fallback is disabled/);
});
test('real PowerShell bridge preserves JSON-RPC stdio using configured Node or Electron runtime', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t), http = require('node:http'), { spawn } = require('node:child_process');
  const server = http.createServer((req, res) => { req.resume(); res.end(JSON.stringify({ ok: true, capabilities: PRESETS.full })); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  fs.writeFileSync(f.args.connectionConfig, JSON.stringify({ schema: 'edu-manager.external-connection.v1', endpoint: `http://127.0.0.1:${server.address().port}/api/agent/connector`, credentialFile: path.join(f.root, 'credential'), runtimeExecutable: process.env.EDU_TEST_MCP_RUNTIME || process.execPath, runtimeScript: path.resolve(__dirname, '../electron/external-agent-mcp.cjs') }));
  fs.writeFileSync(path.join(f.root, 'credential'), 'synthetic-only');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', f.args.bridgePath, '-Descriptor', f.args.descriptorPath, '-ConnectorConfig', f.args.connectionConfig], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill()); let output = '', errors = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { errors += b; });
  // Keep stdin open until both replies arrive. A buffered '& executable' proxy
  // appears to pass at EOF but deadlocks every real MCP host's initialization.
  const repliesReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('interactive MCP replies timed out: ' + errors)), 10000);
    const lines = require('node:readline').createInterface({ input: child.stdout }); let count = 0;
    lines.on('line', () => { if (++count === 2) { clearTimeout(timer); resolve(); } });
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  await repliesReady; child.stdin.end();
  const code = await new Promise((r, reject) => { const timer = setTimeout(() => { child.kill(); reject(Error('bridge timed out')); }, 15000); child.on('error', reject); child.on('close', c => { clearTimeout(timer); r(c); }); });
  assert.equal(code, 0, errors); const replies = output.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(replies[0].result.serverInfo.name, 'edu-manager-knowledge'); assert.ok(replies[1].result.tools.some(t => t.name === 'education_open_session'));
});
