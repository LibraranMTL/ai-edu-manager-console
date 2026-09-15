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
  assert.match(main, /Date\.now\(\) - taskCenterSnapshotCache\.at < 30_000/);
  assert.match(renderer, /const refreshTaskCenter = async \(force = false, quick = false\)/);
  assert.match(renderer, /taskCenterRequestRef/);
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
  assert.match(renderer, /useState<[^>]+>\('actionable'\)/);
});

test('audit events are rotated into retained archive files before the active log grows unbounded', () => {
  assert.match(main, /stat\.size >= 5 \* 1024 \* 1024/);
  assert.match(main, /event-archives/);
  assert.match(main, /fs\.renameSync\(eventPath/);
});
