'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { compactRuntimeSource, compactWindowsRuntime } = require('../scripts/compact-windows-runtime.cjs');
const { resolvePnpmVirtualStore } = require('../scripts/pnpm-virtual-store.cjs');
const pnpm = resolvePnpmVirtualStore(path.resolve(__dirname, '..'));
const esbuild = require(path.join(pnpm, fs.readdirSync(pnpm).find(n => n.startsWith('esbuild@')), 'node_modules/esbuild'));
test('runtime compaction preserves exports, identifiers, strings, regex and legal comments', () => {
  const source = `/*! Example license */
    // removable ordinary comment
    function namedHandler(value) { return value + " 空 格 "; }
    const matcher = /a\\s+b/;
    module.exports = { name: namedHandler.name, text: namedHandler("test"), matches: matcher.test("a b"), template: \`line one\nline two\` };`;
  const compact = compactRuntimeSource(source, esbuild);
  const run = code => { const context = { module: { exports: {} } }; vm.runInNewContext(code, context); return JSON.stringify(context.module.exports); };
  assert.equal(run(compact), run(source));
  assert.match(compact, /Example license/);
  assert.match(compact, /namedHandler/);
  assert.doesNotMatch(compact, /removable ordinary comment/);
  assert.ok(compact.length < source.length);
});
test('stage compaction excludes literal trust policy and non-runtime resources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-compact-runtime-test-'));
  try {
    fs.mkdirSync(path.join(root, 'electron'));
    const source = 'module.exports = { value: 1 };\n';
    for (const name of ['main.cjs', 'license-trust-store.cjs', 'view.js']) fs.writeFileSync(path.join(root, 'electron', name), source);
    const result = compactWindowsRuntime(root, esbuild);
    assert.equal(result.files, 1); assert.ok(result.afterBytes < result.beforeBytes);
    for (const name of ['license-trust-store.cjs', 'view.js']) assert.equal(fs.readFileSync(path.join(root, 'electron', name), 'utf8'), source);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
