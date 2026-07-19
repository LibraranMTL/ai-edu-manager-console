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

test('tablet upload action restores a student selection when available', () => {
  const method = source.match(/void pickMaterial\(\) \{[\s\S]*?\n    }/);
  assert.ok(method, 'pickMaterial method should exist');
  assert.match(method[0], /selectedStudent == null && students\.size\(\) > 0/);
  assert.match(method[0], /请先刷新并选择学生/);
});
