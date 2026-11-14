'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
function artifactName(url, label) {
  const name = new URL(url).pathname.split('/').pop();
  assert.ok(name, `${label} must contain an artifact filename`);
  return name;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertReleaseWebsiteParity(root = repoRoot) {
  const manifestPaths = [
    path.join(root, 'release', 'edu-manager-version.json'),
    path.join(root, 'release', 'windows', 'edu-manager-version.json'),
    path.join(root, 'release', '网站文件', 'edu-manager-version.json'),
  ];
  const manifests = manifestPaths.map((manifestPath) => ({
    path: manifestPath,
    value: JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
  }));
  const canonical = manifests[0].value;
  const publicFields = [
    'windowsVersionCode',
    'windowsVersionName',
    'windowsReleaseStatus',
    'windowsUrl',
    'windowsTerminalVersionCode',
    'windowsTerminalVersionName',
    'windowsTerminalUrl',
    'tabletTerminalVersionCode',
    'tabletTerminalVersionName',
    'tabletTerminalApkUrl',
    'teacherTerminalVersionCode',
    'teacherTerminalVersionName',
    'teacherTerminalUrl',
  ];
  for (const manifest of manifests.slice(1)) {
    for (const field of publicFields) {
      assert.deepEqual(manifest.value[field], canonical[field], `${manifest.path} differs from the canonical manifest at ${field}`);
    }
  }

  const downloadPath = path.join(root, 'release', '网站文件', 'download.html');
  const html = fs.readFileSync(downloadPath, 'utf8');
  const tabletArtifact = artifactName(canonical.tabletTerminalApkUrl, 'tabletTerminalApkUrl');
  const teacherArtifact = artifactName(canonical.teacherTerminalUrl, 'teacherTerminalUrl');
  assert.match(
    html,
    new RegExp(`Windows v${escapeRegex(canonical.windowsTerminalVersionName)}\\s*·\\s*Android v${escapeRegex(canonical.tabletTerminalVersionName)}`, 'u'),
    'download page student-card version must match the public manifest',
  );
  assert.match(html, new RegExp(`href=["']\\.\\./download/${escapeRegex(tabletArtifact)}["']`, 'u'), 'download page student APK link must match the public manifest');
  assert.match(
    html,
    new RegExp(`<h2>Android 教师端</h2>\\s*<span class=["']version-tag["']>v${escapeRegex(canonical.teacherTerminalVersionName)}</span>`, 'u'),
    'download page teacher-card version must match the public manifest',
  );
  assert.match(html, new RegExp(`href=["']\\.\\./download/${escapeRegex(teacherArtifact)}["']`, 'u'), 'download page teacher APK link must match the public manifest');
  const studentManual = fs.readFileSync(path.join(root, 'release', '网站文件', 'android-student-manual.html'), 'utf8');
  assert.match(studentManual, new RegExp(`适用版本：Android 学生端 ${escapeRegex(canonical.tabletTerminalVersionName)}（versionCode ${escapeRegex(canonical.tabletTerminalVersionCode)}）`, 'u'), 'student web manual version must match the public manifest');
  assert.match(studentManual, new RegExp(escapeRegex(tabletArtifact), 'u'), 'student web manual APK must match the public manifest');
  const teacherManual = fs.readFileSync(path.join(root, 'release', '网站文件', 'android-teacher-manual.html'), 'utf8');
  assert.match(teacherManual, new RegExp(`适用版本：Android 教师端 ${escapeRegex(canonical.teacherTerminalVersionName)}（versionCode ${escapeRegex(canonical.teacherTerminalVersionCode)}）`, 'u'), 'teacher web manual version must match the public manifest');
  assert.match(teacherManual, new RegExp(escapeRegex(teacherArtifact), 'u'), 'teacher web manual APK must match the public manifest');
  return {
    tablet: `${canonical.tabletTerminalVersionName}/${canonical.tabletTerminalVersionCode}`,
    teacher: `${canonical.teacherTerminalVersionName}/${canonical.teacherTerminalVersionCode}`,
  };
}

if (require.main === module) {
  const result = assertReleaseWebsiteParity();
  process.stdout.write(`Release website parity OK: Android student ${result.tablet}; Android teacher ${result.teacher}.\n`);
}

module.exports = { assertReleaseWebsiteParity };
