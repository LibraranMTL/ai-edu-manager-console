const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('smart inbox exposes audited batch archive and explicit new execution for exhausted unknown rows', () => {
  const panel = fs.readFileSync(path.join(root, 'src', 'SmartInboxPanel.tsx'), 'utf8');
  const engine = fs.readFileSync(path.join(root, 'electron', 'smart-inbox.cjs'), 'utf8');
  assert.match(panel, /reconcileExhausted/);
  assert.match(panel, /归档未知执行/);
  assert.match(panel, /明确重新执行/);
  assert.match(panel, /decide\('archive_unknown'\)/);
  assert.match(panel, /decide\('restart_unknown'\)/);
  assert.match(engine, /unknownResolution:\s*\{\s*disposition:\s*'abandoned'/);
  assert.match(engine, /resolution:\s*'user_requested_new_execution'/);
});

test('smart inbox explains that audit archive retains evidence and explicit restart may call Agent again', () => {
  const panel = fs.readFileSync(path.join(root, 'src', 'SmartInboxPanel.tsx'), 'utf8');
  assert.match(panel, /保留原执行、快照与审计记录/);
  assert.match(panel, /将再次调用Agent/);
});
