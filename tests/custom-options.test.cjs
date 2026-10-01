'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { subjects, tool, createCustomOptions } = require('../electron/custom-options.cjs');
test('custom subjects validate literal keywords and duplicate or reserved names', () => {
  assert.deepEqual(subjects([{ name: 'IB经济', keywords: ['Econ', '经济', '经济'] }]), [{ name: 'IB经济', keywords: ['Econ', '经济'] }]);
  for (const items of [[{ name: '全部学科', keywords: ['a'] }], [{ name: 'a', keywords: [] }], [{ name: 'a', keywords: ['a'] }, { name: 'A', keywords: ['b'] }]]) assert.throws(() => subjects(items));
});
test('tool validation rejects scripts, credentials, network executables and shell commands', () => {
  assert.equal(tool({ name: '自定义', kind: 'web', target: 'https://example.com/chat' }).kind, 'web');
  for (const target of ['https://a:b@example.com', 'javascript:alert(1)', 'http://example.com']) assert.throws(() => tool({ name: 'a', kind: 'web', target }));
  for (const target of ['cmd /c calc', 'D:\\a.ps1', '\\\\server\\a.exe']) assert.throws(() => tool({ name: 'a', kind: 'exe', target }));
});
test('student-specific storage isolates subjects and custom launches do not grant automatic capability', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'custom-options-'));
  let opened;
  const api = createCustomOptions({ toolsDir: path.join(root, 'tools'), resolveStudentDir: async id => { if (!['a', 'b'].includes(id)) throw Error('not allowed'); return path.join(root, id); }, launchWeb: async url => { opened = url; } });
  try {
    await api.saveSubjects('a', [{ name: '机器人', keywords: ['robot'] }]);
    assert.equal((await api.getSubjects('a')).length, 1); assert.deepEqual(await api.getSubjects('b'), []);
    await assert.rejects(api.getSubjects('../a'));
    const [saved] = await api.addTool({ name: 'Test', kind: 'web', target: 'https://example.com/' });
    assert.equal(saved.webResearch, false); assert.equal(saved.structuredTasks, false);
    await api.openTool(saved.id); assert.equal(opened, saved.target);
    await assert.rejects(api.addTool({ name: 'test', kind: 'web', target: 'https://example.org/' }));
    await api.removeTool(saved.id); await assert.rejects(api.openTool(saved.id));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
