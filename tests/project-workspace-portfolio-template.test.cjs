'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('the authoritative template catalog contains the exact portfolio workspace', () => {
  const { listProjectWorkspaceTemplates, projectWorkspaceTemplateFor } = require('../electron/project-workspace-templates.cjs');
  const templates = listProjectWorkspaceTemplates();
  const portfolio = projectWorkspaceTemplateFor('portfolio');
  assert.ok(templates.length >= 7);
  assert.equal(portfolio.id, 'portfolio');
  assert.equal(portfolio.name, '作品集项目');
  assert.deepEqual(portfolio.folders, ['参考资料', '过程文档', '最终成果']);
  assert.notEqual(templates, listProjectWorkspaceTemplates(), 'callers receive isolated arrays');
  assert.throws(() => { portfolio.folders.push('不允许'); }, TypeError);
});

test('main process exposes the catalog and renderer no longer owns a duplicate literal', () => {
  const host = read('electron', 'main.cjs');
  const preload = read('electron', 'preload.cjs');
  const ui = read('src', 'main.tsx');
  assert.match(host, /require\('\.\/project-workspace-templates\.cjs'\)/);
  assert.match(host, /bridge:listProjectWorkspaceTemplates/);
  assert.match(preload, /listProjectWorkspaceTemplates\(\)/);
  assert.doesNotMatch(ui, /const projectWorkspaceTemplates = \[/);
  assert.match(ui, /project-workspace-templates\.json/);
});

test('existing project template application remains add-only for workspace folders', () => {
  const host = read('electron', 'main.cjs');
  const start = host.indexOf('function ensureProjectWorkspace(project)');
  const end = host.indexOf('\nasync function getProjects()', start);
  const body = host.slice(start, end);
  assert.match(body, /fs\.mkdirSync\(dir, \{ recursive: true \}\)/);
  assert.doesNotMatch(body, /renameSync|rmSync|unlinkSync|rmdirSync|copyFileSync|writeFileSync/);
});
