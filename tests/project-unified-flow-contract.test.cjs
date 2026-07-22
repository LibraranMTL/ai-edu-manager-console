const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('unified project review crosses the Electron bridge and keeps growth confirmation manual', () => {
  assert.match(main, /function getProjectUnifiedReview/);
  assert.match(main, /function applyProjectUnifiedReview/);
  assert.match(main, /成长证据仍等待人工确认/);
  assert.match(preload, /getProjectUnifiedReview\(projectId\)/);
  assert.match(preload, /applyProjectUnifiedReview\(projectId\)/);
  assert.match(ui, /本批次处理包/);
  assert.match(ui, /确认本批次/);
});

test('primary project action performs work instead of only scrolling', () => {
  assert.match(ui, /selectedProjectNextStep\.action === 'add'[\s\S]*scanSelectedProjectWorkspace/);
  assert.match(ui, /selectedProjectNextStep\.action === 'digest'[\s\S]*startDigestWorkflowFromPage/);
});

