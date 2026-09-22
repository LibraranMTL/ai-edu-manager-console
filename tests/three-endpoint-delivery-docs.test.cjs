const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const website = path.join(root, 'release', '网站文件');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('download page presents four product families and five client builds', () => {
  const html = read(path.join('release', '网站文件', 'download.html'));

  for (const expected of [
    'Windows 主机端',
    'Windows 学生端',
    'Android 学生端',
    'Android 教师端',
    'Android 单机版',
    'v0.17.10',
    'v0.6.16',
    'v0.1.1',
    'v1.2.2',
    'windows-host-manual.html',
    'windows-student-manual.html',
    'android-student-manual.html',
    'android-teacher-manual.html',
    'android-standalone-manual.html',
    '完整功能，支持主机—多终端部署',
    '资料采集与上传、精选课程学习、学情报告查看',
    '完整功能 · 家庭平板单机',
  ]) {
    assert.match(html, new RegExp(expected.replaceAll('.', '\\.'), 'u'));
  }

  assert.doesNotMatch(html, /iOS|即将开放/u);
  assert.match(html, /正式签名版/u);
  assert.match(html, /下载正式 APK/u);
  assert.doesNotMatch(html, /正式包待签名/u);
  assert.doesNotMatch(html, /app-debug\.apk|device-test-candidate\.apk/u);
});

