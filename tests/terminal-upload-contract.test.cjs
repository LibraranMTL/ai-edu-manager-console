const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Windows student terminal is packaged separately from the host', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.match(packageJson.scripts['build:win-terminal'], /build-windows-terminal-release\.cjs/);
  const releaseScript = read('scripts', 'build-windows-terminal-release.cjs');
  assert.match(releaseScript, /com\.qxmatrix\.edumanager\.studentterminal/);
  assert.match(releaseScript, /main: 'electron\/terminal-main\.cjs'/);
  assert.match(releaseScript, /student-terminal-Windows/);
  assert.match(releaseScript, /copy-minimal-runtime/);
  assert.match(releaseScript, /unexpectedly contains node_modules/);
  for (const runtimeModule of [
    'pairing-protocol.cjs',
    'lan-discovery.cjs',
    'terminal-lan-pairing.cjs',
    'terminal-connection.cjs',
    'windows-tailscale.cjs',
  ]) {
    assert.match(releaseScript, new RegExp(runtimeModule.replace('.', '\\.')));
  }
});

test('Windows student candidates isolate their Electron single-instance scope without changing formal releases', () => {
  const releaseScript = read('scripts', 'build-windows-terminal-release.cjs');
  const main = read('electron', 'terminal-main.cjs');
  assert.match(releaseScript, /candidateTag \? \{ eduCandidateTag: candidateTag \} : \{\}/);
  assert.match(main, /function packagedCandidateTag\(\)/);
  assert.match(main, /AI Education Student Terminal Candidates/);
  assert.match(main, /app\.setPath\('userData', candidateUserData\)/);
  assert.match(main, /if \(isolatedUserData\)[\s\S]*else if \(candidateRuntimeTag\)/);
  assert.match(main, /const hasSingleInstanceLock = app\.requestSingleInstanceLock\(\)/);
});

test('host validates project uploads and records traceable terminal provenance', () => {
  const source = read('electron', 'main.cjs');
  assert.match(source, /handleProjectMaterialUpload\(request, response, projectId, url\)/);
  assert.match(source, /project\.status === 'sealed'/);
  assert.match(source, /该学生未绑定到当前学习项目/);
  assert.match(source, /captureSessionId/);
  assert.match(source, /requestedUploadId/);
  assert.match(source, /terminal_upload/);
});

test('host quick and source-directory imports can target student raw or an active bound project raw space', () => {
  const main = read('electron', 'main.cjs');
  const preload = read('electron', 'preload.cjs');
  const ui = read('src', 'main.tsx');
  assert.match(main, /function importFiles\(studentKey, targetJson = ''\)/);
  assert.match(preload, /importFiles\(studentName, targetJson\)/);
  assert.match(ui, /importFiles\?\.\(student\.id, JSON\.stringify\(materialImportTargetForStudent\(student\)\)\)/);
  assert.match(main, /importMaterialSourceFiles\(studentId, pathsJson, targetJson = '', options = \{\}\)/);
  assert.match(main, /target\.type === 'project'/);
  assert.match(main, /targetProject\?\.status === 'sealed'/);
  assert.match(main, /triggerReason: 'host_manual_import'/);
  assert.match(main, /projectWithNewInputs\([\s\S]*?'host_manual_import'/);
  assert.match(preload, /importMaterialSourceFiles\(studentId, pathsJson, targetJson\)/);
  assert.match(ui, /materialImportTargetKey/);
  assert.match(ui, /导入位置/);
  assert.match(ui, /project\.status !== 'sealed'/);
  assert.doesNotMatch(ui, /导入后统一复制到当前学生原始资料库/);
  assert.doesNotMatch(ui, /<strong>资料来源目录<\/strong>/);
  assert.match(ui, /打开所选导入位置/);
});

test('Android terminal exposes target selection and upload button state feedback', () => {
  const source = read('android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java');
  assert.match(source, /chooseUploadTarget/);
  assert.match(source, /\/api\/projects\//);
  assert.match(source, /capture_project_id/);
  assert.match(source, /!"sealed"\.equals\(project\.status\)/);
  assert.match(source, /ColorStateList\.valueOf/);
  assert.match(source, /uploadInProgress/);
  assert.match(source, /styleSelectableButton/);
  assert.match(source, /setBackgroundTintList\(new ColorStateList/);
});

test('Windows student terminal filters sealed projects and gives pressed buttons visible feedback', () => {
  const ui = read('src', 'terminal-main.tsx');
  const css = read('src', 'terminal-styles.css');
  assert.match(ui, /project\.status !== 'sealed'/);
  assert.match(ui, /captureSession\?\.status === 'capturing' \? 'terminal-danger' : 'terminal-primary'/);
  assert.match(css, /:active:not\(:disabled\)/);
  assert.match(css, /filter: brightness\(\.9\)/);
});

test('Windows terminal auto delivery is target-aware, idempotent and non-destructive', () => {
  const main = read('electron', 'terminal-main.cjs');
  const upload = read('electron', 'terminal-upload.cjs');
  const autoDelivery = main.match(/async function runAutoDelivery\(\)[\s\S]+?\n}\n\nasync function captureFrame/)?.[0] || '';
  assert.match(main, /runAutoDelivery/);
  assert.match(main, /ledger\.delivered/);
  assert.doesNotMatch(autoDelivery, /unlinkSync|rmSync|renameSync/);
  assert.match(upload, /stableUploadId/);
  assert.match(upload, /studentId/);
  assert.match(upload, /\/api\/projects\//);
});
