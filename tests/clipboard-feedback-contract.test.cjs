const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('clipboard bridge verifies writes without blocking the renderer', () => {
  assert.match(preload, /copyText\(value\) \{\s*return ipcRenderer\.invoke\('bridge:copyText', value\);/);
  assert.match(main, /ipcMain\.handle\('bridge:copyText'/);
  assert.match(main, /clipboard\.writeText\(text\)/);
  assert.match(main, /clipboard\.readText\(\)/);
  assert.match(main, /return JSON\.stringify\(\{ ok: verified/);
  assert.match(ui, /const raw = await bridge\(\)\?\.copyText\?\.\(value\)/);
});

test('all renderer clipboard writes pass through one feedback helper', () => {
  const directBridgeWrites = ui.match(/bridge\(\)\?\.copyText/g) || [];
  assert.equal(directBridgeWrites.length, 2);
  const helper = ui.match(/const copyText = async[\s\S]*?\n  const exportBundle =/)?.[0] || '';
  assert.equal((helper.match(/bridge\(\)\?\.copyText/g) || []).length, 2);
  assert.match(ui, /clipboard-toast/);
  assert.match(ui, /内容预览：/);
  assert.match(ui, /已写入系统剪贴板/);
  assert.match(ui, /资料消化指令（交给/);
  assert.match(ui, /preview: false/);
});
