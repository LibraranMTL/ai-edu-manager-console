'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const {
  MAX_UPDATE_MANIFEST_BYTES,
  validateWindowsUpdateManifest,
  readBoundedJsonResponse,
  createWindowsUpdateChecker,
  isAllowedWindowsDownloadUrl,
} = require('../electron/windows-update-check.cjs');

const stableManifest = {
  windowsReleaseStatus: 'stable',
  windowsVersionCode: 23000,
  windowsVersionName: '0.23.0',
  windowsUrl: 'https://www.greatbg.com/download/AI-Education-Manager-0.23.0.exe',
  windowsNotes: '正式更新',
};

test('stable higher Windows version on the official HTTPS host is accepted', () => {
  const result = validateWindowsUpdateManifest(stableManifest, 22800);
  assert.equal(result.ok, true);
  assert.equal(result.hasUpdate, true);
  assert.equal(result.versionCode, 23000);
  assert.equal(result.windowsUrl, stableManifest.windowsUrl);
  assert.equal(isAllowedWindowsDownloadUrl(result.windowsUrl), true);
});

test('candidate, stale and off-domain manifests never offer an update', () => {
  assert.equal(validateWindowsUpdateManifest({ ...stableManifest, windowsReleaseStatus: 'candidate' }, 22800).code, 'update_channel_not_stable');
  assert.equal(validateWindowsUpdateManifest(stableManifest, 23000).hasUpdate, false);
  assert.equal(validateWindowsUpdateManifest({ ...stableManifest, windowsUrl: 'https://evil.example/update.exe' }, 22800).code, 'update_download_url_rejected');
  assert.equal(validateWindowsUpdateManifest({ ...stableManifest, windowsUrl: 'http://www.greatbg.com/update.exe' }, 22800).code, 'update_download_url_rejected');
});

test('manifest reader rejects responses above 256 KiB before JSON parsing', async () => {
  const response = new PassThrough();
  response.statusCode = 200;
  const reading = readBoundedJsonResponse(response, MAX_UPDATE_MANIFEST_BYTES);
  response.end(Buffer.alloc(MAX_UPDATE_MANIFEST_BYTES + 1, 0x78));
  await assert.rejects(reading, (error) => error.code === 'update_manifest_too_large');
});

test('automatic update check runs once per checker process while manual checks remain available', async () => {
  let calls = 0;
  const checker = createWindowsUpdateChecker({
    fetchManifest: async () => { calls += 1; return stableManifest; },
    now: () => new Date('2026-11-02T10:00:00.000+08:00'),
  });
  const first = await checker.check({ source: 'startup', channel: 'stable', currentVersionCode: 22800 });
  const duplicate = await checker.check({ source: 'startup', channel: 'stable', currentVersionCode: 22800 });
  const manual = await checker.check({ source: 'manual', channel: 'stable', currentVersionCode: 22800 });
  assert.equal(first.hasUpdate, true);
  assert.equal(duplicate.skipped, true);
  assert.equal(duplicate.code, 'automatic_update_check_already_run');
  assert.equal(manual.hasUpdate, true);
  assert.equal(calls, 2);
});

test('renderer waits five seconds and offers download or later without silent install', () => {
  const host = read('electron', 'main.cjs');
  const preload = read('electron', 'preload.cjs');
  const ui = read('src', 'main.tsx');
  assert.match(host, /createWindowsUpdateChecker/);
  assert.match(host, /bridge:checkForUpdate/);
  const legacyUpdate = host.slice(host.indexOf('function checkUpdate('), host.indexOf('function licensedIpc('));
  assert.doesNotMatch(legacyUpdate, /https\.get|http:\/\//);
  assert.match(legacyUpdate, /windowsUpdateChecker\.check/);
  assert.match(preload, /checkForUpdate\(request\)/);
  assert.match(ui, /window\.setTimeout\([\s\S]{0,500}performUpdateCheck\('startup'\)[\s\S]{0,100}5_000/);
  assert.match(ui, /下载新版/);
  assert.match(ui, /稍后提醒/);
  assert.doesNotMatch(ui, /永久忽略|自动安装新版/);
});
