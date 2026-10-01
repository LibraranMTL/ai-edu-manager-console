const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { grantProjectAssetRoot, readProjectExternalRoots } = require('../electron/project-external-roots.cjs');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');

test('a reused external asset grant survives restart and loses resolution when owner leaves the project', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-external-asset-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-external-asset-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic', materialStorageMode: 'workspace-v1',
    studentIds: ['student-1'], managerPath: path.join(root, '.edu-manager'),
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'legacy') };
  const source = path.join(root, 'external', 'source.txt');
  await fs.mkdir(path.dirname(source));
  await fs.mkdir(project.workspacePath);
  await fs.mkdir(project.rawPath);
  await fs.writeFile(source, 'reused bytes');
  const asset = { assetId: 'asset-1', path: source, ownerStudentId: 'student-1' };
  const location = await grantProjectAssetRoot(project, asset);
  assert.equal(location.kind, 'external');
  assert.deepEqual(await grantProjectAssetRoot(project, asset), location);
  assert.equal(readProjectExternalRoots(project).length, 1);
  const first = createProjectMaterialHost(project);
  const material = (await first.store.registerFiles([{ location, source: {
    eventId: 'reuse-1', type: 'asset_reuse', studentId: 'student-1', deviceId: 'local-host',
  } }], { intent: 'active' })).result[0];
  assert.equal((await createProjectMaterialHost(project).store.resolve(material.materialId)).path, source);
  await assert.rejects(createProjectMaterialHost({ ...project, studentIds: [] }).store.resolve(material.materialId),
    { code: 'unknown_root' });
  const file = path.join(project.managerPath, 'project-materials', 'external-roots.json');
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({ ...data, projectId: 'other-project' }));
  assert.throws(() => createProjectMaterialHost(project), { code: 'external_grants_corrupt' });
});
