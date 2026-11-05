'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { FIXED_LOCALES, previewMigration } = require('./preview-public-course-migration.cjs');
const { canonicalize } = require('../cloud-report-service/public-content.cjs');

const MIN_CLIENT_VERSIONS = Object.freeze({ windowsHost: '0.23.4', windowsStudent: '0.18.7', androidStudent: '0.6.27', androidStandalone: '1.3.5' });

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }

function imageMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  throw new Error('课程封面不是受支持的PNG、JPEG或WebP图片');
}

function safeCoverPath(root, coverAsset) {
  const value = String(coverAsset || '').replaceAll('\\', '/');
  if (!/^(platform-assets|custom-assets)\/[a-f0-9]{64}\.(png|jpg|jpeg|webp)$/.test(value)) throw new Error(`课程封面路径无效：${value}`);
  const target = path.resolve(root, ...value.split('/'));
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('课程封面路径越界');
  return target;
}

function assetId(courseId) { return `asset:migration-${String(courseId).replace(/^(platform|tenant):/, '').replace(/[^a-z0-9-]+/g, '-').slice(0, 100)}-cover`; }

function normalizeCourse(course, coverAssetRevisionId) {
  const courseId = String(course.courseId || '');
  const locale = FIXED_LOCALES[courseId];
  if (!locale) throw new Error(`课程语言尚未锁定：${courseId}`);
  const launchUrl = new URL(String(course.url || ''));
  if (launchUrl.protocol !== 'https:' || launchUrl.username || launchUrl.password) throw new Error(`课程入口不是安全HTTPS地址：${courseId}`);
  const allowedHosts = [...new Set((Array.isArray(course.allowedHosts) ? course.allowedHosts : []).map(value => String(value).trim().toLowerCase()).filter(Boolean))];
  if (!allowedHosts.includes(launchUrl.hostname.toLowerCase())) throw new Error(`课程入口域名未列入允许清单：${courseId}`);
  return {
    courseId,
    sourceCategory: courseId.startsWith('tenant:') ? 'tenant_curated' : 'platform_curated',
    locale,
    title: String(course.name || '').trim(),
    summary: String(course.summary || '').trim(),
    provider: String(course.provider || '').trim(),
    launchUrl: launchUrl.toString(),
    allowedHosts,
    coverAssetRevisionId,
    gradeBands: Array.isArray(course.gradeRange) ? course.gradeRange.map(String) : [],
    ageRange: '',
    legalNotice: String(course.legalNotice || '').trim(),
    accountRequirement: String(course.accountRequirement || '').trim(),
    defaultEnabled: true,
    offlineOpenTtlSeconds: 21600,
    minClientVersions: MIN_CLIENT_VERSIONS,
  };
}

function writeExclusive(filePath, bytes, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes, { flag: 'wx', mode });
}

