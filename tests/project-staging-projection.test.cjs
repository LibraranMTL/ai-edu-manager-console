const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { projectStagingProjection } = require('../electron/project-staging-projection.cjs');

test('research staging is a registry state view and does not duplicate a legacy scanner row', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-staging-view-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-staging-view-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const workspacePath = path.join(root, 'workspace');
  const rawPath = path.join(root, 'raw');
  const managerPath = path.join(root, 'manager');
  await fs.mkdir(path.join(workspacePath, '收件箱'), { recursive: true });
  await fs.mkdir(rawPath);
  const candidatePath = path.join(workspacePath, '收件箱', 'candidate.txt');
  const acceptedPath = path.join(workspacePath, '收件箱', 'accepted.txt');
  await fs.writeFile(candidatePath, 'candidate');
  await fs.writeFile(acceptedPath, 'accepted');
  const store = createProjectMaterialStore({ projectId: 'p1', managerPath,
    roots: { workspace: { path: workspacePath, kind: 'workspace' } } });
  const location = (name, type) => ({ location: { kind: 'workspace', rootId: 'workspace',
    relativePath: `收件箱/${name}` }, source: { eventId: name, type } });
  const candidate = (await store.registerFiles([location('candidate.txt', 'staging_import')],
    { intent: 'later' })).result[0];
  await store.registerFiles([location('accepted.txt', 'direct_import')], { intent: 'active' });
  const project = { id: 'p1', workspacePath, rawPath };
  const legacyItems = [{ id: 'old-scanner-id', path: candidatePath, sourcePath: candidatePath },
    { id: 'unregistered', path: path.join(workspacePath, 'old.txt') }];
  let view = projectStagingProjection(project, await store.read(), legacyItems);
  assert.deepEqual(view.map((item) => item.id), [candidate.materialId, 'unregistered']);
  assert.equal(view[0].status, 'collected');
  const adopted = await store.decideAdoption([{ materialId: candidate.materialId,
    expectedVersion: candidate.version, expectedRecordRevision: candidate.recordRevision,
    state: 'accepted' }], { actorId: 'local-user' });
  assert.equal(adopted.result[0].ok, true);
  view = projectStagingProjection(project, await store.read(), legacyItems);
  assert.equal(view[0].status, 'promoted');
  assert.equal(view[0].path, candidatePath);
  assert.equal(await fs.readFile(candidatePath, 'utf8'), 'candidate');
  assert.deepEqual((await fs.readdir(path.dirname(candidatePath))).sort(), ['accepted.txt', 'candidate.txt']);
});
