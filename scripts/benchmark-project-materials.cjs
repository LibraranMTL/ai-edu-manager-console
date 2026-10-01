// Synthetic data only. This script never reads or mutates a user project.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { collectWorkspaceFiles } = require('../electron/project-workspace.cjs');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { registerProjectWorkspaceScan } = require('../electron/project-workspace-register.cjs');
const { readProjectMaterialIndexSync } = require('../electron/project-material-host.cjs');

async function measured(operation) {
  const started = performance.now();
  const result = await operation();
  return { durationMs: Number((performance.now() - started).toFixed(2)), result };
}

async function main() {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-project-material-benchmark-'));
  const root = await fs.realpath(fixture);
  const results = [];
  try {
    for (const count of [1000, 5000]) {
      const dir = path.join(root, String(count));
      await fs.mkdir(dir);
      for (let start = 0; start < count; start += 100) {
        await Promise.all(Array.from({ length: Math.min(100, count - start) }, (_, index) =>
          fs.writeFile(path.join(dir, `sample-${start + index}.txt`), `Synthetic fixture ${start + index}\n`.repeat(16))));
      }
      const scans = [];
      let files = [];
      for (let pass = 0; pass < 2; pass++) {
        const started = performance.now();
        const result = await collectWorkspaceFiles(dir, { limit: count + 1 });
        files = result.files;
        scans.push({ pass, durationMs: Number((performance.now() - started).toFixed(2)),
          fileCount: result.files.length, limitReached: result.limitReached });
        if (result.files.length !== count || result.limitReached) throw new Error('Baseline scan coverage mismatch');
      }
      const project = { id: `benchmark-${count}`, workspacePath: dir,
        managerPath: path.join(root, `manager-${count}`), inboxRelativePath: '收件箱' };
      const store = createProjectMaterialStore({ projectId: project.id, managerPath: project.managerPath,
        roots: { workspace: { kind: 'workspace', path: dir } } });
      const registration = await measured(async () => {
        let added = 0;
        for (let offset = 0; offset < files.length; offset += 1000) {
          const batch = files.slice(offset, offset + 1000).map((file) => ({
            location: { kind: 'workspace', rootId: 'workspace', relativePath: file.relativePath },
          }));
          const written = await store.registerFiles(batch, { intent: 'later' });
          added += written.result.length;
        }
        return added;
      });
      if (registration.result !== count) throw new Error('Registry coverage mismatch');
      const registryBytes = (await fs.stat(store.indexPath)).size;
      const listCold = await measured(() => createProjectMaterialStore({ projectId: project.id,
        managerPath: project.managerPath, roots: { workspace: { kind: 'workspace', path: dir } },
      }).list({ offset: 0, limit: 50 }));
      const listWarm = await measured(() => store.list({ offset: 50, limit: 50 }));
      const syncRead = await measured(() => readProjectMaterialIndexSync(project));
      const unchanged = await measured(() => registerProjectWorkspaceScan(project, files, store));
      const scanProject = { ...project, managerPath: path.join(root, `manager-scan-${count}`) };
      const scanStore = createProjectMaterialStore({ projectId: scanProject.id,
        managerPath: scanProject.managerPath, roots: { workspace: { kind: 'workspace', path: dir } } });
      const scanRegistration = await measured(() => registerProjectWorkspaceScan(scanProject, files, scanStore));
      if (listCold.result.total !== count || listWarm.result.total !== count
        || syncRead.result.materials.length !== count || unchanged.result.registered !== 0
        || scanRegistration.result.registered !== count) {
        throw new Error('Registry query or unchanged rescan mismatch');
      }
      results.push({ count, scans, registry: { bytes: registryBytes,
        registrationMs: registration.durationMs, listColdMs: listCold.durationMs,
        listWarmMs: listWarm.durationMs, syncReadMs: syncRead.durationMs,
        unchangedRescanMs: unchanged.durationMs,
        workspaceFirstRegistrationMs: scanRegistration.durationMs } });
    }
    console.log(JSON.stringify({ schema: 'edu-manager.project-material-benchmark.v2',
      measuredAt: new Date().toISOString(), node: process.version, platform: process.platform,
      arch: process.arch, cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem(),
      fixtureLocation: root, cache: 'OS cache uncontrolled; first pass after fixture creation is not a cold-disk claim',
      scanner: 'collectWorkspaceFiles', registry: 'project-materials/registry.json', results }, null, 2));
  } finally {
    // Deletion is limited to this invocation's mkdtemp result, never a project.
    const tempRoot = await fs.realpath(os.tmpdir());
    if (path.dirname(root) !== tempRoot || !path.basename(root).startsWith('edu-project-material-benchmark-')) {
      throw new Error('Refusing cleanup outside the generated benchmark fixture');
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
