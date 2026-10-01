const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const main = fsSync.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  scope[name] = Function('scope', `with (scope) { return (${main.slice(start, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

test('legacy collaboration repair cannot remove registered originals in workspace-v1 projects', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-publication-repair-guard-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-publication-repair-guard-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const rawPath = path.join(root, 'old-raw');
  const knowledgePath = path.join(root, 'knowledge');
  await fs.mkdir(rawPath);
  await fs.mkdir(knowledgePath);
  const bytes = 'A file that must remain as a registered source.';
  const original = path.join(rawPath, 'source.md');
  const derived = path.join(knowledgePath, 'source.md');
  await fs.writeFile(original, bytes);
  await fs.writeFile(derived, bytes);
  const project = { id: 'project-1', materialStorageMode: 'workspace-v1',
    rawPath, knowledgeRootPath: knowledgePath, managerPath: path.join(root, 'manager') };
  const publication = { publicationId: 'publication-1', project: { digestBaseline: [
    { relativePath: 'source.md', sha1: crypto.createHash('sha1').update(bytes).digest('hex') },
  ] }, entries: [{ kind: 'knowledge_snapshot', knowledgeKind: 'summary',
    relativePath: 'source.md', sha256: crypto.createHash('sha256').update(bytes).digest('hex') }] };
  const scope = { isWorkspaceMaterialProject: (item) => item.materialStorageMode === 'workspace-v1' };
  for (const name of ['repairMisplacedProjectKnowledge', 'repairCompletedProjectPublication',
    'reconcileVerifiedKnowledgeDuplicatesInRaw', 'restoreProjectPublicationDigestBaseline']) bind(scope, name);
  assert.equal(scope.repairMisplacedProjectKnowledge(project, publication,
    publication.entries[0], derived), 0);
  assert.deepEqual(scope.repairCompletedProjectPublication(project, publication),
    { repairedMisplacedKnowledge: 0, digestBaselineRestored: 0 });
  assert.equal(scope.reconcileVerifiedKnowledgeDuplicatesInRaw(project, publication), 0);
  assert.equal(scope.restoreProjectPublicationDigestBaseline(project, publication), 0);
  assert.equal(await fs.readFile(original, 'utf8'), bytes);
  assert.equal(fsSync.existsSync(path.join(project.managerPath, 'collaboration-repair-backup')), false);
});
