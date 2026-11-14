const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('task center refresh is asynchronous, cached and does not block the renderer', () => {
  assert.match(preload, /ipcRenderer\.invoke\('bridge:getTaskCenterAsync'/);
  assert.match(main, /ipcMain\.handle\('bridge:getTaskCenterAsync'/);
  assert.match(main, /taskCenterSnapshotCache/);
  assert.match(main, /taskIoClient\.request\(taskStorePath\(\), op/);
  assert.match(main,/await Promise\.all\(\[taskIoClient\.request\(taskStorePath\(\), op/);
  const worker = fs.readFileSync(path.join(root, 'electron', 'task-io-worker.cjs'), 'utf8');
  assert.match(worker, /if \(cache\?\.key === key\) return cache\.value/);
  assert.match(preload, /ipcRenderer\.invoke\('bridge:getTaskPage'/);
  assert.match(renderer, /const refreshTaskCenter = async \(force = false, quick = false\)/);
  assert.match(renderer, /taskCenterRequestRef/);
  assert.match(renderer, /taskCenterInFlightRef/);
});

test('automatic refresh is low-frequency, visibility-aware and independent of source arrays', () => {
  const effect = renderer.match(/useEffect\(\(\) => \{\s*if \(activeSection !== 'tasks'\)[\s\S]*?\}, \[activeSection\]\);/)?.[0] || '';
  assert.match(effect, /60000/);
  assert.match(effect, /document\.hidden/);
  assert.doesNotMatch(effect, /students|projects/);
});

test('large task data is bounded in storage, transfer and rendering', () => {
  assert.match(main, /history: \(store\.history \|\| \[\]\)\.slice\(0, 500\)/);
  assert.match(main, /\.slice\(0, 100\)/);
  assert.match(renderer, /visibleTaskCenterItems\.slice\(0, taskCenterDisplayLimit\)/);
  assert.match(renderer, /current \+ 30/);
  assert.match(renderer, /useState<[^>]+>\('needs_help'\)/);
});

test('active audit events are appended incrementally while legacy archives stay outside ordinary reads', () => {
  const writer = fs.readFileSync(path.join(root, 'electron', 'task-store-writer.cjs'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'electron', 'task-state-store.cjs'), 'utf8');
  assert.match(writer, /createTaskStateStore/);
  assert.match(writer, /store\.appendEvent\(query\.event\)/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS task_events/);
  assert.match(store, /Historical event-archives/);
  assert.match(main, /taskStoreGuard.appendEvent\(event\)/);
});

test('task ledger writes individual SQLite rows and Agent diagnostics render only after Advanced is opened', () => {
  const writer = fs.readFileSync(path.join(root, 'electron', 'task-store-writer.cjs'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'electron', 'task-state-store.cjs'), 'utf8');
  assert.match(writer, /store\.applyDelta\(query\)/);
  assert.match(fs.readFileSync(path.join(root,'electron/task-sql-store.cjs'),'utf8'), /ON CONFLICT\(task_id\) DO UPDATE/);
  assert.doesNotMatch(writer, /writeFile/);
  assert.match(renderer, /className="task-center-advanced"/);
  assert.match(renderer, /taskAdvancedOpen && <div className="task-adapter-grid">/);
});
