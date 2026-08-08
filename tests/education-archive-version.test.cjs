const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  recoverPlaceholderReportsFromArchive,
  reportHasSubstantiveContent,
  restoreArchiveVersion,
  validateArchiveVersion,
  writeArchiveVersion,
} = require('../electron/education-archive-version.cjs');

test('placeholder reports are distinguished from substantive reports', () => {
  assert.equal(reportHasSubstantiveContent('---\nstatus: draft\n---\n# 阶段总结\n\n## 本阶段核心进展\n\n待生成。\n\n## 主要问题\n\n- 待补充。'), false);
  assert.equal(reportHasSubstantiveContent('# 阶段总结\n\n## 本阶段核心进展\n\n学生已完成两轮资料整理并形成项目提纲。'), true);
});

function fixture(root, suffix = '') {
  return {
    rootDir: path.join(root, 'versions'),
    student: { id: 'student-1', name: '测试学生' },
    growthIndex: {
      sourceFingerprint: `growth-${suffix || 'a'}`,
      summary: { evidenceCount: 2, confirmedCount: 1, watchingCount: 1, abilityCount: 1, projectCount: 1 },
      evidence: [{ id: 'ev-1', title: '阅读证据', status: 'confirmed' }],
    },
    reports: [{ id: 'profile', title: '整体画像', fileName: '整体画像.md', content: `---\nupdated: 2026-07-24\n---\n# 整体画像\n\n稳定阅读${suffix}` }],
    createdAt: suffix ? '2026-07-25T01:02:03.000Z' : '2026-07-24T01:02:03.000Z',
  };
}

test('a portable archive version contains Markdown, JSON, manifest and change summary', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-archive-'));
  const result = writeArchiveVersion(fixture(root));
  assert.equal(result.ok, true);
  assert.equal(result.unchanged, false);
  for (const file of ['教育档案.md', 'education-archive.json', 'manifest.json', '变化摘要.md']) {
    assert.equal(fs.existsSync(path.join(result.versionDir, file)), true);
  }
  assert.equal(validateArchiveVersion(result.versionDir).ok, true);
});

test('same substantive growth and report content does not create a duplicate version', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-archive-idempotent-'));
  const first = writeArchiveVersion(fixture(root));
  const second = writeArchiveVersion({ ...fixture(root), createdAt: '2026-07-24T03:00:00.000Z' });
  assert.equal(second.unchanged, true);
  assert.equal(second.versionDir, first.versionDir);
  const versions = fs.readdirSync(path.join(root, 'versions')).filter((name) => !name.startsWith('.') && name !== 'latest.json');
  assert.equal(versions.length, 1);
});

test('substantive growth or report change creates a comparable second version', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-archive-change-'));
  writeArchiveVersion(fixture(root));
  const changed = writeArchiveVersion(fixture(root, 'b'));
  assert.equal(changed.unchanged, false);
  assert.ok(changed.changes.some((item) => item.includes('成长模型')));
  assert.ok(changed.changes.some((item) => item.includes('整体画像')));
});

test('validated archive restores growth and reports while a damaged export is isolated', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-archive-restore-'));
  const version = writeArchiveVersion(fixture(root));
  const current = path.join(root, 'current');
  const growthPath = path.join(current, 'growth.json');
  const reportPath = path.join(current, '整体画像.md');
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(growthPath, '{"sourceFingerprint":"old"}', 'utf8');
  fs.writeFileSync(reportPath, '# 旧报告', 'utf8');
  const restored = restoreArchiveVersion({
    versionDir: version.versionDir,
    studentId: 'student-1',
    growthIndexPath: growthPath,
    reportPaths: { profile: reportPath },
  });
  assert.equal(restored.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(growthPath, 'utf8')).sourceFingerprint, 'growth-a');
  assert.match(fs.readFileSync(reportPath, 'utf8'), /稳定阅读/);

  fs.appendFileSync(path.join(version.versionDir, '教育档案.md'), 'damaged', 'utf8');
  assert.equal(validateArchiveVersion(version.versionDir).ok, false);
  assert.equal(restoreArchiveVersion({
    versionDir: version.versionDir,
    studentId: 'student-1',
    growthIndexPath: growthPath,
    reportPaths: { profile: reportPath },
  }).ok, false);
});

test('migration recovery only replaces placeholder reports and repairs the portable latest pointer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-archive-migration-recovery-'));
  const version = writeArchiveVersion(fixture(root));
  const current = path.join(root, 'current');
  const placeholder = path.join(current, '整体画像.md');
  const existing = path.join(current, '阶段总结.md');
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(placeholder, '---\nstatus: draft\n---\n# 整体画像\n\n## 一句话画像\n\n待生成。', 'utf8');
  fs.writeFileSync(existing, '# 阶段总结\n\n保留当前电脑已有的正式内容。', 'utf8');
  fs.writeFileSync(path.join(root, 'versions', 'latest.json'), JSON.stringify({ versionDir: 'C:\\old-host\\missing' }), 'utf8');

  const result = recoverPlaceholderReportsFromArchive({
    rootDir: path.join(root, 'versions'),
    studentId: 'student-1',
    reportPaths: { profile: placeholder, stage: existing },
  });

  assert.equal(result.recovered.length, 1);
  assert.match(fs.readFileSync(placeholder, 'utf8'), /稳定阅读/);
  assert.match(fs.readFileSync(existing, 'utf8'), /保留当前电脑/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'versions', 'latest.json'), 'utf8')).versionDir, version.versionDir);
});
