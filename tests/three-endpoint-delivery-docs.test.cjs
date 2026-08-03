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
    'v0.15.9',
    'v0.6.10',
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
    ['../windows/AI-edu-manager-console-Windows-0.15.9.zip', path.join('release', 'windows', 'AI-edu-manager-console-Windows-0.15.9.zip')],
    ['../windows-terminal/AI-edu-manager-student-terminal-Windows-0.15.9.exe', path.join('release', 'windows-terminal', 'AI-edu-manager-student-terminal-Windows-0.15.9.exe')],
    ['../tablet-terminal/AI-edu-manager-tablet-terminal-0.6.10.apk', path.join('release', 'tablet-terminal', 'AI-edu-manager-tablet-terminal-0.6.10.apk')],
  ]) {
    assert.match(download, new RegExp(artifact[0].replaceAll('.', '\\.')));
    assert.equal(fs.existsSync(path.join(root, artifact[1])), true, `${artifact[1]} should exist`);
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
  assert.match(host, /课程学习/u);
  assert.match(host, /课程管理/u);
  assert.match(host, /单门课程 · 直接上传/u);
  assert.match(host, /上传课程图片/u);
  assert.match(host, /相同课程链接再次保存会更新同一门自选课程/u);
  assert.match(host, /文件大小不超过 10 MB/u);
  assert.match(host, /一次最多导入 200 门课程/u);
  assert.match(host, /导入平台离线目录/u);
  assert.match(host, /允许本机团队知识查询/u);
  assert.match(host, /允许远程协作团队知识查询/u);
  assert.match(host, /本机没有命中时，才向已经建立有效知识协作关系/u);
  assert.match(host, /submit_education_conversation/u);
  assert.match(host, /不会在后台抓取 Agent 的全部历史/u);
  assert.match(host, /学生原始资料不自动双向同步/u);
  assert.match(host, /QClaw 远程知识路由与运行期间的教育档案自动更新仍保留复测门禁/u);

  assert.match(windowsStudent, /自动投递文件夹/u);
  assert.match(windowsStudent, /学生原始资料库/u);
  assert.match(windowsStudent, /绑定项目/u);

  assert.match(androidStudent, /正在上传/u);
  assert.match(androidStudent, /上传完成/u);
  assert.match(androidStudent, /上传失败，点击重试/u);
  assert.match(androidStudent, /学生原始资料库/u);
  assert.match(androidStudent, /绑定项目/u);
  assert.match(windowsStudent, /查看成长模型/u);
  assert.match(androidStudent, /查看成长模型/u);
  assert.match(windowsStudent, /没有“课程管理”菜单/u);
  assert.match(androidStudent, /没有“课程管理”菜单/u);
});

test('download page explains the Windows 0.15.2 course menu permission boundary', () => {
  const html = read(path.join('release', '网站文件', 'download.html'));

  assert.match(html, /Windows 0\.15\.2 课程菜单更新/u);
  assert.match(html, /课程学习：所有版本均可打开已分配课程/u);
  assert.match(html, /课程管理：仅已激活的专业版和机构版可用/u);
  assert.match(html, /Excel 导入：四个字段，最多 200 门课程/u);
});

test('download page explains the Windows 0.15.4 direct course upload and host migration workflow', () => {
  const html = read(path.join('release', '网站文件', 'download.html'));

  assert.match(html, /Windows 0\.15\.4 课程上传与换机恢复/u);
  assert.match(html, /名称、简介、HTTPS 链接和最大 5 MB 图片/u);
  assert.match(html, /相同课程链接更新原课程/u);
  assert.match(html, /受管路径转到当前资料根目录，外部知识库不误改/u);
});

test('public site and web manual explain D-stage knowledge collaboration without overstating validation', () => {
  const home = read(path.join('release', '网站文件', 'index.html'));
  const download = read(path.join('release', '网站文件', 'download.html'));
  const manual = read(path.join('release', '网站文件', 'windows-host-manual.html'));
  const legacyManual = read(path.join('release', '网站文件', 'windows-manual.html'));

  for (const expected of [
    /跨主机知识协作/u,
    /本地优先/u,
    /团队范围/u,
    /原始资料不自动双向同步/u,
  ]) {
    assert.match(home, expected);
  }

  assert.match(download, /知识协作与跨主机知识/u);
  assert.match(download, /团队查询和明确对话投递已完成双机真机验证/u);
  assert.match(download, /远程路由与自动档案更新仍在受控复测/u);

  for (const expected of [
    /教育管家问答与跨主机知识查询/u,
    /允许本机团队知识查询/u,
    /允许远程协作团队知识查询/u,
    /submit_education_conversation/u,
    /学生原始资料不自动双向同步/u,
  ]) {
    assert.match(manual, expected);
    assert.match(legacyManual, expected);
  }
});

test('Windows student web manual keeps its table of contents aligned with the article', () => {
  const manual = read(path.join('release', '网站文件', 'windows-student-manual.html'));

  assert.match(manual, /width:min\(1180px,calc\(100% - 32px\)\)/u);
  assert.match(manual, /grid-template-columns:240px minmax\(0,1fr\)/u);
  assert.match(manual, /align-items:start/u);
  assert.match(manual, /h2\[id\] \{ scroll-margin-top:92px; \}/u);
  assert.match(manual, /@media\(max-width:820px\)/u);
  assert.match(manual, /适用版本：Windows 学生终端 0\.15\.9/u);
  assert.doesNotMatch(manual, /118\.px|24\.px|1\.\.%|\.\.9\.6/u);
});