function prepareMigration(userDataDir, outputDir, options = {}) {
  const courseRoot = path.join(path.resolve(userDataDir), 'course-catalog');
  const targetRoot = path.resolve(outputDir);
  if (fs.existsSync(targetRoot)) throw new Error(`迁移候选目录已存在，拒绝覆盖：${targetRoot}`);
  const preview = previewMigration(userDataDir);
  if (preview.summary.needsHandling !== 0 || preview.summary.courseCount !== 4) throw new Error('只读预览尚未满足4门课程自动迁移门槛');
  const platformPath = path.join(courseRoot, 'last-good.json');
  const tenantPath = path.join(courseRoot, 'tenant-custom-courses.json');
  const policyPath = path.join(courseRoot, 'institution-policy.json');
  const platform = readJson(platformPath);
  const tenant = readJson(tenantPath);
  const policy = readJson(policyPath);
  const sourceCourses = [...(platform.courses || []), ...(tenant.courses || [])];
  const assetsByDigest = new Map();
  const courseDrafts = [];
  const sourceFiles = [platformPath, tenantPath, policyPath].map(filePath => ({
    role: path.basename(filePath), sha256: sha256(fs.readFileSync(filePath)), bytes: fs.statSync(filePath).size,
  }));
  for (const course of sourceCourses) {
    const sourceAssetPath = safeCoverPath(courseRoot, course.coverAsset);
    const bytes = fs.readFileSync(sourceAssetPath);
    const digest = sha256(bytes);
    const declaredDigest = path.basename(sourceAssetPath).split('.')[0];
    if (digest !== declaredDigest) throw new Error(`课程封面文件名哈希与内容不一致：${course.courseId}`);
    const mimeType = imageMime(bytes);
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
    if (!assetsByDigest.has(digest)) assetsByDigest.set(digest, {
      assetId: assetId(course.courseId), assetRevisionId: `asset-rev-${digest}`, sha256: digest, bytes: bytes.length,
      mimeType, file: `assets/${digest}.${extension}`, sourceCategory: String(course.coverAsset).split('/')[0], sourcePath: sourceAssetPath,
    });
    courseDrafts.push(normalizeCourse(course, `asset-rev-${digest}`));
    sourceFiles.push({ role: `cover:${course.courseId}`, sha256: digest, bytes: bytes.length });
  }
  courseDrafts.sort((left, right) => left.courseId.localeCompare(right.courseId, 'en'));
  const assets = [...assetsByDigest.values()].sort((left, right) => left.assetRevisionId.localeCompare(right.assetRevisionId, 'en'));
  const releaseId = String(options.releaseId || '').trim();
  if (!/^release:[A-Za-z0-9._:-]{8,150}$/.test(releaseId)) throw new Error('必须提供稳定且唯一的releaseId');
  const planWithoutHash = {
    schema: 'edu-manager.public-course-migration-candidate.v1', generatedAt: new Date().toISOString(), writePerformed: false,
    sourceCatalogVersion: String(platform.catalogVersion || ''), sourceCourseCount: sourceCourses.length,
    decisions: preview.decisions,
    release: { releaseId, courseIds: courseDrafts.map(course => course.courseId), audienceKey: 'global', audienceRevision: 'audience-global-v1',
      selectionReason: 'current-windows-host-four-course-migration', minClientVersions: MIN_CLIENT_VERSIONS },
    assets: assets.map(({ sourcePath, ...asset }) => asset),
    courseDrafts,
    localPolicy: { file: 'local-policy-plan.private.json', ruleCount: Object.keys(policy.courseRules || {}).length,
      containsStableStudentIds: true, publicUploadForbidden: true },
    orphanAssetCandidates: preview.summary.orphanCustomAssetCandidates,
    fieldDisposition: { subjects: 'not_in_course_mvp_contract', legacyLanguages: 'replaced_by_fixed_locale', policy: 'host_local_only' },
    sourceFiles: sourceFiles.sort((left, right) => left.role.localeCompare(right.role, 'en')),
  };
  const plan = { ...planWithoutHash, planSha256: sha256(canonicalize(planWithoutHash)) };
  fs.mkdirSync(targetRoot, { recursive: false });
  for (const asset of assets) writeExclusive(path.join(targetRoot, asset.file), fs.readFileSync(asset.sourcePath));
  writeExclusive(path.join(targetRoot, 'migration-candidate.json'), `${JSON.stringify(plan, null, 2)}\n`);
  writeExclusive(path.join(targetRoot, 'local-policy-plan.private.json'), `${JSON.stringify({
    schema: 'edu-manager.public-course-local-policy-plan.v1', sourceCatalogVersion: String(platform.catalogVersion || ''),
    publicUploadForbidden: true, courseRules: policy.courseRules || {},
  }, null, 2)}\n`);
  const summary = { outputDir: targetRoot, planSha256: plan.planSha256, releaseId, courseCount: courseDrafts.length,
    assetCount: assets.length, policyRuleCount: Object.keys(policy.courseRules || {}).length,
    orphanAssetCandidateCount: preview.summary.orphanCustomAssetCandidates.length, writePerformed: false };
  writeExclusive(path.join(targetRoot, 'preparation-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (require.main === module) {
  const [userDataDir, outputDir] = process.argv.slice(2).filter(value => !value.startsWith('--'));
  const releaseId = process.argv.slice(2).find(value => value.startsWith('--release-id='))?.slice('--release-id='.length);
  if (!userDataDir || !outputDir || !releaseId) throw new Error('Usage: node scripts/prepare-public-course-migration.cjs <userDataDir> <outputDir> --release-id=<id>');
  process.stdout.write(`${JSON.stringify(prepareMigration(userDataDir, outputDir, { releaseId }), null, 2)}\n`);
}

module.exports = { prepareMigration, normalizeCourse, imageMime };
