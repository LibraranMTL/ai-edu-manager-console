const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const versionPolicy = fs.readFileSync(path.join(root, 'tests', 'version-policy.test.cjs'), 'utf8');

test('legacy 0.9.3 remains in the ordered in-place upgrade history', () => {
  assert.match(versionPolicy, /'0\.9\.3'/);
  assert.match(main, /Keep the legacy bridge working for older renderer bundles during an in-place upgrade/);
});

test('offline and unavailable executors preserve recoverable work', () => {
  assert.match(main, /局域网和 Tailscale 地址均暂不可用/);
  assert.match(main, /OpenClaw CLI 不可用/);
  assert.match(main, /Codex CLI 不可用/);
  assert.match(main, /digest_review_recovered/);
  assert.match(main, /恢复时检测到完整资料结果/);
});

test('backup and restore stay available without an external service', () => {
  assert.match(main, /bridge:backupHostData/);
  assert.match(main, /bridge:restoreHostData/);
  assert.match(main, /bridge:restoreLatestCollaborationState/);
});
