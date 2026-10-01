const test = require('node:test');
const assert = require('node:assert/strict');
const { RULE_VERSION, suggestProjectMaterialClassifications } = require('../electron/project-material-classifier.cjs');

function material(id, relativePath, classification = {}) {
  return { materialId: id, version: 2, recordRevision: 4,
    location: { relativePath }, classification: { categoryId: '', manualLocked: false, ...classification } };
}

test('automatic rules suggest stable category IDs with an explicit human-review reason', () => {
  const index = { categories: [
    { categoryId: 'workspace-slot-01', name: '参考资料', active: true, aliases: [] },
    { categoryId: 'workspace-slot-02', name: '提交成果', active: true, aliases: [] },
  ], materials: [
    material('reference', '收件箱/赛事规则与参考文献.pdf'),
    material('final', '收件箱/最终报告-final.docx'),
    material('unknown', '收件箱/IMG_0001.jpg'),
  ] };
  const result = suggestProjectMaterialClassifications(index);
  assert.equal(result.ruleVersion, RULE_VERSION);
  assert.deepEqual(result.items.map((item) => [item.materialId, item.categoryId]), [
    ['reference', 'workspace-slot-01'], ['final', 'workspace-slot-02'],
  ]);
  assert.ok(result.items.every((item) => item.needsConfirmation && /人工确认/.test(item.reason)));
  assert.ok(result.items.every((item) => item.expectedVersion === 2 && item.expectedRecordRevision === 4));
});

test('automatic rules never overwrite an existing or manually locked classification', () => {
  const index = { categories: [{ categoryId: 'reference', name: '参考资料', active: true }], materials: [
    material('classified', '参考资料/a.pdf', { categoryId: 'reference' }),
    material('locked', '参考资料/b.pdf', { manualLocked: true }),
    material('fresh', '参考资料/c.pdf'),
  ] };
  assert.deepEqual(suggestProjectMaterialClassifications(index).items.map((item) => item.materialId), ['fresh']);
});
