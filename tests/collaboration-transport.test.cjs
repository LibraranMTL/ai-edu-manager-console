const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  COLLABORATION_TRANSPORT_SCHEMA,
  SYNCTHING_COMPAT_TRANSPORT_ID,
  assertCollaborationTransport,
  createCollaborationTransport,
} = require('../electron/collaboration-transport.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'edu-collaboration-transport-'));
}

test('collaboration transport contract rejects incomplete adapters', () => {
  assert.throws(
    () => assertCollaborationTransport({ id: 'broken', describe() {} }),
    /缺少 ensureNode/,
  );
});

test('syncthing compatibility adapter exposes the current exchange behavior behind one interface', () => {
  const root = tempDir();
  const sourceFile = path.join(root, 'course.txt');
  const ledgerPath = path.join(root, 'receiver-ledger.json');
  fs.writeFileSync(sourceFile, 'knowledge collaboration', 'utf8');

  const transport = createCollaborationTransport({
    transportId: SYNCTHING_COMPAT_TRANSPORT_ID,
    rootPath: path.join(root, 'exchange'),
  });
  const descriptor = transport.describe({ nodeId: 'node-a' });
  assert.equal(descriptor.schema, COLLABORATION_TRANSPORT_SCHEMA);
  assert.equal(descriptor.id, SYNCTHING_COMPAT_TRANSPORT_ID);
  assert.equal(descriptor.defaultTransport, false);
  assert.equal(descriptor.externalSyncRequired, true);

  const sent = transport.sendPackage({
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    files: [{
      sourcePath: sourceFile,
      relativePath: 'tasks/course.txt',
      objectId: 'course-1',
      objectType: 'task_attachment',
      studentId: 'student-1',
    }],
  });
  assert.equal(sent.manifest.targetNodeId, 'node-b');
  assert.equal(transport.discoverPackages('node-b').length, 1);

  const received = transport.receivePackages({
    targetNodeId: 'node-b',
    ledgerPath,
  });
  assert.equal(received.packageCount, 1);
  assert.equal(received.importedCount, 1);
  const repeated = transport.receivePackages({ targetNodeId: 'node-b', ledgerPath });
  assert.equal(repeated.packageCount, 0);
  assert.equal(repeated.duplicateCount, 0);

  fs.rmSync(root, { recursive: true, force: true });
});

test('unknown collaboration transports are rejected until a later phase registers them', () => {
  assert.throws(
    () => createCollaborationTransport({ transportId: 'lan_direct', rootPath: 'unused' }),
    /尚不支持知识协作传输适配器/,
  );
});
