const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeConversationAsset,
  htmlToConversationText,
  validateConversationShareUrl,
} = require('../electron/conversation-inbox.cjs');

test('conversation analysis extracts bounded topics and an exact project suggestion', () => {
  const result = analyzeConversationAsset(
    '# 无人机单人侦测装置\n今天完成了机械结构建模与测试复盘。',
    [{ id: 'p-uav', name: '无人机单人侦测装置' }, { id: 'p-other', name: '英语写作' }],
  );
  assert.equal(result.suggestedTargetType, 'project');
  assert.deepEqual(result.suggestedProjectIds, ['p-uav']);
  assert.ok(result.topics.includes('科学与工程'));
  assert.ok(result.topics.length <= 4);
  assert.equal(result.schema, 'edu-manager.conversation-topic-analysis.v2');
  assert.equal(result.category, '学习进展与反馈');
  assert.ok(result.keywords.length > 0);
});

test('conversation analysis extracts decisions and action items for filing', () => {
  const result = analyzeConversationAsset(
    '无人机单人侦测装置\n结论：采用新的无人机机架设计。\n下一步：完成三维建模并执行飞行测试。',
    [{ id: 'p-uav', name: '无人机单人侦测装置' }],
  );
  assert.equal(result.suggestedProjectIds[0], 'p-uav');
  assert.match(result.decisions.join(' '), /采用/);
  assert.match(result.actionItems.join(' '), /完成三维建模/);
});

test('HTML share extraction can recover conversation strings embedded in hydration JSON', () => {
  const html = '<title>分享对话</title><script>self.__next_f.push([1,"用户提出加拿大AI创业支持政策问题。助手给出政策清单和下一步行动建议。"])</script>';
  const result = htmlToConversationText(html);
  assert.match(result.content, /加拿大AI创业支持政策/);
  assert.equal(result.extraction, 'embedded_json');
});

test('share URL validation blocks local and non-web targets', () => {
  assert.equal(validateConversationShareUrl('file:///C:/secret.txt').ok, false);
  assert.equal(validateConversationShareUrl('http://127.0.0.1:18777/private').ok, false);
  assert.equal(validateConversationShareUrl('https://chatgpt.com/share/example').ok, true);
});

test('HTML share page extraction removes executable content', () => {
  const result = htmlToConversationText('<title>学习对话</title><script>secret()</script><main><p>用户：今天学习了方程。</p><p>助手：继续练习。</p></main>');
  assert.equal(result.title, '学习对话');
  assert.match(result.content, /今天学习了方程/);
  assert.doesNotMatch(result.content, /secret/);
});
