'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildRuntimeFromDescriptor,
  prepareQualification,
  persistQualification,
} = require('../scripts/prepare-p0-workbuddy-research-qualification.cjs');

function temporaryFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-p0-research-qualification-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, 'package');
  const cliPath = path.join(packageRoot, 'dist', 'codebuddy.js');
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  fs.writeFileSync(cliPath, 'synthetic workbuddy cli');
  fs.writeFileSync(path.join(packageRoot, 'product.json'), '{}');
  const authRoot = path.join(root, 'profile');
  fs.mkdirSync(path.join(authRoot, '.workbuddy'), { recursive: true });
  return { root, descriptor: { version: 9, root: authRoot, cliPath } };
}

test('research qualification runtime reuses only the authorized official CLI profile', t => {
  const { descriptor } = temporaryFixture(t);
  const runtime = buildRuntimeFromDescriptor(descriptor, { nodePath: process.execPath });
  assert.equal(runtime.available, true);
  assert.equal(runtime.mode, 'node');
  assert.equal(runtime.cliPath, path.resolve(descriptor.cliPath));
  assert.equal(runtime.configDir, path.join(path.resolve(descriptor.root), '.workbuddy'));
  assert.equal(runtime.authRoot, path.resolve(descriptor.root));
  assert.equal(runtime.authVersion, 9);
  assert.equal(runtime.productConfigPath, path.join(path.dirname(path.dirname(path.resolve(descriptor.cliPath))), 'product.json'));
});

test('qualification adds the exact auth scope and persists it only in the isolated task fixture', async t => {
  const { root, descriptor } = temporaryFixture(t);
  const tasksFile = path.join(root, 'fixture', 'tasks.json');
  fs.mkdirSync(path.dirname(tasksFile), { recursive: true });
  fs.writeFileSync(tasksFile, JSON.stringify({ runtime: {}, tasks: [] }));
  const qualification = await prepareQualification(descriptor, {
    nodePath: process.execPath,
    verify: async ({ runtime }) => ({ ready: true, profile: 'research.v1', runtimeHash: 'verified-hash',
      measuredAt: '2026-11-01T00:00:00.000Z', expiresAt: '2026-11-01T00:30:00.000Z',
      sourceCount: 1, observedCli: runtime.cliPath }),
  });
  assert.equal(qualification.authScope, JSON.stringify([path.join(path.resolve(descriptor.root), '.workbuddy'), 9]));
  persistQualification(tasksFile, qualification);
  const stored = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
  assert.deepEqual(stored.runtime.agentQualifications.workbuddy['research.v1'], qualification);
  assert.equal(fs.existsSync(path.join(descriptor.root, 'tasks.json')), false);
});

