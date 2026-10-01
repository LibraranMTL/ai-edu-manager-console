const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const extract = name => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\nfunction ', source.indexOf(`function ${name}(`) + 1));
function readers(files = {}) {
  const context = vm.createContext({
    fs: { readFileSync(file) {
      if (!(file in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return files[file];
    } },
    studentMaterialsPath: s => `${s.id}/materials`,
    studentDigestStatePath: s => `${s.id}/digest`,
    normalizeUploadStatus: value => value === 'pending' ? 'pending_digest' : value,
    ensureStudentManagerFiles: () => { throw new Error('read attempted initialization'); },
  });
  vm.runInContext(`${extract('readStudentMaterials')}\n${extract('readStudentDigestState')}`, context);
  return context;
}

test('status reads use the requested student and never initialize or write files', () => {
  const context = readers({
    'a/materials': JSON.stringify({ materials: [{ id: 'one', status: 'pending' }] }),
    'a/digest': JSON.stringify({ status: 'completed', processedCount: 9 }),
    'b/materials': JSON.stringify({ materials: [{ id: 'other', status: 'processed' }] }),
  });
  for (let i = 0; i < 30; i++) {
    assert.equal(context.readStudentMaterials({ id: 'a' })[0].status, 'pending_digest');
    assert.equal(context.readStudentDigestState({ id: 'a' }).processedCount, 9);
  }
  assert.equal(context.readStudentMaterials({ id: 'b' })[0].id, 'other');
});

test('missing state keeps idle defaults in memory without creating a workspace', () => {
  const context = readers();
  assert.equal(context.readStudentMaterials({ id: 'missing' }).length, 0);
  const state = context.readStudentDigestState({ id: 'missing' });
  assert.equal(state.studentId, 'missing'); assert.equal(state.status, 'idle');
  assert.equal(state.pendingCount, 0);
});

test('malformed state remains safely unreadable and is not overwritten', () => {
  const context = readers({ 'a/materials': 'bad', 'a/digest': 'bad' });
  assert.equal(context.readStudentMaterials({ id: 'a' }).length, 0);
  assert.equal(Object.keys(context.readStudentDigestState({ id: 'a' })).length, 0);
});

test('workspace creation and adoption retain explicit initialization', () => {
  assert.match(extract('initStudentWorkspace'), /ensureStudentManagerFiles\(pseudoStudent\)/);
  // Two explicit callers remain, in addition to the function declaration.
  assert.equal((source.match(/ensureStudentManagerFiles\(/g) || []).length, 3);
});
