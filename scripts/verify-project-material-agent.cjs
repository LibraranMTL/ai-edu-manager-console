// Opt-in live acceptance using only generated teaching text. No real project,
// student file, key, model override or formal knowledge is passed to the model.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { createProjectDigestWorkspace } = require('../electron/project-material-digest.cjs');
const { executeMaterialCodex } = require('../electron/project-material-agent.cjs');
const { createProjectKnowledgeCommitter } = require('../electron/project-knowledge-commit.cjs');

async function main() {
  const evidencePath = process.argv[2];
  if (!evidencePath) throw new Error('Provide the sandbox probe evidence file');
  const sandboxEvidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-live-'));
  const workspaceRoot = path.join(root, 'workspace');
  const knowledgeRoot = path.join(root, 'knowledge');
  await fs.mkdir(workspaceRoot); await fs.mkdir(knowledgeRoot);
  const original = path.join(workspaceRoot, 'synthetic-note.txt');
  const text = 'Synthetic teaching experiment: three observations of water temperature were 20, 25 and 30 degrees Celsius. This is made-up validation data. It is not a student contribution record.';
  await fs.writeFile(original, text);
  const store = createProjectMaterialStore({ projectId: 'synthetic-project', managerPath: path.join(root, '.edu-manager'),
    roots: { workspace: { kind: 'workspace', path: workspaceRoot } } });
  const started = Date.now();
  try {
    const material = (await store.registerFiles([{ location: { rootId: 'workspace', kind: 'workspace', relativePath: 'synthetic-note.txt' } }])).result[0];
    const workspace = createProjectDigestWorkspace({ store, knowledgeRoot, allowedDirectories: ['summaries'] });
    const batch = await workspace.prepare({ materialIds: [material.materialId], ruleVersion: 'acceptance-v1', targets: ['summaries/experiment.md'] });
    const receipt = await executeMaterialCodex({ executable: sandboxEvidence.executable, sandboxEvidence, batch,
      projectRules: 'Summarize this synthetic experiment in under 100 words. Explicitly include all three observed temperature values 20, 25 and 30 and label the data synthetic. Do not use external sources. Do not infer a student author.', timeoutMs: 180000 });
    const committer = createProjectKnowledgeCommitter({ store, workspace, knowledgeRoot });
    const result = await committer.commit(batch.batchId, receipt);
    const output = await fs.readFile(path.join(knowledgeRoot, 'summaries/experiment.md'), 'utf8');
    const originalUnchanged = await fs.readFile(original, 'utf8') === text;
    const sourceFactsPresent = ['20', '25', '30'].every((value) => output.includes(value)) && /synthetic|虚构|合成|模拟|假设/i.test(output);
    const passed = result.fullyCommitted && originalUnchanged && sourceFactsPresent && output.length > 0 && output.length < 10000
      && !/^\s*ERROR:/i.test(output);
    console.log(JSON.stringify({ schema: 'edu-manager.project-material-agent-acceptance.v1', measuredAt: new Date().toISOString(),
      passed, fixture: 'synthetic-only', durationMs: Date.now() - started, originalUnchanged, sourceFactsPresent,
      artifactCount: receipt.artifacts.length, processedVersion: (await store.read()).materials[0].processing.processedVersion,
      sandboxExecutableSha256: sandboxEvidence.executableSha256, outputPreview: output.slice(0, 600) }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    const snapshots = path.join(store.directory, 'snapshots');
    for (const file of await fs.readdir(snapshots).catch(() => [])) await fs.chmod(path.join(snapshots, file), 0o600);
    const resolved = await fs.realpath(root);
    if (path.dirname(resolved) !== await fs.realpath(os.tmpdir()) || !path.basename(resolved).startsWith('edu-material-live-')) throw new Error('Unsafe fixture cleanup');
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(JSON.stringify({ passed: false, code: error.code, message: error.message, details: error.details })); process.exitCode = 1; });
