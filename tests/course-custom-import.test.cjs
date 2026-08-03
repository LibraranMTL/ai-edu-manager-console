const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');
const {
  canImportCustomCourses,
  createCustomCourseFromForm,
  importCustomCoursesFromExcel,
  inspectCustomCourseImage,
  writeCustomCourseTemplate,
} = require('../electron/course-custom-import.cjs');

const root = path.resolve(__dirname, '..');

test('custom course Excel import is limited to active PRO, ORG and PLATFORM licenses', () => {
  assert.equal(canImportCustomCourses({ active: true, plan: 'PRO' }), true);
  assert.equal(canImportCustomCourses({ active: true, plan: 'ORG' }), true);
  assert.equal(canImportCustomCourses({ active: true, plan: 'PLATFORM', role: 'PLATFORM_EDITOR' }), true);
  assert.equal(canImportCustomCourses({ active: true, capabilities: ['tenant_course_manage'] }), true);
  assert.equal(canImportCustomCourses({ active: true, plan: 'FAMILY' }), false);
  assert.equal(canImportCustomCourses({ active: false, plan: 'PRO' }), false);
});

test('generated Excel template exposes only the four required course columns', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-template-'));
  const target = path.join(temp, 'template.xlsx');
  await writeCustomCourseTemplate(target);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(target);
  const worksheet = workbook.getWorksheet('课程导入');
  assert.ok(worksheet);
  assert.deepEqual(
    [1, 2, 3, 4].map((column) => String(worksheet.getCell(1, column).value)),
    ['课程名称', '课程图片', '课程简介', '课程链接'],
  );
});

test('Excel row imports a local image and derives a restricted tenant course', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-import-'));
  const workbookPath = path.join(temp, 'courses.xlsx');
  const assetDir = path.join(temp, 'assets');
  const imagePath = path.join(root, 'public', 'catalog-assets', 'starfall-k5-math.png');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('课程导入');
  worksheet.addRow(['课程名称', '课程图片', '课程简介', '课程链接']);
  worksheet.addRow(['测试课程', imagePath, '用于验证四字段导入。', 'https://example.com/course#unit']);
  await workbook.xlsx.writeFile(workbookPath);

  const result = await importCustomCoursesFromExcel(workbookPath, {
    assetDir,
    now: '2026-07-30T00:00:00.000Z',
  });
  assert.equal(result.imported, 1);
  const course = result.courses[0];
  assert.match(course.courseId, /^tenant:custom-[a-f0-9]{20}$/);
  assert.equal(course.type, 'tenant_custom');
  assert.equal(course.provider, '机构自选课程');
  assert.equal(course.url, 'https://example.com/course');
  assert.deepEqual(course.allowedHosts, ['example.com', 'www.example.com']);
  assert.match(course.coverAsset, /^custom-assets\/[a-f0-9]{64}\.png$/);
  const copied = path.join(assetDir, path.basename(course.coverAsset));
  assert.equal(fs.existsSync(copied), true);
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(copied)).digest('hex'),
    path.basename(course.coverAsset, '.png'),
  );
});

test('Excel import rejects missing fields without partially returning courses', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-import-invalid-'));
  const workbookPath = path.join(temp, 'courses.xlsx');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('课程导入');
  worksheet.addRow(['课程名称', '课程图片', '课程简介', '课程链接']);
  worksheet.addRow(['缺少图片', '', '简介', 'https://example.com/course']);
  await workbook.xlsx.writeFile(workbookPath);
  await assert.rejects(
    () => importCustomCoursesFromExcel(workbookPath, { assetDir: path.join(temp, 'assets') }),
    /第 2 行缺少：课程图片/,
  );
});

test('single-course form saves a selected local image and normalizes the HTTPS course URL', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-direct-upload-'));
  const assetDir = path.join(temp, 'assets');
  const imagePath = path.join(root, 'public', 'catalog-assets', 'starfall-k5-math.png');
  const inspected = await inspectCustomCourseImage(imagePath);
  assert.equal(inspected.extension, '.png');
  assert.ok(inspected.bytes > 0);

  const result = await createCustomCourseFromForm({
    name: ' 单门测试课程 ',
    summary: ' 通过课程管理表单直接保存。 ',
    url: 'https://EXAMPLE.com/course#lesson',
    imagePath,
  }, {
    assetDir,
    now: '2026-07-31T00:00:00.000Z',
  });

  assert.equal(result.course.name, '单门测试课程');
  assert.equal(result.course.summary, '通过课程管理表单直接保存。');
  assert.equal(result.course.url, 'https://example.com/course');
  assert.deepEqual(result.course.allowedHosts, ['example.com', 'www.example.com']);
  assert.match(result.course.courseId, /^tenant:custom-[a-f0-9]{20}$/);
  assert.match(result.course.coverAsset, /^custom-assets\/[a-f0-9]{64}\.png$/);
  assert.equal(fs.existsSync(path.join(assetDir, path.basename(result.course.coverAsset))), true);
});

test('single-course editing keeps the existing tenant course id when its link changes', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-direct-edit-'));
  const imagePath = path.join(root, 'public', 'catalog-assets', 'starfall-k5-math.png');
  const result = await createCustomCourseFromForm({
    name: '编辑后的课程',
    summary: '名称、简介、图片和链接均可修改。',
    url: 'https://example.com/new-course',
    imagePath,
  }, {
    assetDir: path.join(temp, 'assets'),
    courseId: 'tenant:custom-existing-course',
  });

  assert.equal(result.course.courseId, 'tenant:custom-existing-course');
  assert.equal(result.course.url, 'https://example.com/new-course');
  await assert.rejects(
    () => createCustomCourseFromForm({
      name: '平台课程',
      summary: '不能编辑平台签名课程。',
      url: 'https://example.com/platform',
      imagePath,
    }, { assetDir: path.join(temp, 'other-assets'), courseId: 'platform:course' }),
    /只能编辑机构自选课程/,
  );
});

test('single-course form requires all fields and accepts registered HTTP course sites', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-direct-invalid-'));
  const imagePath = path.join(root, 'public', 'catalog-assets', 'starfall-k5-math.png');
  await assert.rejects(
    () => createCustomCourseFromForm({ name: '', summary: '', url: '', imagePath: '' }, { assetDir: temp }),
    /课程名称、课程简介、课程链接、课程图片/,
  );
  const httpResult = await createCustomCourseFromForm({
    name: 'HTTP 课程',
    summary: '课程提供方没有 HTTPS 时允许按课程域名访问。',
    url: 'http://example.com/course',
    imagePath,
  }, { assetDir: path.join(temp, 'http-assets') });
  assert.equal(httpResult.course.url, 'http://example.com/course');
  assert.deepEqual(httpResult.course.allowedHosts, ['example.com', 'www.example.com']);

  const jinbang = await createCustomCourseFromForm({
    name: '金榜学霸',
    summary: '旧 HTTPS 地址自动迁移为站点实际可用的 HTTP。',
    url: 'https://www.jinbangxueba.com',
    imagePath,
  }, { assetDir: path.join(temp, 'jinbang-assets') });
  assert.equal(jinbang.course.url, 'http://www.jinbangxueba.com/');
  assert.deepEqual(jinbang.course.allowedHosts, ['www.jinbangxueba.com', 'jinbangxueba.com']);
  await assert.rejects(
    () => createCustomCourseFromForm({
      name: '带空格的链接',
      summary: '应明确拒绝截图中出现的链接格式。',
      url: 'https: //www.jinbangxueba.com',
      imagePath,
    }, { assetDir: temp }),
    /课程链接不是有效网址/,
  );
});
