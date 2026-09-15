const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildCodexHookReviewPowerShell,
  configureCodexHookOnboarding,
  markCodexHookReviewOpened,
  markCodexHookVerified,
  publicCodexHookOnboarding,
} = require('../electron/codex-hook-onboarding.cjs');

function withStateFile(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-codex-hook-'));
  try { return run(path.join(root, 'state.json')); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('Codex Hook confirmation is preserved for the same stable identity', () => withStateFile((file) => {
  configureCodexHookOnboarding(file, {
    hookIdentity: 'stable-v1',
    hookPath: 'C:\\AI教育管家\\hook-stable-v1.exe',
    configuredAt: '2026-09-15T01:00:00.000Z',
  });
  assert.equal(publicCodexHookOnboarding(file, {
    hookIdentity: 'stable-v1', configured: true, cliAvailable: true,
  }).status, 'needs_confirmation');

  markCodexHookReviewOpened(file, { hookIdentity: 'stable-v1', openedAt: '2026-09-15T01:01:00.000Z' });
  assert.equal(publicCodexHookOnboarding(file, {
    hookIdentity: 'stable-v1', configured: true, cliAvailable: true,
  }).status, 'waiting_for_event');

  assert.equal(markCodexHookVerified(file, {
    hookIdentity: 'stable-v1', eventAt: '2026-09-15T01:02:00.000Z',
  }).changed, true);
  assert.equal(publicCodexHookOnboarding(file, {
    hookIdentity: 'stable-v1', configured: true, cliAvailable: true,
  }).status, 'verified');

  configureCodexHookOnboarding(file, {
    hookIdentity: 'stable-v1', hookPath: 'C:\\AI教育管家\\hook-stable-v1.exe',
  });
  assert.equal(publicCodexHookOnboarding(file, {
    hookIdentity: 'stable-v1', configured: true, cliAvailable: true,
  }).status, 'verified');
}));

test('changed Hook identity requires one new confirmation and ignores older queued events', () => withStateFile((file) => {
  configureCodexHookOnboarding(file, {
    hookIdentity: 'stable-v1', hookPath: 'C:\\hook-v1.exe', configuredAt: '2026-09-15T01:00:00.000Z',
  });
  markCodexHookVerified(file, { hookIdentity: 'stable-v1', eventAt: '2026-09-15T01:02:00.000Z' });
  configureCodexHookOnboarding(file, {
    hookIdentity: 'stable-v2', hookPath: 'C:\\hook-v2.exe', configuredAt: '2026-09-15T02:00:00.000Z',
  });
  assert.equal(publicCodexHookOnboarding(file, {
    hookIdentity: 'stable-v2', configured: true, cliAvailable: true,
  }).status, 'needs_confirmation');
  assert.equal(markCodexHookVerified(file, {
    hookIdentity: 'stable-v2', eventAt: '2026-09-15T01:59:59.000Z',
  }).changed, false);
  assert.equal(publicCodexHookOnboarding(file, {
    hookIdentity: 'stable-v2', configured: true, cliAvailable: true,
  }).verified, false);
}));

test('review launcher quotes PowerShell paths without interpolating them', () => {
  const script = buildCodexHookReviewPowerShell("C:\\Tools\\Codex's bin\\codex.cmd", "D:\\学生资料\\O'Brien");
  assert.match(script, /AI教育管家/);
  assert.match(script, /'C:\\Tools\\Codex''s bin\\codex\.cmd'/);
  assert.match(script, /'D:\\学生资料\\O''Brien'/);
  assert.doesNotMatch(script, /dangerously-bypass-hook-trust/i);
});
