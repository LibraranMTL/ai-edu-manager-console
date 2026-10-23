const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'),
  'utf8',
);

test('tablet upload picker launches without resolveActivity preflight', () => {
  const method = source.match(/boolean launchPicker\([\s\S]*?\n    }/);
  assert.ok(method, 'launchPicker method should exist');
  assert.match(method[0], /startActivityForResult\(Intent\.createChooser/);
  assert.doesNotMatch(method[0], /resolveActivity/);
});

test('tablet collection restores a known student and retains an offline student scope', () => {
  const method = source.match(/void pickMaterial\(\) \{[\s\S]*?\n    }/);
  assert.ok(method, 'pickMaterial method should exist');
  assert.match(method[0], /selectedStudent == null && students\.size\(\) > 0/);
  assert.match(method[0], /currentStudentScopeId\(\)\.length\(\) == 0/);
  assert.match(method[0], /离线状态继续收集/);
});

test('manual upload bypasses the offline staging inbox and enters target confirmation directly', () => {
  const directPicker = source.match(/void startDirectUploadPicker\(\) \{[\s\S]*?\n    }/);
  assert.ok(directPicker, 'direct upload picker should exist');
  assert.match(directPicker[0], /REQUEST_DIRECT_UPLOAD/);
  assert.match(source, /requestCode == REQUEST_DIRECT_UPLOAD[\s\S]*chooseUploadTarget\(uris, true, false\)/);
  assert.match(source, /collectFile\.setOnClickListener[\s\S]*?startDirectUploadPicker\(\)/);
  assert.doesNotMatch(source, /button\("选择资料并上传"/);
  assert.doesNotMatch(directPicker[0], /collectMaterials\(/);
  assert.match(source, /管理待上传暂存/);
  assert.match(source, /setNeutralButton\("删除所选"/);
});

test('student image upload is multi-select first and camera or screen capture confirms a target directly', () => {
  const imagePicker = source.match(/void startDirectImageUploadPicker\(\) \{[\s\S]*?\n    }/);
  assert.ok(imagePicker, 'direct multi-image picker should exist');
  assert.match(imagePicker[0], /Intent\.ACTION_OPEN_DOCUMENT/);
  assert.match(imagePicker[0], /Intent\.EXTRA_ALLOW_MULTIPLE, true/);
  assert.doesNotMatch(imagePicker[0], /Intent\.ACTION_PICK/);
  assert.match(source, /REQUEST_DIRECT_IMAGE_UPLOAD[\s\S]*chooseUploadTarget\(uris, true, false\)/);
  assert.match(source, /pendingCameraDirectUpload[\s\S]*chooseUploadTarget\(uris, true, false\)/);
  const captureUpload = source.match(/void uploadCapturedScreenshots\(\) \{[\s\S]*?\n    }/);
  assert.ok(captureUpload, 'screen capture upload method should exist');
  assert.match(captureUpload[0], /chooseUploadTarget\(uris, true, false\)/);
});
