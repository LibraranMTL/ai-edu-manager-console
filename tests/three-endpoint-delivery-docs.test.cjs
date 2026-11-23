const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const website = path.join(root, 'release', '网站文件');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}
const publicManifest = JSON.parse(read(path.join('release', '网站文件', 'edu-manager-version.json')));
const hostArtifact = new URL(publicManifest.windowsUrl).pathname.split('/').pop();
const publishedHostVersion = hostArtifact.match(/Windows-(\d+\.\d+\.\d+)/)?.[1];

test('download page presents four product families and five client builds', () => {
  const html = read(path.join('release', '网站文件', 'download.html'));

  for (const expected of [
    'Windows 主机端',
    'Windows 学生端',
    'Android 学生端',
    'Android 教师端',
    'Android 单机版',
    `v${publicManifest.windowsReleaseStatus === 'candidate' ? publishedHostVersion : publicManifest.windowsVersionName}`,
    `v${publicManifest.tabletTerminalVersionName}`,
    `v${publicManifest.teacherTerminalVersionName}`,
    `v${publicManifest.standaloneVersionName}`,
    'windows-host-manual.html',
    'windows-student-manual.html',
    'android-student-manual.html',
    'android-teacher-manual.html',
    'android-standalone-manual.html',
    '完整功能 · 主机与多终端',
    '搜集上传、主机连接、教育档案、学习行动',
    '完整功能 · 家庭平板单机',
  ]) {
    assert.match(html, new RegExp(expected.replaceAll('.', '\\.'), 'u'));
  }

  assert.doesNotMatch(html, /iOS|即将开放/u);
  assert.match(html, /程序(?:仍)?未进行 Authenticode 签名/u);
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
  ]) {
    assert.doesNotMatch(html, new RegExp(removed.replaceAll('.', '\\.'), 'u'));
  }
  assert.doesNotMatch(html, /class=["']release-note/u);
});

test('download page links the current artifacts and canonical web manuals exist', () => {
  const download = read(path.join('release', '网站文件', 'download.html'));
  const standaloneArtifact = new URL(publicManifest.standaloneApkUrl).pathname.split('/').pop();
  for (const artifact of [
    [`../download/${hostArtifact}`, path.join('release', 'windows', hostArtifact)],
    [`../download/${new URL(publicManifest.windowsTerminalUrl).pathname.split('/').pop()}`, path.join('release', 'windows-terminal', new URL(publicManifest.windowsTerminalUrl).pathname.split('/').pop())],
    [`../download/${new URL(publicManifest.tabletTerminalApkUrl).pathname.split('/').pop()}`, path.join('release', 'tablet-terminal', new URL(publicManifest.tabletTerminalApkUrl).pathname.split('/').pop())],
    [`../download/${new URL(publicManifest.teacherTerminalUrl).pathname.split('/').pop()}`, path.join('release', 'teacher-terminal', new URL(publicManifest.teacherTerminalUrl).pathname.split('/').pop())],
    [`../download/${standaloneArtifact}`, path.join('android-standalone-manager', 'delivery', standaloneArtifact)],
  ]) {
    assert.match(download, new RegExp(artifact[0].replaceAll('.', '\\.')));
    if (artifact[1] && process.env.REQUIRE_RELEASE_ARTIFACTS === '1') {
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
  assert.ok(host.includes(`Windows 主机 ${publicManifest.windowsVersionName}（版本码 ${publicManifest.windowsVersionCode}）公开稳定版`));
  assert.doesNotMatch(host, /Windows 主机 0\.21\.6 公开稳定版/u);
  assert.match(host, /单门课程 · 直接上传/u);
  assert.match(host, /上传课程图片/u);
  assert.match(host, /相同课程链接再次保存会更新同一门自选课程/u);
  assert.match(host, /文件大小不超过 10 MB/u);
  assert.match(host, /一次最多导入 200 门课程/u);
  assert.match(host, /平台课程同步与异常处理/u);
  assert.match(host, /云端课程发布管理/u);
  assert.doesNotMatch(host, /保存平台草稿/u);
  assert.doesNotMatch(host, /发布并导出平台课程包/u);
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
  assert.match(androidStandalone, /PalmClaw、豆包或其他 Agent/u);
  assert.match(androidStandalone, /本版本不接入 OpenAI 服务/u);
  assert.match(androidStandalone, /加密备份与恢复/u);
  assert.match(androidStandalone, /不会自动读取其他应用的私有聊天数据库/u);
});

test('web manuals are synchronized to the current product workflows', () => {
  const windowsStudent = read(path.join('release', '网站文件', 'windows-student-manual.html'));
  const androidStudent = read(path.join('release', '网站文件', 'android-student-manual.html'));
  const androidTeacher = read(path.join('release', '网站文件', 'android-teacher-manual.html'));
  const androidStandalone = read(path.join('release', '网站文件', 'android-standalone-manual.html'));

  assert.match(windowsStudent, new RegExp(`配套主机：Windows 主机 ${publicManifest.windowsVersionName.replaceAll('.', '\\.')}`, 'u'));
  assert.match(androidStudent, /配套主机：Windows\s+主机端需开启学生终端协作服务/u);
  assert.match(androidStudent, new RegExp(`适用版本：Android 学生端 ${publicManifest.tabletTerminalVersionName.replaceAll('.', '\\.')}（versionCode ${publicManifest.tabletTerminalVersionCode}）`, 'u'));
  assert.match(androidStudent, /拍照\s*\/\s*上传图片或文件/u);
  assert.match(androidTeacher, new RegExp(`适用版本：Android 教师端 ${publicManifest.teacherTerminalVersionName.replaceAll('.', '\\.')}（versionCode ${publicManifest.teacherTerminalVersionCode}）`, 'u'));
  assert.match(androidStudent, /导入智能体对话/u);
  assert.match(androidTeacher, /导入智能体对话/u);
  assert.match(androidTeacher, /不是把文件发送到学生设备/u);
  assert.match(androidTeacher, /在主机暂时不可连接时仍可从缓存查看/u);
  assert.match(
    androidStandalone,
    new RegExp(`正式版 ${publicManifest.standaloneVersionName.replaceAll('.', '\\.')}`, 'u'),
  );
  assert.match(androidStandalone, /单机版不依赖 Windows 主机/u);
  for (const manual of [windowsStudent, androidStudent, androidTeacher]) {
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

  assert.match(manual, /width:\s*min\(1180px,\s*calc\(100% - 32px\)\)/u);
  assert.match(manual, /grid-template-columns:\s*240px minmax\(0,\s*1fr\)/u);
  assert.match(manual, /align-items:\s*start/u);
  assert.match(manual, /h2\[id\]\s*\{\s*scroll-margin-top:\s*92px;/u);
  assert.match(manual, /@media\s*\(max-width:\s*820px\)/u);
  assert.match(manual, new RegExp(`适用版本：Windows 学生终端 ${publicManifest.windowsTerminalVersionName.replaceAll('.', '\\.')}`, 'u'));
  assert.doesNotMatch(manual, /118\.px|24\.px|1\.\.%|\.\.9\.6/u);
});
