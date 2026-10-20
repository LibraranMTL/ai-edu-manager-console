'use strict';

const crypto = require('node:crypto');

function planCloudStudentBinding({ students = [], envelope, sanitizeName = value => String(value || '').trim() }) {
  const cloudStudentId = String(envelope?.cloudStudentId || '');
  const profileRevisionId = String(envelope?.profileRevisionId || '');
  const profile = envelope?.profile && typeof envelope.profile === 'object' ? envelope.profile : {};
  if (!/^cs_[a-f0-9]{32}$/.test(cloudStudentId) || !/^profile_rev_[a-f0-9]{48}$/.test(profileRevisionId)) {
    throw new Error('云端学生基础信息凭据无效');
  }
  const cleanName = sanitizeName(profile.displayName || '');
  if (!cleanName) throw new Error('云端学生基础信息缺少姓名或显示名');
  const bound = students.filter(student => String(student.cloudIdentity?.cloudStudentId || '') === cloudStudentId);
  if (bound.length > 1) return { action: 'conflict', reason: 'duplicate_cloud_binding', cloudStudentId, profileRevisionId, cleanName };
  if (bound.length === 1) return { action: 'update', student: bound[0], localStudentId: String(bound[0].id), cloudStudentId, profileRevisionId, cleanName, profile };
  const sameName = students.find(student => sanitizeName(student.name).toLocaleLowerCase('zh-CN') === cleanName.toLocaleLowerCase('zh-CN'));
  if (sameName) return { action: 'conflict', reason: 'same_name_different_identity', candidateLocalStudentId: String(sameName.id), cloudStudentId, profileRevisionId, cleanName };
  return { action: 'create', localStudentId: `cloud-${crypto.createHash('sha256').update(cloudStudentId).digest('hex').slice(0, 20)}`,
    cloudStudentId, profileRevisionId, cleanName, profile };
}

module.exports = { planCloudStudentBinding };