test('download page omits historical release notes and acceptance details', () => {
  const html = read(path.join('release', '网站文件', 'download.html'));

  for (const removed of [
    'Windows 0.15.10 课程包导出正式版',
    'Windows 0.15.10 备份迁移候选',
    'Windows 0.15.10 Android 教师端支持升级',
    'Windows 0.15.9 教育内容智能出版正式发布',
    'Windows 0.15.6 平台课程权限与签名发布',
    'Windows 0.15.5 课程编辑与资料确认修复',
    'Windows 0.15.4 课程上传与换机恢复',
    'Windows 0.15.3 档案与报告导出更新',
    'Windows 0.15.2 课程菜单更新',
    '知识协作与跨主机知识',
    '全量自动测试',
    'SHA-256',
    'Authenticode',
  ]) {
    assert.doesNotMatch(html, new RegExp(removed.replaceAll('.', '\\.'), 'u'));
  }
  assert.doesNotMatch(html, /class=["']release-note/u);
});

test('download page links the current artifacts and canonical web manuals exist', () => {
  const download = read(path.join('release', '网站文件', 'download.html'));
  for (const artifact of [
    ['../download/AI-edu-manager-console-Windows-0.17.10.zip', path.join('release', 'windows', 'AI-edu-manager-console-Windows-0.17.10.zip')],
    ['../download/AI-edu-manager-student-terminal-Windows-0.16.10.exe', path.join('release', 'windows-terminal', 'AI-edu-manager-student-terminal-Windows-0.16.10.exe')],
    ['../download/AI-edu-manager-tablet-terminal-0.6.16.apk', path.join('release', 'tablet-terminal', 'AI-edu-manager-tablet-terminal-0.6.16.apk')],
    ['../download/AI-edu-manager-teacher-terminal-0.1.1.apk', path.join('release', 'teacher-terminal', 'AI-edu-manager-teacher-terminal-0.1.1.apk')],
    ['../download/AI-Education-Manager-Android-Standalone-1.2.2-release.apk', path.join('android-standalone-manager', 'delivery', 'AI-Education-Manager-Android-Standalone-1.2.2-release.apk')],
  ]) {
    assert.match(download, new RegExp(artifact[0].replaceAll('.', '\\.')));
    if (artifact[1]) {
      assert.equal(fs.existsSync(path.join(root, artifact[1])), true, `${artifact[1]} should exist`);
    }
  }
  for (const relativePath of [
    path.join('release', '网站文件', 'windows-host-manual.html'),
    path.join('release', '网站文件', 'windows-student-manual.html'),
    path.join('release', '网站文件', 'android-student-manual.html'),
    path.join('release', '网站文件', 'android-teacher-manual.html'),
    path.join('release', '网站文件', 'android-standalone-manual.html'),
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, `${relativePath} should exist`);
  }
});

test('all primary site pages link to the five canonical manuals', () => {
  for (const filename of ['index.html', 'download.html', 'buy.html', 'contact.html']) {
    const html = fs.readFileSync(path.join(website, filename), 'utf8');
    for (const manual of [
      'windows-host-manual.html',
      'windows-student-manual.html',
      'android-student-manual.html',
      'android-teacher-manual.html',
      'android-standalone-manual.html',
    ]) {
      assert.match(html, new RegExp(`href=["']${manual.replace('.', '\\.')}["']`, 'u'), `${filename} should link ${manual}`);
    }
  }
});

test('manual sources describe target selection and terminal-specific workflows', () => {
  const host = read(path.join('docs', 'delivery', 'Windows主机版操作手册.md'));
  const windowsStudent = read(path.join('docs', 'delivery', 'Windows学生终端操作手册.md'));
  const androidStudent = read(path.join('docs', 'delivery', 'Android学生终端操作手册.md'));
  const androidTeacher = read(path.join('docs', 'delivery', 'Android教师终端操作手册.md'));
  const androidStandalone = read(path.join('docs', 'delivery', 'Android单机版操作手册.md'));

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
  assert.match(host, /不扫描授权前历史或漏采轮次，也不读取其他会话、系统提示、工具密钥、缓存或教育管家任务中心上下文/u);
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
  assert.match(androidTeacher, /全部学生列表/u);
  assert.match(androidTeacher, /Windows 主机资料库/u);
  assert.match(androidTeacher, /不是把文件发送到学生设备/u);
  assert.match(androidTeacher, /自动投递文件夹/u);
  assert.match(androidTeacher, /档案缓存/u);
  assert.match(androidTeacher, /导入智能体对话/u);
  assert.match(androidTeacher, /不包含精选课程、学生空间登录或教育管家对话模块/u);
  assert.match(androidStandalone, /不依赖 Windows 主机的完整教育管家/u);
  assert.match(androidStandalone, /新建或接管学生学情档案/u);
  assert.match(androidStandalone, /智能混合（推荐）/u);
  assert.match(androidStandalone, /PalmClaw、豆包、MobileClaw 或 ChatGPT\/Codex/u);
  assert.match(androidStandalone, /加密备份与恢复/u);
  assert.match(androidStandalone, /不会自动读取其他应用的私有聊天数据库/u);
});

test('web manuals are synchronized to the current product workflows', () => {
  const windowsStudent = read(path.join('release', '网站文件', 'windows-student-manual.html'));
  const androidStudent = read(path.join('release', '网站文件', 'android-student-manual.html'));
  const androidTeacher = read(path.join('release', '网站文件', 'android-teacher-manual.html'));
  const androidStandalone = read(path.join('release', '网站文件', 'android-standalone-manual.html'));

  assert.match(windowsStudent, /配套主机：Windows 主机 0\.17\.7/u);
  assert.match(androidStudent, /配套主机：Windows 主机端 0\.17\.7/u);
  assert.match(androidTeacher, /适用版本：Android 教师端 0\.1\.1/u);
  assert.match(androidStudent, /导入智能体对话/u);
  assert.match(androidTeacher, /导入智能体对话/u);
  assert.match(androidTeacher, /不是把文件发送到学生设备/u);
  assert.match(androidTeacher, /在主机暂时不可连接时仍可从缓存查看/u);
  assert.match(androidStandalone, /适用版本：Android 单机版 1\.2\.2/u);
  assert.match(androidStandalone, /Android 单机版是一套不依赖 Windows 主机的完整教育管家/u);
  for (const manual of [windowsStudent, androidStudent, androidTeacher, androidStandalone]) {
    assert.match(manual, /android-teacher-manual\.html/u);
    assert.match(manual, /android-standalone-manual\.html/u);
  }
});

test('public home and web manual retain D-stage knowledge collaboration guidance', () => {
  const home = read(path.join('release', '网站文件', 'index.html'));
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
  assert.match(manual, /适用版本：Windows 学生终端 0\.16\.10/u);
  assert.doesNotMatch(manual, /118\.px|24\.px|1\.\.%|\.\.9\.6/u);
});
