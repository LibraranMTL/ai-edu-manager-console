const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(path.join(__dirname, '../src/main.tsx'), 'utf8');
function handler(name) {
  const start = source.indexOf(`  const ${name} = `);
  assert.ok(start > 0, name);
  const end = source.indexOf('\n  const ', start + 1);
  return source.slice(start, end);
}
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function ui(api) {
  const state = {};
  const props = { selectedProjectId: 'p1', projectPageMode: 'detail', projectKnowledgeCategory: 'all',
    projectKnowledgeRequest: { current: 0 }, projectKnowledgeScope: { current: 'p1:detail:all' },
    projectKnowledgeExportBusy: false, currentProjectKnowledgeRead: null, bridge: () => api };
  for (const key of ['SelectedProjectKnowledgeFileId', 'ProjectKnowledgeContent', 'ProjectKnowledgeRead', 'ProjectKnowledgeExportBusy', 'ProjectKnowledgeBrowserMessage']) {
    props[`set${key}`] = (value) => { state[key] = value; };
  }
  const context = vm.createContext(props);
  const code = stripTypeScriptTypes(`${handler('openProjectKnowledgeDocument')}\n${handler('exportProjectKnowledgeSource')}`);
  vm.runInContext(`${code}\nglobalThis.read = openProjectKnowledgeDocument; globalThis.exportSource = exportProjectKnowledgeSource;`, context);
  function renderProject(projectId) {
    context.selectedProjectId = projectId;
    const start = source.indexOf('  const nextProjectKnowledgeScope = ');
    const end = source.indexOf('  const currentProjectKnowledgeRead = ', start);
    vm.runInContext(`{${source.slice(start, end)}}`, context);
  }
  return { state, context, renderProject };
}
const file = (id) => ({ id, path: `${id}.md` });
const result = (content) => JSON.stringify({ ok: true, content, sha256: 'a'.repeat(64), provenance: 'linked', sources: [] });

test('actual knowledge click handler ignores an older document response after a newer click', async () => {
  const a = deferred(); const b = deferred();
  const f = ui({ readProjectKnowledgeFileAsync: (_project, id) => id === 'a' ? a.promise : b.promise });
  const first = f.context.read(file('a')); const second = f.context.read(file('b'));
  b.resolve(result('second')); await second;
  a.resolve(result('first')); await first;
  assert.equal(f.state.ProjectKnowledgeContent, 'second');
  assert.equal(f.state.ProjectKnowledgeRead.documentId, 'b');
});

test('switching projects and returning cannot revive a pending response from the earlier visit', async () => {
  const pending = deferred(); const f = ui({ readProjectKnowledgeFileAsync: () => pending.promise });
  const read = f.context.read(file('a'));
  f.renderProject('p2'); f.renderProject('p1');
  pending.resolve(result('must not show')); await read;
  assert.equal(f.state.ProjectKnowledgeContent, ''); assert.equal(f.state.ProjectKnowledgeRead, null);
});

test('read errors clear the previous body/provenance instead of displaying it as the selected file', async () => {
  const f = ui({ readProjectKnowledgeFileAsync: async () => { throw new Error('offline'); } });
  f.state.ProjectKnowledgeContent = 'old text'; f.state.ProjectKnowledgeRead = { projectId: 'p1' };
  await f.context.read(file('failed'));
  assert.equal(f.state.ProjectKnowledgeContent, ''); assert.equal(f.state.ProjectKnowledgeRead, null);
  assert.match(f.state.ProjectKnowledgeBrowserMessage, /读取失败/);
});

test('export handler sends authoritative document hash/version and ignores feedback after navigation', async () => {
  const pending = deferred(); let sent;
  const f = ui({ exportProjectKnowledgeSource: (...args) => { sent = args; return pending.promise; } });
  f.context.currentProjectKnowledgeRead = { projectId: 'p1', documentId: 'knowledge1', sha256: 'a'.repeat(64) };
  const exporting = f.context.exportSource({ materialId: 'm1', version: 2, exportAllowed: true });
  assert.deepEqual(sent, ['p1', 'knowledge1', 'a'.repeat(64), 'm1', 2]);
  f.renderProject('p2');
  pending.resolve(JSON.stringify({ ok: true, message: 'old project saved' })); await exporting;
  assert.equal(f.state.ProjectKnowledgeBrowserMessage, undefined);
});

test('legacy synchronous bridge stays readable without inventing source links', async () => {
  const f = ui({ readProjectKnowledgeFile: () => JSON.stringify({ ok: true, content: 'legacy' }) });
  await f.context.read(file('legacy'));
  assert.equal(f.state.ProjectKnowledgeContent, 'legacy');
  assert.equal(f.state.ProjectKnowledgeRead.provenance, undefined);
});
