'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { capabilities, providerRoots, scanProvider } = require('../electron/skill-discovery-adapters.cjs');

function createSkill(root, name) {
  const target = path.join(root, name); fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), `---\nname: ${name}\ndescription: synthetic discovery fixture\n---\nbody\n`);
}

test('adapters scan only explicit provider roots and keep QClaw export-only', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-discovery-'));
  createSkill(path.join(home, '.codex', 'skills'), 'codex-safe');
  createSkill(path.join(home, '.codebuddy', 'skills'), 'work-safe');
  createSkill(path.join(home, '.qclaw', 'skills'), 'qclaw-safe');
  createSkill(path.join(home, '.qclaw', 'cache'), 'must-not-scan');
  assert.equal(scanProvider('codex', { homeDir: home }).candidates.length, 1);
  assert.equal(scanProvider('workbuddy', { homeDir: home }).candidates.length, 1);
  const qclaw = scanProvider('qclaw', { homeDir: home });
  assert.equal(qclaw.candidates.length, 1);
  assert.equal(qclaw.candidates[0].identity.name, 'qclaw-safe');
  const qCapability = capabilities('qclaw', { homeDir: home });
  assert.equal(qCapability.canInstallSkill, false);
  assert.equal(qCapability.canRollback, false);
  assert.deepEqual(providerRoots('qclaw', { homeDir: home }).map(item => path.relative(home, item.rootPath)), [path.join('.qclaw', 'skills'), path.join('.qclaw', 'plugin-skills')]);
});
