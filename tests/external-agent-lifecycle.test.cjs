'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), http = require('node:http');
const lifecycle = require('../electron/external-agent-install.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-lifecycle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { home: root, bridgePath: path.resolve(__dirname, '../electron/agent-knowledge-mcp.ps1'), descriptorPath: path.join(root, 'legacy.json'), connectionConfig: path.join(root, 'connection.json') };
  return { root, options };
}
test('fresh install, repeated install, repair and uninstall preserve unrelated settings for both hosts', t => {
  const { root, options } = fixture(t);
  for (const host of ['codex', 'workbuddy']) {
    const opt = { ...options, host }, file = lifecycle.registrations(root, host)[0];
    assert.equal(lifecycle.inspect(opt).status, 'repair_required');
    lifecycle.install(opt); const first = fs.readFileSync(file, 'utf8');
    assert.equal(lifecycle.install(opt).changed, 0); assert.equal(lifecycle.inspect(opt).status, 'configured');
    fs.writeFileSync(file, first.replace('powershell.exe', 'broken.exe'));
    lifecycle.install(opt); assert.equal(fs.readFileSync(file, 'utf8'), first);
    lifecycle.uninstall(opt); assert.equal(fs.readFileSync(file, 'utf8').includes('edu-manager-knowledge'), false);
    assert.equal(lifecycle.uninstall(opt).changed, 0);
  }
});
test('owned student-project override is removed with backup and unrelated TOML stays byte-for-byte', t => {
  const { root, options } = fixture(t), host = 'codex', project = path.join(root, 'student/.codex/config.toml');
  lifecycle.install({ ...options, home: path.join(root, 'student'), host });
  fs.appendFileSync(project, '\n[mcp_servers.other]\ncommand = "other"\n');
  const r = lifecycle.install({ ...options, host, projectConfigPaths: [project] });
  assert.ok(r.backups.length); assert.equal(fs.readFileSync(project, 'utf8'), '\n\n[mcp_servers.other]\ncommand = "other"\n');
});
test('malformed TOML, unknown quoted identity, nested foreign block and parallel entries fail closed', t => {
  const { root, options } = fixture(t), host = 'codex', file = lifecycle.registrations(root, host)[0];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const body of ['{broken', '[mcp_servers."edu-manager-knowledge"]\ncommand="foreign"', '[mcp_servers.edu-manager-external-a]\ncommand="foreign"', '# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:START\n[mcp_servers.edu-manager-knowledge]\ncommand="old"\n[mcp_servers.foreign]\ncommand="keep"\n# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:END']) {
    fs.writeFileSync(file, body); assert.throws(() => lifecycle.install({ ...options, host })); assert.equal(fs.readFileSync(file, 'utf8'), body);
  }
});
test('WorkBuddy aliases, foreign same-name entry and malformed mirror prevent any partial update', t => {
  const { root, options } = fixture(t), opt = { ...options, host: 'workbuddy' };
  lifecycle.install(opt); const primary = lifecycle.registrations(root, 'workbuddy')[0], before = fs.readFileSync(primary, 'utf8');
  const mirror = path.join(root, '.codebuddy/.mcp.json'); fs.mkdirSync(path.dirname(mirror));
  for (const body of ['{bad', JSON.stringify({ mcpServers: { 'edu-manager-knowledge': { command: 'foreign', args: [] } } }), JSON.stringify({ mcpServers: { renamed: { args: ['agent-knowledge-mcp.ps1'] } } })]) {
    fs.writeFileSync(mirror, body); assert.throws(() => lifecycle.install(opt)); assert.equal(fs.readFileSync(primary, 'utf8'), before);
  }
});
test('Codex custom home is respected without creating default configuration', t => {
  const { root, options } = fixture(t), codexHome = path.join(root, 'custom-codex');
  lifecycle.install({ ...options, host: 'codex', codexHome });
  assert.ok(fs.existsSync(path.join(codexHome, 'config.toml'))); assert.equal(fs.existsSync(path.join(root, '.codex')), false);
});

