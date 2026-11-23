const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const { parseCourseTrustPolicy } = require('../electron/course-trust-policy.cjs');
const { validateStudentCourseProjection, isCourseStartFallbackAllowed } = require('../electron/student-course-trust.cjs');
const { validateWindowsVersion } = require('../scripts/version-policy.cjs');

test('Windows student R4 feature baseline remains present after public-course port', () => {
  const main = read('electron/terminal-main.cjs');
  const renderer = read('src/terminal-main.tsx');
  const build = read('scripts/build-windows-terminal-release.cjs');

  for (const marker of ['terminal-agent-bridge.cjs', 'terminal-companion.html']) assert.match(build, new RegExp(marker.replaceAll('.', '\\.')));
  for (const marker of ['createTerminalAgentBridge', 'terminalCompanionState', '项目导师已切换到当前项目']) assert.match(main, new RegExp(marker));
  for (const marker of ['我的学习工作台', '资料搜集', '教育档案', '学习行动']) assert.match(renderer, new RegExp(marker));
});

test('Windows student validates publisher trust, policy revision and student scope', () => {
  const policy = parseCourseTrustPolicy(JSON.parse(read('public/course-catalog/trusted-course-issuers.json')));
  const valid = {
    schemaVersion: 2,
    hostId: 'host-a',
    studentId: 'student-a',
    publisherKeyId: 'course-catalog-candidate-20261106',
    trustPolicyRevision: policy.policyRevision,
  };
  assert.equal(validateStudentCourseProjection(valid, { hostId: 'host-a', studentId: 'student-a' }, policy), valid);
  assert.throws(() => validateStudentCourseProjection({ ...valid, publisherKeyId: 'unknown' }, { hostId: 'host-a', studentId: 'student-a' }, policy), /不受信任/);
  assert.throws(() => validateStudentCourseProjection(valid, { hostId: 'host-a', studentId: 'student-b' }, policy), /范围不匹配/);
  assert.throws(() => validateStudentCourseProjection({ ...valid, trustPolicyRevision: 'old' }, { hostId: 'host-a', studentId: 'student-a' }, policy), /策略与学生端版本不一致/);
});

test('Windows student keeps verified offline leases but fails closed on authorization errors', () => {
  assert.equal(isCourseStartFallbackAllowed({ status: 404 }), true);
  assert.equal(isCourseStartFallbackAllowed({ status: 500 }), true);
  assert.equal(isCourseStartFallbackAllowed(new Error('offline')), true);
  assert.equal(isCourseStartFallbackAllowed({ status: 401 }), false);
  assert.equal(isCourseStartFallbackAllowed({ status: 403 }), false);
});

test('Windows student release packages trust resources with source audit', () => {
  const version = JSON.parse(read('windows-terminal-version.json'));
  const build = read('scripts/build-windows-terminal-release.cjs');
  validateWindowsVersion(version.versionName);
  assert.ok(Number.isSafeInteger(version.versionCode) && version.versionCode > 0);
  assert.ok(['stable', 'candidate'].includes(version.releaseStatus));
  for (const marker of [
    'electron/course-trust-policy.cjs',
    'electron/student-course-trust.cjs',
    'public/course-catalog/trusted-course-issuers.json',
    'createSourceControlAudit',
  ]) assert.match(build, new RegExp(marker.replaceAll('/', '[\\\\/]')));
});
