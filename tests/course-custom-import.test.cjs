const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');
const {
  canImportCustomCourses,
  importCustomCoursesFromExcel,
  writeCustomCourseTemplate,
} = require('../electron/course-custom-import.cjs');

const root = path.resolve(__dirname, '..');

test('custom course Excel import is limited to active PRO and ORG licenses', () => {
  assert.equal(canImportCustomCourses({ active: true, plan: 'PRO' }), true);
  assert.equal(canImportCustomCourses({ active: true, plan: 'ORG' }), true);
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
  assert.deepEqual(course.allowedHosts, ['example.com']);
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