test('Codex manual deletion leaves harmless markers; reinstall/uninstall preserve unrelated text and values', t => {
  const { root, options } = fixture(t), opt = { ...options, host: 'codex' }, file = lifecycle.registrations(root, 'codex')[0];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const keep = '# unrelated\r\nnote = "edu-manager-knowledge is a product name"\r\n[mcp_servers.other]\r\ncommand = "keep.exe"\r\n';
  for (const suffix of ['END', 'START', 'START\r\n# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:END']) {
    const original = keep + '# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:' + suffix + '\r\n';
    fs.writeFileSync(file, original);
    assert.equal(lifecycle.inspectRemoval(opt).status, 'removed');
    assert.equal(fs.readFileSync(file, 'utf8'), original, 'inspection never writes');
    const result = lifecycle.uninstall(opt);
    assert.equal(fs.readFileSync(result.backups[0], 'utf8'), original);
    assert.equal(fs.readFileSync(file, 'utf8'), keep);
    lifecycle.install(opt); assert.equal(lifecycle.inspect(opt).status, 'configured');
    assert.equal(lifecycle.install(opt).changed, 0);
    assert.equal(lifecycle.inspectRemoval(opt).status, 'removal_required');
  }
});

test('markers inside TOML strings or around foreign values never authorize erasing data', t => {
  const { root, options } = fixture(t), opt = { ...options, host: 'codex' }, file = lifecycle.registrations(root, 'codex')[0];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const original of [
    'note = """\n# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:END\nkeep\n"""\n',
    '# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:START\nnote="keep"\n[mcp_servers.edu-manager-knowledge]\ncommand="owned"\n# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:END\n',
    '[mcp_servers."edu-manager-knowledge"]\ncommand="foreign"\n# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:END\n',
  ]) {
    fs.writeFileSync(file, original);
    assert.equal(lifecycle.inspectRemoval(opt).status, 'configuration_conflict');
    assert.throws(() => lifecycle.install(opt)); assert.throws(() => lifecycle.uninstall(opt));
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  }
});
test('second config write failure rolls back earlier owned changes and preserves recoverable backups', t => {
  const { root, options } = fixture(t), opt = { ...options, host: 'workbuddy' };
  const files = ['.workbuddy/mcp.json', '.codebuddy/.mcp.json'].map(f => path.join(root, f));
  const before = JSON.stringify({ mcpServers: { unrelated: { command: 'keep' } } });
  for (const f of files) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, before); }
  const fakeFs = Object.create(fs); let count = 0;
  fakeFs.renameSync = (from, to) => { if (++count === 2) throw Error('SIMULATED_CONFIG_WRITE_FAILURE'); return fs.renameSync(from, to); };
  const ctx = vm.createContext({ module: { exports: {} }, require: n => n === 'node:fs' ? fakeFs : require(n) });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../electron/external-agent-lifecycle.cjs'), 'utf8'), ctx);
  assert.throws(() => ctx.module.exports.install(opt), /SIMULATED_CONFIG_WRITE_FAILURE/);
  for (const f of files) {
    assert.equal(fs.readFileSync(f, 'utf8'), before);
    assert.ok(fs.readdirSync(path.dirname(f)).some(n => n.includes('.pre-r21-')));
    assert.equal(fs.readdirSync(path.dirname(f)).some(n => n.includes('.r21-')), false);
  }
});
test('rollback never overwrites a concurrent external config edit', t => {
  const { root, options } = fixture(t), opt = { ...options, host: 'workbuddy' };
  const files = ['.workbuddy/mcp.json', '.codebuddy/.mcp.json'].map(f => path.join(root, f));
  for (const f of files) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{}'); }
  const fakeFs = Object.create(fs); let count = 0;
  fakeFs.renameSync = (from, to) => {
    if (++count === 2) { fs.writeFileSync(files[0], '{"external":"concurrent edit"}'); throw Error('SIMULATED_CONCURRENT_EDIT'); }
    return fs.renameSync(from, to);
  };
  const ctx = vm.createContext({ module: { exports: {} }, require: n => n === 'node:fs' ? fakeFs : require(n) });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../electron/external-agent-lifecycle.cjs'), 'utf8'), ctx);
  assert.throws(() => ctx.module.exports.install(opt), /SIMULATED_CONCURRENT_EDIT/);
  assert.equal(fs.readFileSync(files[0], 'utf8'), '{"external":"concurrent edit"}');
  assert.equal(fs.readFileSync(files[1], 'utf8'), '{}');
});
async function mainFixture(t) {
  const { root } = fixture(t), electron = path.resolve(__dirname, '../electron'); let server;
  const load = n => require(path.join(electron, n));
  const ctx = vm.createContext({ fs, path, os: { homedir: () => root }, app: { getPath: () => root }, process: { execPath: process.execPath, env: {} }, __dirname: electron,
    readStudentsIndex: () => [], readProjects: () => [], normalizeProject: p => p,
    agentAccessGrantStorePath: () => path.join(root, 'grants.json'), agentWriteIntentPath: () => path.join(root, 'writes.json'), readAgentWriteIntents: () => ({ intents: [] }),
    activeAgentKnowledgeDescriptorPath: () => path.join(root, 'active/descriptor.json'), activeAgentKnowledgeMcpBridgePath: () => path.join(root, 'active/agent-knowledge-mcp.ps1'),
    writeJsonAtomic: load('digest-batch.cjs').writeJsonAtomic, require: load, getHostServicePort: () => server.address().port });
  vm.runInContext('let externalConnectorRuntime; let hostServer = true; let externalHostActionBusy = false;', ctx);
  const source = fs.readFileSync(path.join(electron, 'main.cjs'), 'utf8');
  for (const name of ['externalConnectorStore', 'externalConnectionDirectory', 'unifiedKnowledgeRegistrations', 'externalHostInstallOptions', 'externalHostStatuses', 'externalHostLifecycleAction', 'writeExternalConnectionRuntimeConfig', 'externalConnectorAction']) {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, name); vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), ctx);
  }
  const store = ctx.externalConnectorStore();
  const gateway = load('external-agent-host.cjs').createExternalGateway({ connectors: store });
  server = http.createServer(async (req, res) => { try { let raw = ''; for await (const b of req) raw += b; res.end(JSON.stringify(await gateway(req.headers.authorization?.slice(7), JSON.parse(raw)))); } catch (e) { res.end(JSON.stringify({ ok: false, code: e.code || e.message })); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  await store.action('savePolicy', { preset: 'full', accessMode: 'all_authorized_students', revision: 0, confirmed: true });
  return { ctx, store, root };
}
test('real main actions: first install verifies without students; repeated install reuses credential; uninstall revokes without affecting other host', { skip: process.platform !== 'win32' }, async t => {
  const { ctx, store } = await mainFixture(t);
  for (const hostType of ['codex', 'workbuddy']) {
    const result = await ctx.externalConnectorAction('installHost', { hostType, confirmed: true });
    assert.equal(result.status, 'bridge_verified', result.message);
  }
  const installed = ctx.unifiedKnowledgeRegistrations(), codexId = installed.codex.connectionId;
  const token = fs.readFileSync(path.join(ctx.externalConnectionDirectory(codexId), 'credential'), 'utf8');
  await ctx.externalConnectorAction('installHost', { hostType: 'codex', confirmed: true });
  assert.equal(ctx.unifiedKnowledgeRegistrations().codex.connectionId, codexId);
  assert.equal(store.snapshot().connections.length, 2); assert.equal(store.snapshot().sessions.length, 0);
  await ctx.externalConnectorAction('uninstallInstalled', { hostType: 'codex', confirmed: true });
  assert.throws(() => store.auth(token));
  assert.equal(store.snapshot().connections.find(c => c.connectionId === installed.workbuddy.connectionId).status, 'active');
  assert.equal(ctx.unifiedKnowledgeRegistrations().codex.status, 'uninstalled');
  await ctx.externalConnectorAction('installHost', { hostType: 'codex', confirmed: true });
  assert.notEqual(ctx.unifiedKnowledgeRegistrations().codex.connectionId, codexId);
  assert.throws(() => store.auth(token));
});
test('repair rotates missing credential with restrictions intact; disabled connection does not silently reauthorize', { skip: process.platform !== 'win32' }, async t => {
  const { ctx, store } = await mainFixture(t), input = { hostType: 'codex', confirmed: true };
  await ctx.externalConnectorAction('installHost', input);
  const id = ctx.unifiedKnowledgeRegistrations().codex.connectionId;
  await store.action('connection', { connectionId: id, status: 'active', restrictions: { excludedStudentIds: ['private'], disabledPermissions: ['material:upload'] } });
  fs.unlinkSync(path.join(ctx.externalConnectionDirectory(id), 'credential'));
  await ctx.externalConnectorAction('repairInstalled', input);
  const next = ctx.unifiedKnowledgeRegistrations().codex.connectionId;
  assert.notEqual(next, id); const c = store.snapshot().connections.find(c => c.connectionId === next);
  assert.deepEqual(c.restrictions.excludedStudentIds, ['private']); assert.ok(c.restrictions.disabledPermissions.includes('material:upload'));
  await store.action('connection', { connectionId: next, status: 'disabled' });
  await assert.rejects(ctx.externalConnectorAction('repairInstalled', input), /已停用/);
});
test('uninstall revokes even if config is corrupt; durable tombstone blocks legacy registration', { skip: process.platform !== 'win32' }, async t => {
  const { ctx, store, root } = await mainFixture(t), input = { hostType: 'workbuddy', confirmed: true };
  await ctx.externalConnectorAction('installHost', input);
  fs.writeFileSync(path.join(root, '.workbuddy/mcp.json'), '{broken');
  await assert.rejects(ctx.externalConnectorAction('uninstallInstalled', input), /授权已撤销/);
  assert.equal(store.snapshot().connections[0].status, 'revoked');
  assert.equal(ctx.unifiedKnowledgeRegistrations().workbuddy.status, 'uninstall_pending');
  const source = fs.readFileSync(path.resolve(__dirname, '../electron/main.cjs'), 'utf8');
  assert.match(source, /const codexProjectRegistered = !codexManaged/); assert.match(source, /if \(!unifiedKnowledgeRegistrations\(\)\.workbuddy\)/);
});
test('initialization failure releases lifecycle busy guard so the user can retry', { skip: process.platform !== 'win32' }, async t => {
  const { ctx } = await mainFixture(t), original = ctx.externalConnectorStore;
  ctx.externalConnectorStore = () => { throw Error('SIMULATED_STORE_INIT_FAILURE'); };
  await assert.rejects(ctx.externalConnectorAction('installHost', { hostType: 'codex', confirmed: true }), /SIMULATED_STORE_INIT_FAILURE/);
  ctx.externalConnectorStore = original;
  assert.equal((await ctx.externalConnectorAction('installHost', { hostType: 'codex', confirmed: true })).status, 'bridge_verified');
});

test('pending uninstall refresh reflects manually removed MCP; deletion preserves host tombstone and can reinstall', { skip: process.platform !== 'win32' }, async t => {
  const { ctx, store, root } = await mainFixture(t), input = { hostType: 'codex', confirmed: true };
  await ctx.externalConnectorAction('installHost', input);
  const id = ctx.unifiedKnowledgeRegistrations().codex.connectionId;
  const file = path.join(root, '.codex/config.toml');
  fs.writeFileSync(file, '[mcp_servers.edu-manager-knowledge]\ncommand="foreign"');
  await assert.rejects(ctx.externalConnectorAction('uninstallInstalled', input), /授权已撤销/);
  assert.equal(ctx.externalHostStatuses().codex.configurationStatus, 'configuration_conflict');
  const manual = '# unrelated\n# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:END\n';
  fs.writeFileSync(file, manual);
  assert.equal(ctx.externalHostStatuses().codex.status, 'uninstalled');
  assert.equal(fs.readFileSync(file, 'utf8'), manual);
  await ctx.externalConnectorAction('deleteConnection', { connectionId: id, confirmed: true });
  assert.equal(store.snapshot().connections.length, 0);
  assert.equal(ctx.unifiedKnowledgeRegistrations().codex.status, 'uninstall_pending', 'durable guard still blocks legacy auto registration');
  assert.equal((await ctx.externalConnectorAction('installHost', input)).status, 'bridge_verified');
  assert.notEqual(ctx.unifiedKnowledgeRegistrations().codex.connectionId, id);
});
