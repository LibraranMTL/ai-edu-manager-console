const test = require('node:test');
const assert = require('node:assert/strict');
const contract = require('../electron/project-material-contract.cjs');

function material() {
  return {
    projectId: 'p1', materialId: contract.newMaterialId(), version: 1, sha256: 'a'.repeat(64), size: 5,
    location: { kind: 'workspace', rootId: 'workspace', relativePath: '收件箱/样例.pdf' },
    adoption: { state: 'accepted' }, processing: { state: 'pending' },
    classification: { categoryId: '' },
  };
}

test('project material identity is independent of path and content', () => {
  const first = material();
  const second = material();
  assert.notEqual(first.materialId, second.materialId);
  const key = contract.sourceVersionKey('p1', first.materialId, 1);
  first.location.relativePath = '参考资料/改名.pdf';
  assert.equal(contract.sourceVersionKey('p1', first.materialId, 1), key);
  assert.notEqual(contract.sourceVersionKey('p2', first.materialId, 1), key);
  assert.notEqual(contract.sourceVersionKey('p1', first.materialId, 2), key);
});

test('portable paths reject traversal, absolute paths, ADS, device names and aliases', () => {
  for (const value of ['../x', 'a/../x', '/x', 'C:\\a.txt', 'C:x', '\\\\server\\file',
    'x:stream', 'a//b', './a', 'x/./b', 'NUL', 'con.txt', 'COM1.pdf', 'file.', 'file ', 'a\0x', '']) {
    assert.throws(() => contract.relativeMaterialPath(value), { code: 'invalid_path' }, value);
  }
  assert.equal(contract.relativeMaterialPath('参考资料\\实验1.txt'), '参考资料/实验1.txt');
});

test('adoption does not depend on classification or digestion', () => {
  assert.equal(contract.adoptionForImport(), 'accepted');
  assert.equal(contract.adoptionForImport({ intent: 'later' }), 'candidate');
  assert.equal(contract.adoptionForImport({ intent: 'capture', autoAdopt: true }), 'candidate');
  assert.equal(contract.adoptionForImport({ intent: 'discovered', autoAdopt: true, inManagedScope: true }), 'accepted');
  assert.equal(contract.validateMaterial(material(), 'p1').processing.state, 'pending');
});

test('old version completion and cross-project records fail closed', () => {
  const item = material();
  assert.throws(() => contract.validateMaterial(item, 'p2'), { code: 'scope_mismatch' });
  item.version = 2;
  item.processing = { state: 'completed', processedVersion: 1 };
  assert.throws(() => contract.validateMaterial(item, 'p1'), { code: 'stale_processing' });
  item.processing.processedVersion = 2;
  assert.equal(contract.validateMaterial(item, 'p1'), item);
});

test('request keys bind authority, principal, project and request, without delimiter ambiguity', () => {
  const input = { authorityId: 'h1', principalId: 'u1', projectId: 'p1', clientRequestId: 'r1' };
  const original = contract.requestIdentity(input);
  assert.equal(contract.requestIdentity({ ...input }), original);
  for (const field of Object.keys(input)) assert.notEqual(contract.requestIdentity({ ...input, [field]: 'different' }), original);
  assert.notEqual(contract.requestIdentity({ ...input, projectId: 'a|b', clientRequestId: 'c' }),
    contract.requestIdentity({ ...input, projectId: 'a', clientRequestId: 'b|c' }));
});

test('missing capability and teacher label do not grant management authority', () => {
  const grant = { projectId: 'p1', writable: true, role: 'teacher', capabilities: { read: true } };
  assert.throws(() => contract.requireCapability(grant, 'p1', 'classify', { writable: true }), { code: 'forbidden' });
  assert.throws(() => contract.requireCapability(grant, 'p2', 'read'), { code: 'forbidden' });
  grant.capabilities.classify = true;
  contract.requireCapability(grant, 'p1', 'classify', { writable: true });
  grant.writable = false;
  assert.throws(() => contract.requireCapability(grant, 'p1', 'classify', { writable: true }), { code: 'project_readonly' });
});

test('digest deduplication uses version and rules, not mutable file names', () => {
  const input = { projectId: 'p1', materialId: 'm1', version: 1, ruleVersion: 'r1' };
  const key = contract.digestIdentity(input);
  assert.equal(contract.digestIdentity({ ...input, filename: 'renamed.txt' }), key);
  for (const change of [{ version: 2 }, { ruleVersion: 'r2' }, { projectId: 'p2' }, { taskKind: 'classify' }]) {
    assert.notEqual(contract.digestIdentity({ ...input, ...change }), key);
  }
});
