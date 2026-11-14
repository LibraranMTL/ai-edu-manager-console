'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FIXED_LOCALES = Object.freeze({
  'platform:starfall-k5-math': 'en-US',
  'platform:codeorg-k12-computing': 'en-US',
  'platform:igsce': 'en-GB',
  'tenant:custom-5e20b98a0efe27f02cf2': 'en-GB',
});

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function files(directory) {
  try { return fs.readdirSync(directory, { withFileTypes: true }).filter(item => item.isFile()).map(item => item.name).sort(); }
  catch { return []; }
}

function previewMigration(userDataDir) {
  const root = path.join(path.resolve(userDataDir), 'course-catalog');
  const platform = readJson(path.join(root, 'last-good.json'), { courses: [] });
  const tenant = readJson(path.join(root, 'tenant-custom-courses.json'), { courses: [] });
  const policy = readJson(path.join(root, 'institution-policy.json'), { courseRules: {} });
  const courses = [...(Array.isArray(platform.courses) ? platform.courses : []), ...(Array.isArray(tenant.courses) ? tenant.courses : [])];
  const mapped = courses.map(course => ({
    courseId: String(course.courseId || ''),
    targetCourseId: String(course.courseId || ''),
    locale: FIXED_LOCALES[course.courseId] || '',
    sourceLanguages: Array.isArray(course.languages) ? course.languages : [],
    type: String(course.type || ''),
    launchUrl: String(course.url || ''),
    coverAsset: String(course.coverAsset || ''),
    policyReferenced: Object.hasOwn(policy.courseRules || {}, course.courseId),
    decision: FIXED_LOCALES[course.courseId] ? 'auto_map' : 'needs_handling',
  }));
  const referencedCustomAssets = new Set(mapped.filter(item => item.coverAsset.startsWith('custom-assets/')).map(item => path.basename(item.coverAsset)));
  const customAssets = files(path.join(root, 'custom-assets'));
  return {
    schema: 'edu-manager.public-course-migration-preview.v1',
    sourceRoot: root,
    generatedAt: new Date().toISOString(),
    writePerformed: false,
    decisions: {
      copyrightWorkflow: 'ignored_for_mvp',
      preserveLegalNotice: true,
      preserveCourseIds: true,
      igsceId: 'platform:igsce',
    },
    catalogVersion: String(platform.catalogVersion || ''),
    courses: mapped,
    summary: {
      courseCount: mapped.length,
      autoMapped: mapped.filter(item => item.decision === 'auto_map').length,
      needsHandling: mapped.filter(item => item.decision === 'needs_handling').length,
      policyRuleCount: Object.keys(policy.courseRules || {}).length,
      customAssetCount: customAssets.length,
      orphanCustomAssetCandidates: customAssets.filter(name => !referencedCustomAssets.has(name)),
    },
  };
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node scripts/preview-public-course-migration.cjs <userDataDir> [--output=<file>]');
  const result = previewMigration(input);
  const outputArg = process.argv.slice(3).find(item => item.startsWith('--output='));
  if (outputArg) {
    const target = path.resolve(outputArg.slice('--output='.length));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { previewMigration, FIXED_LOCALES };
