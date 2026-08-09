const fs = require('fs');
const path = require('path');
const {
  createMigrationPackage,
  inspectMigrationSources,
  isSameOrInside,
} = require('./host-migration.cjs');

const PACKAGE_SCHEMA = 'edu-manager.student-portable-folder.v2';
const MANIFEST_SCHEMA = 'edu-manager.student-portable-manifest.v2';
const COURSE_SNAPSHOT_SCHEMA = 'edu-manager.student-course-snapshot.v1';
const PROFILE = 'student-android-offline';

function safeId(value, fallback = 'item') {
  const clean = String(value || '').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return clean || fallback;
}

function androidSafeName(value) {
  const clean = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  if (!clean) throw new Error('学生或项目名称不能为空。');
  return clean;
}

function publicStudent(student = {}) {
  return {
    id: String(student.id || '').trim(),
    name: androidSafeName(student.name),
    grade: String(student.grade || '').trim(),
    school: String(student.school || '').trim(),
    goal: String(student.goal || '').trim(),
    createdAt: String(student.createdAt || ''),
  };
}

function publicProject(project = {}) {
  const name = androidSafeName(project.name || project.storageName || project.id);
  return {
    id: String(project.id || '').trim(),
    name,
    type: String(project.type || '学习项目').trim(),
    description: String(project.description || '').trim(),
    objective: String(project.objective || '').trim(),
    status: String(project.status || 'active').trim(),
    targetRelativePath: `学习项目/${name}项目知识库`,
  };
}

function groupCourseAssets(courses, resolveCourseAsset) {
  const grouped = new Map();
  const assetFiles = new Map();
  for (const course of courses) {
    const coverAsset = String(course.coverAsset || '').replace(/\\/g, '/');
    if (!/^(platform-assets|custom-assets|catalog-assets)\/[a-z0-9][a-z0-9._-]*\.(png|jpg|jpeg|webp)$/i.test(coverAsset)) {
      throw new Error(`课程 ${course.courseId || course.name || ''} 的封面路径无效。`);
    }
    const sourcePath = path.resolve(String(resolveCourseAsset(coverAsset) || ''));
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`课程 ${course.courseId || course.name || ''} 的封面文件不存在。`);
    }
    const filename = path.basename(sourcePath);
    const previous = assetFiles.get(filename.toLocaleLowerCase('en-US'));
    if (previous && path.resolve(previous) !== sourcePath) throw new Error(`课程封面文件名冲突：${filename}`);
    assetFiles.set(filename.toLocaleLowerCase('en-US'), sourcePath);
    const directory = path.dirname(sourcePath);
    if (!grouped.has(directory)) grouped.set(directory, []);
    if (!grouped.get(directory).includes(filename)) grouped.get(directory).push(filename);
  }
  return [...grouped.entries()].map(([rootPath, filenames], index) => ({
    kind: 'course-asset',
    id: `course-assets-${index + 1}`,
    label: '课程封面',
    rootPath,
    includeRelativePaths: filenames,
  }));
}

