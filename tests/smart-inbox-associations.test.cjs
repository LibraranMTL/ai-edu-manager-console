const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createProjectMaterialHost, projectMaterialDigestProjection } = require('../electron/project-material-host.cjs');
const { hashStableFile } = require('../electron/project-materials.cjs');
const { createIntakeAssociations } = require('../electron/smart-inbox-associations.cjs');

async function fixture(t, { preexisting = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intake-associations-'));
  const projects = ['project-a', 'project-b'].map(id => ({ id, name: id, studentIds: ['student-a'], materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, id, 'workspace'), rawPath: path.join(root, id, 'raw'), managerPath: path.join(root, id, 'manager') }));
  const hosts = new Map(projects.map(p => [p.id, createProjectMaterialHost(p)]));
  const item = { id: 'intake-item', sourceId: 'source', operationId: 'first', target: { studentId: 'student-a', type: 'project', id: projects[0].id }, fingerprint: null };
  const receipts = [];
  for (const p of projects) {
    const file = path.join(p.workspacePath, '收件箱', 'synthetic.txt'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, '合成资料');
    item.fingerprint = await hashStableFile(file);
    const registered = await hosts.get(p.id).registerTerminalUpload(file, { eventId: p.id, studentId: 'student-a', sourceType: 'host_material_source',
      intakeAssociation: preexisting && p.id === 'project-a' ? null : { itemId: item.id, operationId: p.id } });
    receipts.push({ ok: true, recordId: registered.material.materialId, path: file });
  }
  let allowed = true; const projections = [];
  const h = { student: id => id === 'student-a' ? { id } : null, projects: () => projects, isWorkspace: () => true, materialHost: p => hosts.get(p.id),
    canWrite: () => allowed, externalReferences: () => [], projectAssociationChanged: async (p, result) => projections.push(result) };
  const service = createIntakeAssociations(h);
  item.receipt = receipts[0]; await service.bind(item);
  const previous = { target: { ...item.target }, receipt: item.receipt };
  item.target = { ...item.target, id: 'project-b' }; item.operationId = 'correction'; item.receipt = receipts[1];
  await service.bind(item);
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  return { root, projects, hosts, item, previous, service, h, projections, revoke: () => { allowed = false; } };
}

test('unreferenced intake-owned association withdraws only after new receipt; bytes and snapshots remain', async t => {
  const f = await fixture(t), store = f.hosts.get('project-a').store;
  const result = await f.service.withdraw(f.item, f.previous); assert.equal(result.status, 'withdrawn');
  const index = await store.read(); assert.equal(index.materials[0].adoption.state, 'excluded');
  assert.equal(index.intakeAssociations[0].active, false); assert.equal(projectMaterialDigestProjection(f.projects[0], index).pendingCount, 0);
  await fs.access(f.previous.receipt.path); await fs.access((await store.resolve(f.previous.receipt.recordId, 1)).path);
  assert.deepEqual(await f.service.withdraw(f.item, f.previous), result); assert.equal((await store.read()).intakeReroutes.length, 1);
});

for (const [label, mutate, reason] of [
  ['knowledge', (i,m) => { m.links.knowledge = [{ knowledgeId: 'k', version: 1 }]; }, 'linked_evidence'],
  ['evidence', (i,m) => { i.evidenceBindings = [{ materials: [{ materialId: m.materialId, version: 1 }] }]; }, 'evidence_binding'],
  ['report/promotion pin', (i,m) => { m.versions[0].pins = ['promotion:fixed']; }, 'pinned_version'],
  ['in-flight digest', (i,m) => { m.processing.state = 'running'; }, 'processing_or_processed'],
  ['other source', (i,m) => { m.sources.push({ eventId: 'independent', studentId: 'student-a', type: 'host_manual_import' }); }, 'other_source'],
  ['human edit', (i,m) => { m.recordRevision++; m.classification.manualLocked = true; }, 'subsequent_manual_or_external_change'],
]) test(`referenced material is retained and annotated: ${label}`, async t => {
  const f = await fixture(t), store = f.hosts.get('project-a').store;
  await store.mutate(index => mutate(index, index.materials[0]));
  const result = await f.service.withdraw(f.item, f.previous); assert.equal(result.status, 'retained'); assert.ok(result.reasons.includes(reason));
  const index = await store.read(); assert.equal(index.materials[0].adoption.state, 'accepted'); assert.equal(index.intakeAssociations[0].active, false);
  assert.equal(index.materials[0].intakeReroute.newRecordId, f.item.receipt.recordId); await fs.access(f.previous.receipt.path);
});

