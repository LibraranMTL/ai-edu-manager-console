// Opt-in real executor acceptance. All documents and rules are synthetic.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { createProjectMaterialTask } = require('../electron/project-material-task.cjs');

async function main() {
  const executable = process.argv[2];
  if (!path.isAbsolute(executable || '')) throw new Error('Provide the native executor absolute path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-task-live-'));
  const project = { id: 'synthetic-task-project', name: 'Synthetic Task Acceptance', materialStorageMode: 'workspace-v1',
    projectRootPath: root, workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'legacy'),
    knowledgeRootPath: path.join(root, 'knowledge'), managerPath: path.join(root, '.edu-manager'), agentPath: path.join(root, 'AGENT.md') };
  const { store } = createProjectMaterialHost(project);
  const text = 'Synthetic teaching experiment. Water temperatures: 20, 25, 30 degrees Celsius. All measurements are made up for software testing. No person or student contribution is evidenced.';
  const checkpoints = [];
  const started = Date.now();
  try {
    for (const dir of [project.workspacePath, project.rawPath, project.knowledgeRootPath]) await fs.mkdir(dir);
    await fs.writeFile(project.agentPath, 'Use concise English. Explicitly label synthetic data. Preserve all three observed values in the summary. No evidence for people or student contribution: say insufficient evidence. Do not invent questions or entities. Each knowledge category must distinguish supported facts from missing evidence.');
    const original = path.join(project.workspacePath, 'synthetic-note.txt');
    await fs.writeFile(original, text);
    await store.registerFiles([{ location: { kind: 'workspace', rootId: 'workspace', relativePath: 'synthetic-note.txt' } }]);
    const result = await createProjectMaterialTask({ project, executionId: 'synthetic-acceptance', executable,
      authorize: async () => true, onCheckpoint: async (value) => { checkpoints.push(value.phase); } }).run();
    const index = await store.read();
    const summary = index.knowledge.find((item) => item.relativePath.startsWith('摘要库/'));
    const content = summary ? await fs.readFile(path.join(project.knowledgeRootPath, summary.relativePath), 'utf8') : '';
    const sourceFactsPresent = ['20', '25', '30'].every((value) => content.includes(value)) && /synthetic|made.up|虚构|合成/i.test(content);
    const unchanged = await fs.readFile(original, 'utf8') === text;
    const passed = result.fullyCommitted && result.remainingCount === 0 && unchanged && sourceFactsPresent
      && index.knowledge.length === 5 && index.materials[0].processing.processedVersion === 1;
    console.log(JSON.stringify({ schema: 'edu-manager.project-material-task-acceptance.v1', passed,
      measuredAt: new Date().toISOString(), fixture: 'synthetic-only', durationMs: Date.now() - started,
      originalUnchanged: unchanged, sourceFactsPresent, knowledgeCount: index.knowledge.length,
      checkpoints, summaryPreview: content.slice(0, 700) }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    for (const file of await fs.readdir(path.join(store.directory, 'snapshots')).catch(() => [])) await fs.chmod(path.join(store.directory, 'snapshots', file), 0o600);
    const resolved = await fs.realpath(root);
    if (path.dirname(resolved) !== await fs.realpath(os.tmpdir()) || !path.basename(resolved).startsWith('edu-task-live-')) throw new Error('Unsafe synthetic cleanup');
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(JSON.stringify({ passed: false, code: error.code, message: error.message })); process.exitCode = 1; });
