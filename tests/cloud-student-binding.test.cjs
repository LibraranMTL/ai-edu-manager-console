'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { planCloudStudentBinding } = require('../electron/cloud-student-binding.cjs');

const cloudStudentId = `cs_${'a'.repeat(32)}`;
const envelope = { cloudStudentId, profileRevisionId: `profile_rev_${'b'.repeat(48)}`,
  fields: ['displayName', 'phone'], profile: { displayName: '同名学生', phone: '13800000000' } };

test('cloud student binding is stable by cloud id and never merges by name', () => {
  const empty = planCloudStudentBinding({ students: [], envelope });
  assert.equal(empty.action, 'create');
  assert.match(empty.localStudentId, /^cloud-[a-f0-9]{20}$/);
  assert.equal(planCloudStudentBinding({ students: [{ id: 'local-one', name: '同名学生' }], envelope }).reason,
    'same_name_different_identity');
  const bound = { id: empty.localStudentId, name: '旧显示名', cloudIdentity: { cloudStudentId } };
  const update = planCloudStudentBinding({ students: [bound], envelope });
  assert.equal(update.action, 'update');
  assert.equal(update.localStudentId, empty.localStudentId);
  assert.equal(planCloudStudentBinding({ students: [bound, { ...bound, id: 'duplicate' }], envelope }).reason,
    'duplicate_cloud_binding');
});

test('cloud student binding rejects malformed remote identity and profile revision', () => {
  assert.throws(() => planCloudStudentBinding({ students: [], envelope: { ...envelope, cloudStudentId: '../student' } }), /凭据无效/);
  assert.throws(() => planCloudStudentBinding({ students: [], envelope: { ...envelope, profileRevisionId: 'latest' } }), /凭据无效/);
});
