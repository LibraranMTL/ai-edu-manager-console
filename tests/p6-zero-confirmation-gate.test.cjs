const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const mainProcess = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const reportPublish = fs.readFileSync(path.join(root, 'electron', 'report-auto-publication.cjs'), 'utf8');

test('first-use home has one primary next action and no technical setup prerequisite', () => {
  const homeStart = main.indexOf('今日教育资料闭环');
  const homeEnd = main.indexOf('<details className="home-advanced-tools">', homeStart);
  const home = main.slice(homeStart, homeEnd);
  assert.match(home, /homePrimaryAction\.label/);
  assert.equal((home.match(/home-primary-action/g) || []).length, 1);
  assert.doesNotMatch(home, /MCP|JSON|SHA|事务|适配器|选择 Agent/);
});

test('normal digest completion and report publication do not request confirmation', () => {
  const digestStart = main.indexOf('const startDigestWorkflowFromPage');
  const digestEnd = main.indexOf('\n  const ', digestStart + 20);
  const digestFlow = main.slice(digestStart, digestEnd);
  assert.doesNotMatch(digestFlow, /window\.confirm/);
  assert.match(mainProcess, /digest_result_auto_accepted/);
  assert.match(mainProcess, /approval: \{ required: false/);
  assert.doesNotMatch(reportPublish, /window\.confirm|reviewer|approval/i);
});

test('ordinary exceptions are summarized as one needs-supplement action', () => {
  assert.match(main, /查看需要补充的内容/);
  assert.match(main, /其余任务不受影响/);
  assert.match(main, /setProjectDashboardFocus\('risks'\)/);
});
