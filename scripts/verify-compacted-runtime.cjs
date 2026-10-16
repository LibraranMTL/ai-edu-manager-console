'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
async function verify(before, after) {
  const roots = [before, after].map(r => path.join(r, 'electron'));
  const [oldMath, newMath] = await Promise.all(roots.map(r => import(pathToFileURL(path.join(r, 'practice-rich-text.mjs')).href)));
  const cases = ['', '# 学习卡片\n中文 English العربية 😀', '$x^2 + y^2 = z^2$', '$$\\frac{1}{2} + \\sqrt{3}$$',
    '| 名称 | 数值 |\n| --- | --- |\n| 分数 | $\\frac{2}{3}$ |', '<script>alert(1)</script>', '$\\href{javascript:alert(1)}{x}$',
    '$\\badMacro{a}$', '1. first\n2. second\n\n```\n<script> & quote\n```'];
  for (const input of cases) assert.equal(newMath.renderPracticeMarkdown(input), oldMath.renderPracticeMarkdown(input));
  assert.equal(newMath.practiceRichCss, oldMath.practiceRichCss);
  const [oldCourses, newCourses] = roots.map(r => require(path.join(r, 'course-custom-import.cjs')));
  assert.deepEqual(Object.keys(newCourses), Object.keys(oldCourses));
  for (const license of [{ active: false }, { active: true, plan: 'FAMILY' }, { active: true, plan: 'PRO' }, { active: true, plan: 'ORG' }])
    assert.equal(newCourses.canImportCustomCourses(license), oldCourses.canImportCustomCourses(license));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-compact-runtime-'));
  for (const [label, builder] of [['old', oldCourses], ['new', newCourses]]) {
    const file = path.join(temp, label + '.xlsx'); await builder.writeCustomCourseTemplate(file);
    const workbook = new (require('exceljs').Workbook)(); await workbook.xlsx.readFile(file);
    workbook.getWorksheet('课程导入').addRow(['压缩回归课程', 'https://example.com/cover.png', '中文 Excel 解析验收', 'https://example.com/course']);
    await workbook.xlsx.writeFile(file);
    assert.deepEqual(await newCourses.readCustomCourseWorkbook(file), await oldCourses.readCustomCourseWorkbook(file));
  }
  return { passed: true, mathCases: cases.length, cssIdentical: true, courseExportsAndLicenseGatesIdentical: true, excelTemplateCrossReadIdentical: true, temp };
}
if (require.main === module) verify(path.resolve(process.argv[2]), path.resolve(process.argv[3])).then(result => {
  if (process.argv[4]) fs.writeFileSync(path.resolve(process.argv[4]), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
}).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { verify };
