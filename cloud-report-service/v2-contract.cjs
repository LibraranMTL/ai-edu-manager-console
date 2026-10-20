'use strict';

const crypto = require('node:crypto');

const PROFILE_FIELDS = Object.freeze([
  'displayName', 'grade', 'school', 'learningGoal', 'currentRegion',
  'phone', 'email', 'birthday', 'address', 'guardian',
]);

const MATERIAL_CATEGORIES = Object.freeze([
  'learning_report', 'learning_material', 'topic_suggestion',
  'competition_recommendation', 'learning_card',
]);

const V2_SCOPES = Object.freeze([
  'student_profile.write', 'student_profile.read',
  'material.write', 'material.read',
  'health_record.write', 'health_record.read',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeString(value, max = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : '';
}

function normalizeProfile(input = {}, allowedFields = PROFILE_FIELDS) {
  const allowed = new Set(allowedFields);
  const profile = {};
  for (const field of PROFILE_FIELDS) {
    if (!allowed.has(field)) continue;
    const value = normalizeString(input[field], field === 'guardian' ? 2000 : 500);
    if (value) profile[field] = value;
  }
  if (!profile.displayName) throw Object.assign(new Error('学生基础信息至少需要姓名或显示名'), { status: 400 });
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
    throw Object.assign(new Error('邮箱格式无效'), { status: 400 });
  }
  if (profile.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(profile.birthday)) {
    throw Object.assign(new Error('生日格式无效'), { status: 400 });
  }
  return profile;
}

function checkedFields(fields, { requireDisplayName = true } = {}) {
  const selected = [...new Set((Array.isArray(fields) ? fields : []).map(String))]
    .filter(field => PROFILE_FIELDS.includes(field));
  if (requireDisplayName && !selected.includes('displayName')) selected.unshift('displayName');
  return PROFILE_FIELDS.filter(field => selected.includes(field));
}

function checkedCategories(categories) {
  const selected = new Set((Array.isArray(categories) ? categories : []).map(String));
  return MATERIAL_CATEGORIES.filter(category => selected.has(category));
}

function profileRevisionId(studentId, profile, fields) {
  return `profile_rev_${sha256(stableJson({ studentId, profile, fields })).slice(0, 48)}`;
}

module.exports = {
  MATERIAL_CATEGORIES,
  PROFILE_FIELDS,
  V2_SCOPES,
  checkedCategories,
  checkedFields,
  normalizeProfile,
  profileRevisionId,
  sha256,
  stableJson,
};
