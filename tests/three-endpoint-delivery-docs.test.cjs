const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const website = path.join(root, 'release', '网站文件');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('download page presents the current three-endpoint product line', () => {
  const html = read(path.join('release', '网站文件', 'download.html'));

  for (const expected of [
    'Windows 主机端',
    'Windows 学生端',
    'Android 学生端',
    'v0.9.10',
    'v0.6.2',
    'windows-host-manual.html',
    'windows-student-manual.html',
    'android-student-manual.html',
  ]) {
    assert.match(html, new RegExp(expected.replaceAll('.', '\\.'), 'u'));
  }

  assert.doesNotMatch(html, /iOS|即将开放/u);
});

test('download page links the current artifacts and canonical web manuals exist', () => {
  const download = read(path.join('release', '网站文件', 'download.html'));
  for (const artifact of [
    'AI-edu-manager-console-Windows-0.9.10.zip',
    'AI-edu-manager-student-terminal-Windows-0.9.10.exe',
    'AI-edu-manager-tablet-terminal-0.6.2.apk',
  ]) {
    assert.match(download, new RegExp(artifact.replaceAll('.', '\\.')));
  }
  for (const relativePath of [
    path.join('release', '网站文件', 'windows-host-manual.html'),
    path.join('release', '网站文件', 'windows-student-manual.html'),
    path.join('release', '网站文件', 'android-student-manual.html'),
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, `${relativePath} should exist`);
  }
});

test('all primary site pages link to the three canonical manuals', () => {
  for (const filename of ['index.html', 'download.html', 'buy.html', 'contact.html']) {
    const html = fs.readFileSync(path.join(website, filename), 'utf8');
    for (const manual of [
      'windows-host-manual.html',
      'windows-student-manual.html',
      'android-student-manual.html',
    ]) {
      assert.match(html, new RegExp(`href=["']${manual.replace('.', '\\.')}["']`, 'u'), `${filename} should link ${manual}`);
    }
  }
});

test('manual sources describe target selection and terminal-specific workflows', () => {
  const host = read(path.join('docs', 'delivery', 'Windows主机版操作手册.md'));
  const windowsStudent = read(path.join('docs', 'delivery', 'Windows学生终端操作手册.md'));
  const androidStudent = read(path.join('docs', 'delivery', 'Android学生终端操作手册.md'));

  assert.match(host, /学生原始资料库/u);
  assert.match(host, /绑定项目/u);
  assert.match(host, /Windows 学生端/u);
  assert.match(host, /Android 学生端/u);

  assert.match(windowsStudent, /自动投递文件夹/u);
  assert.match(windowsStudent, /学生原始资料库/u);
  assert.match(windowsStudent, /绑定项目/u);

  assert.match(androidStudent, /正在上传/u);
  assert.match(androidStudent, /上传完成/u);
  assert.match(androidStudent, /上传失败，点击重试/u);
  assert.match(androidStudent, /学生原始资料库/u);
  assert.match(androidStudent, /绑定项目/u);
});

test('Windows student web manual keeps its table of contents aligned with the article', () => {
  const manual = read(path.join('release', '网站文件', 'windows-student-manual.html'));

  assert.match(manual, /width:min\(1180px,calc\(100% - 32px\)\)/u);
  assert.match(manual, /grid-template-columns:240px minmax\(0,1fr\)/u);
  assert.match(manual, /align-items:start/u);
  assert.match(manual, /h2\[id\] \{ scroll-margin-top:92px; \}/u);
  assert.match(manual, /@media\(max-width:820px\)/u);
  assert.match(manual, /适用版本：Windows 学生终端 0\.9\.10/u);
  assert.doesNotMatch(manual, /118\.px|24\.px|1\.\.%|\.\.9\.6/u);
});
