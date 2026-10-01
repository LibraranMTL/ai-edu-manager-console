const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMigrationPackage, restoreMigrationPackage, walkFiles } = require('../electron/host-migration.cjs');
const { dataGenerationPath, readHostDataGeneration } = require('../electron/host-data-generation.cjs');
const mainSource = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');

function bind(scope, name) {
  const start = mainSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const code = mainSource.slice(start, mainSource.indexOf('\n}', start) + 2);
  scope[name] = Function('scope', `with (scope) { return (${code}); }`)(scope);
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-host-generation-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-host-generation-'));
    for (const file of walkFiles(root)) fs.chmodSync(file.absolutePath, 0o600);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const managedRoot = path.join(root, 'source');
  const packages = path.join(root, 'packages');
  const userDataDir = path.join(root, 'current-userdata');
  for (const dir of [managedRoot, packages, userDataDir]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(managedRoot, 'synthetic.txt'), 'source data');
  return { root, managedRoot, packages, userDataDir };
}

async function packageFor(f) {
  return createMigrationPackage({ destinationParent: f.packages, managedRoot: f.managedRoot,
    userDataRoot: path.join(f.root, 'source-userdata'), appVersion: '0.18.4',
    sources: [{ kind: 'managed', id: 'managed-root', rootPath: f.managedRoot }],
    virtualFiles: [{ kind: 'state', relativePath: 'settings.json', content: JSON.stringify({ studentBaseDir: f.managedRoot }) }] });
}

test('ordinary restart retains host data generation and malformed state fails closed', (t) => {
  const f = fixture(t);
  const first = readHostDataGeneration(f.userDataDir);
  assert.equal(readHostDataGeneration(f.userDataDir).id, first.id);
  fs.writeFileSync(dataGenerationPath(f.userDataDir), '{"schema":"bad"}');
  assert.throws(() => readHostDataGeneration(f.userDataDir), /损坏/);
});

test('successful restore changes generation while preserving the local identity of the host', async (t) => {
  const f = fixture(t);
  const before = readHostDataGeneration(f.userDataDir);
  const hostIdentity = path.join(f.userDataDir, 'host-identity.json');
  fs.writeFileSync(hostIdentity, JSON.stringify({ hostId: 'local-host-id' }));
  const created = await packageFor(f);
  const restored = await restoreMigrationPackage({ packageRoot: created.packagePath,
    targetRoot: path.join(f.root, 'restored'), userDataDir: f.userDataDir });
  const after = readHostDataGeneration(f.userDataDir);
  assert.notEqual(after.id, before.id);
  assert.equal(after.reason, 'migration_restore');
  assert.equal(after.migrationId, restored.migrationId);
  assert.equal(JSON.parse(fs.readFileSync(hostIdentity)).hostId, 'local-host-id');
  assert.equal(readHostDataGeneration(f.userDataDir).id, after.id);
});

test('failed restore rolls back generation together with other host state', async (t) => {
  const f = fixture(t);
  const before = readHostDataGeneration(f.userDataDir);
  const created = await packageFor(f);
  await assert.rejects(restoreMigrationPackage({ packageRoot: created.packagePath,
    targetRoot: path.join(f.root, 'restored'), userDataDir: f.userDataDir,
    onProgress: (progress) => {
      if (progress.phase === 'installing-state' && progress.current === 'host-data-generation.json') throw new Error('synthetic install failure');
    } }), /synthetic install failure/);
  assert.equal(readHostDataGeneration(f.userDataDir).id, before.id);
});

test('host health exposes identity and generation, and old-generation upload is rejected before reading bytes', () => {
  const replies = [];
  let resumed = false;
  const scope = { sendJson: (_response, status, body) => replies.push({ status, body }),
    hostDataGenerationId: () => 'generation-new', getHostIdentity: () => ({ hostId: 'host-1' }),
    readCollaborationState: () => ({ node: { nodeId: 'collaboration-1' } }),
    APP_VERSION: 'synthetic', os: { hostname: () => 'synthetic-host' }, getHostServicePort: () => 12345,
    DIRECT_PROTOCOL_VERSION: 1, publicLicenseStatus: () => ({ active: true }),
    projectUploadRecoveryIssues: [] };
  bind(scope, 'handleHealth');
  bind(scope, 'requireMatchingUploadGeneration');
  scope.handleHealth({}, {});
  assert.equal(replies.pop().body.dataGeneration, 'generation-new');
  const request = { headers: { 'x-edu-data-generation': 'generation-old' }, resume: () => { resumed = true; } };
  assert.equal(scope.requireMatchingUploadGeneration(request, {}), false);
  assert.equal(resumed, true);
  assert.equal(replies.pop().body.code, 'host_data_generation_changed');
  request.headers['x-edu-data-generation'] = 'generation-new';
  assert.equal(scope.requireMatchingUploadGeneration(request, {}), true);
  assert.equal(replies.length, 0);
});
