const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  COURSE_SNAPSHOT_SCHEMA,
  MANIFEST_SCHEMA,
  PACKAGE_SCHEMA,
  createStudentOfflineMigrationPackage,
  inspectStudentOfflineMigration,
} = require('../electron/student-offline-migration.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-student-offline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const studentRoot = path.join(root, 'student-knowledge');
  const externalRaw = path.join(root, 'external-raw');
  const projectRoot = path.join(root, 'project');
  const otherProjectRoot = path.join(root, 'other-project');
  const assets = path.join(root, 'course-assets');
  const destination = path.join(root, 'usb');
  for (const directory of [studentRoot, externalRaw, projectRoot, otherProjectRoot, assets, destination]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(studentRoot, 'AGENT.md'), '# student\n');
  fs.writeFileSync(path.join(externalRaw, 'photo-001.jpg'), 'photo');
  fs.writeFileSync(path.join(projectRoot, 'project.md'), '# project\n');
  fs.writeFileSync(path.join(otherProjectRoot, 'other.md'), '# other\n');
  fs.writeFileSync(path.join(assets, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'), 'cover-a');
  fs.writeFileSync(path.join(assets, 'unused.png'), 'unused');
  const student = { id: 'student-001', name: '测试学生', grade: '七年级', school: '测试学校', goal: '完成迁移', rootPath: studentRoot, rawPath: externalRaw };
  const projects = [
    { id: 'project-001', name: '科学探究', studentIds: ['student-001'], projectRootPath: projectRoot },
    { id: 'project-002', name: '其他学生项目', studentIds: ['student-002'], projectRootPath: otherProjectRoot },
  ];
  const courses = [
    {
      courseId: 'platform:math-foundation', type: 'platform_standard', name: '数学基础', provider: '平台',
      url: 'https://example.com/math', allowedHosts: ['example.com'],
      coverAsset: 'platform-assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      summary: '课程介绍', subjects: ['数学'], gradeRange: ['七年级'], languages: ['zh'], accountRequirement: '',
      effectiveAt: '2026-01-01T00:00:00.000Z', expiresAt: null, legalNotice: '学习使用', status: 'active',
    },
    {
      courseId: 'tenant:reading-club', type: 'tenant_custom', name: '机构阅读课', provider: '测试机构',
      url: 'https://example.com/reading', allowedHosts: ['example.com'],
      coverAsset: 'custom-assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      summary: '阅读课程', subjects: ['语文'], gradeRange: [], languages: ['zh'], accountRequirement: '',
      effectiveAt: '2026-01-01T00:00:00.000Z', expiresAt: null, legalNotice: '学习使用', status: 'active',
    },
  ];
  const options = {
    destinationParent: destination,
    appVersion: '0.16.8',
    hostDisplayName: '家庭主机',
    student,
    projects,
    courses,
    catalogVersion: '2026.08.09+student-001',
    resolveStudentRoot: (value) => value.rootPath,
    resolveProjectRoot: (value) => value.projectRootPath,
    resolveCourseAsset: (coverAsset) => path.join(assets, path.basename(coverAsset)),
  };
  return { root, studentRoot, externalRaw, projectRoot, otherProjectRoot, assets, destination, options };
}

test('student offline plan is exact-scope and includes effective platform and tenant courses', (t) => {
  const fx = fixture(t);
  const plan = inspectStudentOfflineMigration(fx.options);
  assert.equal(plan.ok, true);
  assert.equal(plan.student.id, 'student-001');
  assert.deepEqual(plan.projects.map((item) => item.id), ['project-001']);
  assert.equal(plan.courses.schema, COURSE_SNAPSHOT_SCHEMA);
  assert.equal(plan.courses.platformCount, 1);
  assert.equal(plan.courses.tenantCount, 1);
  assert.equal(plan.sources.some((item) => item.rootPath === fx.otherProjectRoot), false);
  assert.ok(plan.totalBytes > 0);
});

test('student offline export creates a directory package with portable destinations and no unrelated files', async (t) => {
  const fx = fixture(t);
  const created = await createStudentOfflineMigrationPackage(fx.options);
  assert.equal(created.ok, true);
  assert.equal(fs.statSync(created.packagePath).isDirectory(), true);
  const descriptor = JSON.parse(fs.readFileSync(path.join(created.packagePath, 'migration.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(created.packagePath, 'manifest.json'), 'utf8'));
  assert.equal(descriptor.schema, PACKAGE_SCHEMA);
  assert.equal(manifest.schema, MANIFEST_SCHEMA);
  assert.equal(descriptor.student.id, 'student-001');
  assert.deepEqual(descriptor.projects.map((item) => item.id), ['project-001']);
  assert.equal(descriptor.courses.courseCount, 2);
  assert.ok(manifest.files.some((item) => item.category === 'workspace' && item.destinationRelativePath === 'AGENT.md'));
  assert.ok(manifest.files.some((item) => item.category === 'workspace' && item.destinationRelativePath === '测试学生原始资料库/photo-001.jpg'));
  assert.ok(manifest.files.some((item) => item.category === 'project' && item.destinationRelativePath === '学习项目/科学探究项目知识库/project.md'));
  assert.ok(manifest.files.some((item) => item.category === 'course' && item.relativePath === 'catalog.json'));
  assert.equal(manifest.files.filter((item) => item.category === 'course-asset').length, 1);
  assert.equal(manifest.files.some((item) => item.relativePath === 'other.md' || item.relativePath === 'unused.png'), false);
  assert.deepEqual(manifest.excludedSensitiveData.sort(), ['api-token', 'course-authoring-drafts', 'host-identity', 'license', 'platform-private-keys', 'terminal-authorization'].sort());
});