function buildStudentOfflineDefinition(options = {}) {
  const student = publicStudent(options.student || {});
  if (!student.id) throw new Error('必须选择一个具有稳定 ID 的学生。');
  const resolveStudentRoot = typeof options.resolveStudentRoot === 'function'
    ? options.resolveStudentRoot
    : (value) => value?.resolvedRootPath || value?.rootPath || '';
  const resolveProjectRoot = typeof options.resolveProjectRoot === 'function'
    ? options.resolveProjectRoot
    : (value) => value?.resolvedRootPath || value?.projectRootPath || value?.rootPath || '';
  const studentRootValue = String(resolveStudentRoot(options.student) || '').trim();
  if (!studentRootValue) throw new Error('学生档案根目录不存在。');
  const studentRoot = path.resolve(studentRootValue);
  if (!fs.existsSync(studentRoot) || !fs.statSync(studentRoot).isDirectory()) throw new Error('学生档案根目录不存在。');

  const sources = [{ kind: 'workspace', id: safeId(student.id, 'student'), label: `${student.name} 学生档案`, rootPath: studentRoot }];
  const rawPathValue = String(options.student?.rawPath || '').trim();
  const rawPath = rawPathValue ? path.resolve(rawPathValue) : '';
  if (rawPath && fs.existsSync(rawPath) && fs.statSync(rawPath).isDirectory() && !isSameOrInside(studentRoot, rawPath)) {
    sources.push({
      kind: 'workspace',
      id: `${safeId(student.id, 'student')}-raw`,
      label: `${student.name} 外部原始资料`,
      rootPath: rawPath,
      destinationPrefix: `${student.name}原始资料库`,
    });
  }

  const seenProjectRoots = new Set();
  const projects = [];
  for (const raw of Array.isArray(options.projects) ? options.projects : []) {
    const studentIds = Array.isArray(raw.studentIds) ? raw.studentIds.map(String) : [];
    if (!studentIds.includes(student.id)) continue;
    const project = publicProject(raw);
    if (!project.id) continue;
    const rootValue = String(resolveProjectRoot(raw) || '').trim();
    if (!rootValue) continue;
    const rootPath = path.resolve(rootValue);
    if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) continue;
    const rootKey = rootPath.toLocaleLowerCase('en-US');
    if (seenProjectRoots.has(rootKey)) continue;
    seenProjectRoots.add(rootKey);
    projects.push(project);
    sources.push({
      kind: 'project',
      id: safeId(project.id, `project-${projects.length}`),
      label: `${project.name} 学习项目`,
      rootPath,
      destinationPrefix: project.targetRelativePath,
    });
  }

  const courses = (Array.isArray(options.courses) ? options.courses : [])
    .filter((course) => course && typeof course === 'object')
    .map((course) => ({ ...course }));
  const courseAssets = options.courseAssets && typeof options.courseAssets === 'object' ? options.courseAssets : {};
  const resolveCourseAsset = typeof options.resolveCourseAsset === 'function'
    ? options.resolveCourseAsset
    : (coverAsset) => courseAssets[coverAsset] || '';
  if (courses.length) sources.push(...groupCourseAssets(courses, resolveCourseAsset));
  const courseSnapshot = {
    schema: COURSE_SNAPSHOT_SCHEMA,
    studentId: student.id,
    catalogVersion: String(options.catalogVersion || 'student-effective-snapshot'),
    createdAt: new Date().toISOString(),
    courses,
  };
  const courseContent = `${JSON.stringify(courseSnapshot, null, 2)}\n`;
  const courseSummary = {
    schema: COURSE_SNAPSHOT_SCHEMA,
    catalogVersion: courseSnapshot.catalogVersion,
    courseCount: courses.length,
    platformCount: courses.filter((course) => course.type === 'platform_standard').length,
    tenantCount: courses.filter((course) => course.type === 'tenant_custom').length,
  };
  const extensions = { profile: PROFILE, studentId: student.id, student, projects, courses: courseSummary };
  return {
    student,
    projects,
    courses,
    sources,
    virtualFiles: [{ kind: 'course', id: 'course-catalog', relativePath: 'catalog.json', content: courseContent }],
    extensions,
    courseContentBytes: Buffer.byteLength(courseContent, 'utf8'),
    studentRoot,
  };
}

function inspectStudentOfflineMigration(options = {}) {
  const definition = buildStudentOfflineDefinition(options);
  const inspected = inspectMigrationSources(definition.sources);
  return {
    ok: true,
    schema: 'edu-manager.student-offline-plan.v1',
    profile: PROFILE,
    student: definition.student,
    projects: definition.projects,
    courses: definition.extensions.courses,
    fileCount: inspected.fileCount + definition.virtualFiles.length,
    totalBytes: inspected.totalBytes + definition.courseContentBytes,
    largestFileBytes: Math.max(inspected.largestFileBytes || 0, definition.courseContentBytes),
    sources: inspected.sources,
  };
}

async function createStudentOfflineMigrationPackage(options = {}) {
  const definition = buildStudentOfflineDefinition(options);
  return createMigrationPackage({
    destinationParent: options.destinationParent,
    appVersion: options.appVersion,
    hostDisplayName: options.hostDisplayName,
    managedRoot: definition.studentRoot,
    sources: definition.sources,
    virtualFiles: definition.virtualFiles,
    onProgress: options.onProgress,
    packagePrefix: `AI-Edu-Android-${safeId(definition.student.id, 'student')}`,
    packageSchema: PACKAGE_SCHEMA,
    manifestSchema: MANIFEST_SCHEMA,
    identityPolicy: 'preserve-exact-student-and-project-identities',
    excludedSensitiveData: ['host-identity', 'license', 'api-token', 'terminal-authorization', 'platform-private-keys', 'course-authoring-drafts'],
    descriptorExtensions: definition.extensions,
    manifestExtensions: definition.extensions,
    reportTitle: '# AI教育管家 Android 单机版学生迁移报告',
    reportLines: [
      `- 学生：${definition.student.name}（${definition.student.id}）`,
      `- 学习项目：${definition.projects.length} 个`,
      `- 平台课程：${definition.extensions.courses.platformCount} 门`,
      `- 机构课程：${definition.extensions.courses.tenantCount} 门`,
      '- 课程只作为该学生的只读学习快照进入 Android 单机版。',
    ],
    reportFooter: 'License、API Token、主机身份、终端授权、平台私钥和课程草稿未进入迁移包；Android 单机版必须独立激活。',
  });
}

module.exports = {
  COURSE_SNAPSHOT_SCHEMA,
  MANIFEST_SCHEMA,
  PACKAGE_SCHEMA,
  PROFILE,
  androidSafeName,
  buildStudentOfflineDefinition,
  createStudentOfflineMigrationPackage,
  inspectStudentOfflineMigration,
};
