const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '../src/main.tsx'), 'utf8');
function bind(scope, name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  scope[name] = Function('scope', `with (scope) { return (${main.slice(start, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

test('raw-folder shortcut opens the canonical project raw library, distinct from workspace', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-open-space-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-open-space-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic project', status: 'active',
    materialStorageMode: 'workspace-v1', workspacePath: path.join(root, 'workspace'),
    rawPath: path.join(root, 'legacy-raw'), projectRootPath: root,
    knowledgeRootPath: path.join(root, 'knowledge') };
  const opened = [];
  const scope = { fs, path, readProjects: () => [project], ensureProjectWorkspace: (value) => value,
    normalizeProject: (value) => value,
    isWorkspaceMaterialProject: (value) => value.materialStorageMode === 'workspace-v1',
    shell: { openPath: async (file) => { opened.push(file); } },
    mutableProject: () => ({ project }),
    dialog: { showOpenDialogSync: () => { throw new Error('new-mode raw rebind must not open dialog'); } } };
  bind(scope, 'openProjectSpace');
  bind(scope, 'rebindProjectDirectory');
  const result = JSON.parse(scope.openProjectSpace(project.id, 'raw'));
  assert.equal(result.ok, true);
  assert.equal(result.path, project.rawPath);
  assert.deepEqual(opened, [project.rawPath]);
  assert.equal(fs.existsSync(project.rawPath), true);
  const rejected = JSON.parse(scope.rebindProjectDirectory(project.id, 'raw'));
  assert.equal(rejected.code, 'workspace_material_mode');
  assert.match(renderer, /title="项目原始资料库" value=\{selectedProject\.rawPath\}/);
  assert.match(renderer, /selectedProject\.materialStorageMode !== 'workspace-v1' && <button[^\n]+rebindSelectedProjectDirectory\('raw'\)/);
  project.materialStorageMode = 'legacy';
  const old = JSON.parse(scope.openProjectSpace(project.id, 'raw'));
  assert.equal(old.path, project.rawPath);
});
