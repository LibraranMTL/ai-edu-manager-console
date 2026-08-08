const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const androidRoot = path.join(root, 'android-standalone-manager');
const baselineSource = fs.readFileSync(
  path.join(androidRoot, 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'ProtocolBaseline.kt'),
  'utf8',
);
const manifest = fs.readFileSync(path.join(androidRoot, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(
  path.join(androidRoot, 'app', 'src', 'test', 'resources', 'windows-w0-baseline.json'),
  'utf8',
));

const { TASK_PROTOCOL_VERSION } = require('../electron/task-protocol.cjs');
const { KNOWLEDGE_ENGINE_CONTRACT_VERSION } = require('../electron/knowledge-engine-contract.cjs');
const { COURSE_CAPTURE_SCHEMA } = require('../electron/course-catalog.cjs');
const { COURSE_PACKAGE_SCHEMA } = require('../electron/course-package-v2.cjs');
const { CAPTURE_PROTOCOL_VERSION } = require('../electron/capture-protocol.cjs');
const { normalizeMaterialStatus } = require('../electron/material-status.cjs');

function kotlinString(name) {
  const match = baselineSource.match(new RegExp(`const val ${name} = "([^"]+)"`));
  assert.ok(match, `missing Kotlin protocol constant ${name}`);
  return match[1];
}

function kotlinNumber(name) {
  const match = baselineSource.match(new RegExp(`const val ${name} = (\\d+)`));
  assert.ok(match, `missing Kotlin protocol constant ${name}`);
  return Number(match[1]);
}

test('W0 Android constants match the authoritative Windows contracts', () => {
  assert.equal(kotlinString('TASK_PROTOCOL_VERSION'), TASK_PROTOCOL_VERSION);
  assert.equal(kotlinString('KNOWLEDGE_ENGINE_CONTRACT_VERSION'), KNOWLEDGE_ENGINE_CONTRACT_VERSION);
  assert.equal(kotlinString('COURSE_CAPTURE_SCHEMA'), COURSE_CAPTURE_SCHEMA);
  assert.equal(kotlinString('COURSE_PACKAGE_SCHEMA'), COURSE_PACKAGE_SCHEMA);
  assert.equal(kotlinNumber('CAPTURE_PROTOCOL_VERSION'), CAPTURE_PROTOCOL_VERSION);
});

test('W0 keeps the authoritative material states and stable fixture identifiers', () => {
  const states = ['pending_digest', 'submitted', 'digesting', 'processed', 'ignored', 'invalid', 'failed', 'removed'];
  for (const state of states) {
    assert.equal(normalizeMaterialStatus(state), state);
    assert.match(baselineSource, new RegExp(`"${state}"`));
  }
  assert.equal(fixture.student.id, 'student-w0-001');
  assert.equal(fixture.assetIndex.version, 1);
  assert.equal(fixture.assetIndex.assets[0].assetId, 'asset-0123456789abcdef');
  assert.equal(fixture.projectIndex.version, 1);
  assert.deepEqual(fixture.projectIndex.projects[0].studentIds, ['student-w0-001']);
  assert.equal(fixture.taskResult.protocolVersion, TASK_PROTOCOL_VERSION);
  assert.equal(fixture.courseCapture.schema, COURSE_CAPTURE_SCHEMA);
});

test('W0 standalone manifest has no host pairing or broad all-files permissions', () => {
  assert.doesNotMatch(manifest, /MANAGE_EXTERNAL_STORAGE/);
  assert.doesNotMatch(manifest, /ACCESS_WIFI_STATE|CHANGE_WIFI_MULTICAST_STATE/);
  assert.doesNotMatch(manifest, /MANAGE_EXTERNAL_STORAGE|QUERY_ALL_PACKAGES/);
  assert.doesNotMatch(manifest, /host|pair|tailscale/i);
});