test('duplicate preexisting material cannot be claimed by intake or withdrawn', async t => {
  const f = await fixture(t, { preexisting: true }); const result = await f.service.withdraw(f.item, f.previous);
  assert.ok(result.reasons.includes('preexisting_or_unknown_ownership')); assert.equal(result.retained, true);
});

test('failed or forged destination, revoked permission and another student cannot withdraw old association', async t => {
  const f = await fixture(t), store = f.hosts.get('project-a').store;
  await assert.rejects(f.service.withdraw({ ...f.item, receipt: { ...f.item.receipt, ok: false } }, f.previous));
  await assert.rejects(f.service.withdraw({ ...f.item, receipt: { ...f.item.receipt, recordId: 'forged' } }, f.previous));
  await assert.rejects(f.service.withdraw(f.item, { ...f.previous, target: { ...f.previous.target, studentId: 'student-b' } }));
  f.revoke(); await assert.rejects(f.service.withdraw(f.item, f.previous));
  assert.equal((await store.read()).materials[0].adoption.state, 'accepted');
});

test('projection failure after commit is recoverable without duplicate withdrawal', async t => {
  const f = await fixture(t); let first = true;
  f.h.projectAssociationChanged = async () => { if (first) { first = false; throw Error('projection interrupted'); } };
  await assert.rejects(f.service.withdraw(f.item, f.previous), /interrupted/);
  const result = await f.service.withdraw(f.item, f.previous); assert.equal(result.status, 'withdrawn');
  assert.equal((await f.hosts.get('project-a').store.read()).intakeReroutes.length, 1);
});

test('returning to a withdrawn intake-owned project reopens the same record, not a second copy', async t => {
  const f = await fixture(t); await f.service.withdraw(f.item, f.previous);
  const returning = { ...f.item, target: f.previous.target, receipt: f.previous.receipt, operationId: 'returning' };
  await f.service.prepare(returning); await f.service.bind(returning);
  const index = await f.hosts.get('project-a').store.read(); assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].adoption.state, 'accepted'); assert.equal(index.intakeAssociations[0].active, true);
});

test('restoring target compatibility failure is replayable and cannot withdraw the old project early', async t => {
  const f = await fixture(t); await f.service.withdraw(f.item, f.previous);
  const returning = { ...f.item, target: f.previous.target, receipt: f.previous.receipt, operationId: 'returning' };
  await f.service.prepare(returning); let attempts = 0;
  f.h.projectAssociationRestored = async () => { if (++attempts === 1) throw Error('asset projection failed'); };
  await assert.rejects(f.service.bind(returning), /asset projection failed/);
  assert.equal((await f.hosts.get('project-b').store.read()).materials[0].adoption.state, 'accepted');
  assert.equal((await f.hosts.get('project-a').store.read()).intakeAssociations[0].active, false);
  await f.service.bind(returning); await f.service.bind(returning);
  assert.equal(attempts, 3); assert.equal((await f.hosts.get('project-a').store.read()).intakeAssociations.length, 1);
});

test('a second active intake association and late external reference both preserve old adoption', async t => {
  const f = await fixture(t), store = f.hosts.get('project-a').store;
  await f.service.bind({ ...f.item, id: 'other-intake', target: f.previous.target, receipt: f.previous.receipt });
  f.h.externalReferences = () => ['late_report_reference'];
  const result = await f.service.withdraw(f.item, f.previous);
  assert.ok(result.reasons.includes('other_active_intake')); assert.ok(result.reasons.includes('late_report_reference'));
  assert.equal((await store.read()).materials[0].adoption.state, 'accepted');
});
