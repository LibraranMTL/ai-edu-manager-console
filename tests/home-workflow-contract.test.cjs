const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

test('host home presents one primary education-material workflow', () => {
  assert.match(renderer, /今日教育资料闭环/);
  assert.match(renderer, /通常只需处理一个下一步/);
  assert.match(renderer, /const runHomePrimaryAction = \(\) =>/);
  assert.match(renderer, /1<\/span><strong>资料进入/);
  assert.match(renderer, /2<\/span><strong>自动消化/);
  assert.match(renderer, /3<\/span><strong>成长沉淀/);
  assert.match(renderer, /4<\/span><strong>档案与报告/);
  assert.match(styles, /\.home-workflow-panel/);
});

test('onboarding and technical tools stay out of the normal daily path', () => {
  assert.match(renderer, /students\.length === 0 \|\| \(homeMode === 'host'/);
  assert.match(renderer, /<details className="home-advanced-tools">/);
  assert.match(renderer, /<summary>高级工具与版本<\/summary>/);
});

test('long-running operations expose a global non-blocking status', () => {
  assert.match(renderer, /const activeBackgroundWork = materialSourceBusyAction/);
  assert.match(renderer, /任务在后台继续，您可以切换到其他页面。/);
  assert.match(renderer, /role="status" aria-live="polite"/);
  assert.match(styles, /\.background-work-banner/);
});
