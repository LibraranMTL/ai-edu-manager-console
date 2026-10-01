const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepareProjectRecordOperation, applyProjectRecordOperation, recoverProjectRecordOperations } = require('../electron/project-record-lifecycle.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-record-operation-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-record-operation-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const projects = path.join(root, 'projects.json');
  const lineage = path.join(root, 'lineage.json');
  const snapshot = path.join(root, 'Project', '.edu-manager', '项目记录已移除.json');
  fs.writeFileSync(projects, '{"projects":[{"id":"p1"}]}');
  fs.writeFileSync(lineage, '{"dismissed":false}');
  const journal = prepareProjectRecordOperation({ userDataDir: root, operation: 'remove', projectId: 'p1',
    entries: [{ target: snapshot, after: '{"project":{"id":"p1"}}' },
      { target: projects, after: '{"projects":[]}' }, { target: lineage, after: '{"dismissed":true}' }],
    affectedStudentIds: ['s1'] });
  return { root, projects, lineage, snapshot, journal };
}

test('project record operation commits all targets and does not replay committed callback', (t) => {
  const f = fixture(t); let calls = 0;
  const result = applyProjectRecordOperation(f.journal, f.root, (journal) => {
    calls++;
    assert.deepEqual(journal.affectedStudentIds, ['s1']);
  });
  assert.equal(result.committed, true);
  assert.equal(fs.existsSync(f.snapshot), true);
  assert.equal(JSON.parse(fs.readFileSync(f.projects)).projects.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(f.lineage)).dismissed, true);
  assert.deepEqual(recoverProjectRecordOperations(f.root).issues, []);
  assert.equal(calls, 1);
});

test('startup completes project record after process exits between file writes', (t) => {
  const f = fixture(t);
  const script = `const fs = require('node:fs');
    const lifecycle = require(process.argv[1]);
    const first = process.argv[4];
    const originalRename = fs.renameSync;
    fs.renameSync = function(from, to) { originalRename(from, to); if (to === first) process.exit(41); };
    lifecycle.applyProjectRecordOperation(process.argv[2], process.argv[3]);`;
  const child = spawnSync(process.execPath, ['-e', script, require.resolve('../electron/project-record-lifecycle.cjs'),
    f.journal, f.root, f.snapshot], { encoding: 'utf8' });
  assert.equal(child.status, 41, child.stderr);
  assert.equal(fs.existsSync(f.snapshot), true);
  assert.equal(JSON.parse(fs.readFileSync(f.projects)).projects.length, 1);
  let callbacks = 0;
  const result = recoverProjectRecordOperations(f.root, () => { callbacks++; });
  assert.equal(result.ready, true);
  assert.equal(result.recovered.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(f.projects)).projects.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(f.lineage)).dismissed, true);
  assert.equal(callbacks, 1);
  assert.equal(recoverProjectRecordOperations(f.root, () => { callbacks++; }).ready, true);
  assert.equal(callbacks, 1);
});

test('project record recovery fails closed when another target changed', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.lineage, '{"dismissed":"external change"}');
  const result = recoverProjectRecordOperations(f.root);
  assert.equal(result.ready, false);
  assert.match(result.issues[0].message, /其他操作修改/);
  assert.equal(fs.existsSync(f.snapshot), false);
  assert.equal(JSON.parse(fs.readFileSync(f.projects)).projects.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(f.lineage)).dismissed, 'external change');
});
