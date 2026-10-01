const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { projectStagingProjection } = require('../electron/project-staging-projection.cjs');
const { registerLegacyStagingFiles } = require('../electron/project-legacy-staging-register.cjs');

async function fixture(t, linked = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-legacy-stage-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-legacy-stage-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'p1', name: 'Synthetic', materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'raw'),
    managerPath: path.join(root, 'manager'), stagingPath: linked
      ? path.join(root, '旧项目研究暂存') : path.join(root, 'workspace', '研究暂存') };
  await fs.mkdir(project.workspacePath, { recursive: true });
  await fs.mkdir(project.rawPath);
  await fs.mkdir(project.stagingPath, { recursive: true });
  return { root, project };
}

for (const linked of [false, true]) {
  test(`old research staging originals are registered in place as candidates (${linked ? 'outside workspace' : 'inside workspace'})`, async (t) => {
    const { project } = await fixture(t, linked);
    const original = path.join(project.stagingPath, 'research.txt');
    await fs.writeFile(original, 'legacy original');
    await fs.writeFile(path.join(project.stagingPath, 'staging-index.json'), '{}');
    await fs.writeFile(path.join(project.stagingPath, '研究暂存清单.md'), '# generated');
    const stat = await fs.stat(original);
    const host = createProjectMaterialHost(project);
    const files = [
      { path: original, filename: 'research.txt', size: stat.size, mtimeMs: stat.mtimeMs },
      { path: path.join(project.stagingPath, 'staging-index.json'), filename: 'staging-index.json' },
      { path: path.join(project.stagingPath, '研究暂存清单.md'), filename: '研究暂存清单.md' },
    ];
    const first = await registerLegacyStagingFiles(project, files, host.store);
    assert.equal(first.added, 1);
    assert.equal(first.generated, 2);
    const index = await host.store.read();
    const material = index.materials[0];
    assert.equal(material.adoption.state, 'candidate');
    assert.equal(material.sources[0].type, 'legacy_staging');
    assert.equal(material.location.kind, linked ? 'external' : 'workspace');
    assert.equal((await host.store.resolve(material.materialId)).path, original);
    assert.deepEqual((await fs.readdir(project.rawPath)), []);
    const projected = projectStagingProjection(project, index, [{ id: 'old-id', path: original }]);
    assert.deepEqual(projected.map((item) => item.id), [material.materialId]);
    const second = await registerLegacyStagingFiles(project, files, host.store);
    assert.equal(second.registered, 0);
    assert.equal((await host.store.read()).revision, index.revision);
  });
}
