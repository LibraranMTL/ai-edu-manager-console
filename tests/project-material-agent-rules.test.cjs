const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');

test('workspace projects keep a controlled AGENT.md block for unified originals and human-reviewed organization', () => {
  assert.match(main, /EDU-MANAGER:PROJECT-MATERIAL-RULES:START/);
  assert.match(main, /统一原件/);
  assert.match(main, /AI负责提出整理建议，人工保留控制权/);
  assert.match(main, /默认只写逻辑分类/);
  assert.match(main, /采用、分类、知识、贡献相互独立/);
  assert.match(main, /知识维度不是文件夹分类/);
  assert.match(main, /reconcileProjectMaterialAgentRules\(normalized, paths\.agentPath\)/);
});
