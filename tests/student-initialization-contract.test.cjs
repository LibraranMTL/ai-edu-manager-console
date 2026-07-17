const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.tsx'), 'utf8');
const mainProcess = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');

test('saving a student is the single local workspace initialization entry', () => {
  assert.match(source, /保存学生档案并初始化/);
  assert.match(source, /initStudentWorkspace\?\.\(p\.cleanName/);
  assert.match(source, /if \(parsed\.ok === false\)/);
  assert.match(source, /未保存学生档案/);

  assert.match(mainProcess, /function initStudentWorkspace/);
  assert.match(mainProcess, /fs\.writeFileSync\(path\.join\(root, 'AGENT\.md'\)/);
  assert.match(mainProcess, /ensureLearningReportsForStudent\(pseudoStudent\)/);
});

test('duplicate filesystem setup steps are hidden from the optional Agent connection panel', () => {
  assert.match(source, /!\['folder', 'agent', 'execute'\]\.includes\(step\.id\)/);
  assert.match(source, /\{agentConnectionSteps\.map\(\(step\) => \(/);
  assert.match(source, /工具连接（可选）/);
  assert.match(source, /无需再次交给 Agent 执行/);
  assert.match(source, /完整 Agent 连接指令/);
  assert.match(source, /请不要重新创建目录、覆盖 AGENT\.md 或移动已有资料/);
  assert.match(source, /title: step\.id === 'full' \? step\.title : `\$\{index \+ 1\}/);
});
