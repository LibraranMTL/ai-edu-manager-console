'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalize } = require('../cloud-report-service/public-content.cjs');

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function verifyPlan(bundleDir) {
  const root = path.resolve(bundleDir);
  const planPath = path.join(root, 'migration-candidate.json');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const expected = String(plan.planSha256 || '');
  const unsigned = { ...plan }; delete unsigned.planSha256;
  if (!/^[a-f0-9]{64}$/.test(expected) || sha256(canonicalize(unsigned)) !== expected) throw new Error('迁移候选计划哈希无效');
  for (const asset of plan.assets || []) {
    const target = path.resolve(root, String(asset.file || ''));
    if (!target.startsWith(`${root}${path.sep}`) || !fs.statSync(target).isFile()) throw new Error(`迁移资源缺失或越界：${asset.file}`);
    const bytes = fs.readFileSync(target);
    if (bytes.length !== Number(asset.bytes) || sha256(bytes) !== asset.sha256 || asset.assetRevisionId !== `asset-rev-${asset.sha256}`) {
      throw new Error(`迁移资源哈希不一致：${asset.assetRevisionId}`);
    }
  }
  return { root, plan };
}

function apiUrl(baseUrl, route, allowHttpForTests) {
  const base = new URL(String(baseUrl || ''));
  if (base.protocol !== 'https:' && !(allowHttpForTests && base.protocol === 'http:')) throw new Error('迁移写入只允许HTTPS候选环境');
  if (base.username || base.password || base.search || base.hash) throw new Error('候选环境地址不能包含账号、查询或片段');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(String(route).replace(/^\/+/, ''), base).toString();
}

async function applyMigration(bundleDir, options = {}) {
  const { root, plan } = verifyPlan(bundleDir);
  if (options.expectedPlanSha256 && options.expectedPlanSha256 !== plan.planSha256) throw new Error('操作人确认的计划SHA-256不匹配');
  const dryRun = options.commit !== true;
  const summary = { schema: 'edu-manager.public-course-migration-apply-receipt.v1', dryRun, planSha256: plan.planSha256,
    releaseId: plan.release.releaseId, courseCount: plan.courseDrafts.length, assetCount: plan.assets.length,
    publicPolicyUpload: false, actions: ['upload_assets', 'save_course_drafts', 'validate_release_candidate'], publishPerformed: false };
  if (dryRun) return summary;
  if (options.expectedPlanSha256 !== plan.planSha256) throw new Error('写入前必须完整确认计划SHA-256');
  const sessionToken = String(options.sessionToken || '').trim();
  if (!/^[A-Za-z0-9_-]{24,256}$/.test(sessionToken)) throw new Error('候选环境管理员会话无效');
  const fetchImpl = options.fetchImpl || fetch;
  async function request(route, body) {
    const response = await fetchImpl(apiUrl(options.baseUrl, route, options.allowHttpForTests), {
      method: 'POST', headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(options.timeoutMs || 30_000),
    });
    const text = await response.text();
    let payload; try { payload = JSON.parse(text); } catch { payload = {}; }
    if (!response.ok) throw new Error(payload.error || `候选环境写入失败：HTTP ${response.status}`);
    return payload;
  }
  const assetReceipts = [];
  for (const asset of plan.assets) {
    const bytes = fs.readFileSync(path.join(root, asset.file));
    const result = await request('/v2/admin/content/assets', { assetId: asset.assetId, mimeType: asset.mimeType, contentBase64: bytes.toString('base64') });
    if (result.assetRevisionId !== asset.assetRevisionId || result.sha256 !== asset.sha256 || Number(result.bytes) !== Number(asset.bytes)) {
      throw new Error(`候选环境资源对账失败：${asset.assetRevisionId}`);
    }
    assetReceipts.push({ assetRevisionId: result.assetRevisionId, sha256: result.sha256, bytes: result.bytes });
  }
  for (const course of plan.courseDrafts) {
    const result = await request('/v2/admin/courses', course);
    if (result.course?.courseId !== course.courseId || result.course?.locale !== course.locale || result.course?.coverAssetRevisionId !== course.coverAssetRevisionId) {
      throw new Error(`候选环境课程草稿对账失败：${course.courseId}`);
    }
  }
  const candidate = await request('/v2/admin/releases/validate', plan.release);
  const expectedCourseIds = [...plan.release.courseIds].sort();
  const actualCourseIds = (candidate.manifest?.courses || []).map(course => course.courseId).sort();
  if (JSON.stringify(actualCourseIds) !== JSON.stringify(expectedCourseIds)) throw new Error('候选清单课程ID对账失败');
  const expectedAssets = new Map(plan.assets.map(asset => [asset.assetRevisionId, asset.sha256]));
  if (!(candidate.manifest?.assets || []).every(asset => expectedAssets.get(asset.assetRevisionId) === asset.sha256)
      || candidate.manifest.assets.length !== expectedAssets.size) throw new Error('候选清单资源对账失败');
  const receipt = { ...summary, dryRun: false, writePerformed: true, validatedAt: new Date().toISOString(),
    manifestRevision: candidate.manifest.manifestRevision, manifestSha256: candidate.manifestSha256,
    courseIds: actualCourseIds, assets: assetReceipts, publishPerformed: false,
    nextAction: '在管理界面逐项复核课程和完整manifestSha256，二次确认后才可发布。' };
  const receiptPath = path.join(root, 'cloud-candidate-receipt.json');
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return receipt;
}

if (require.main === module) {
  const bundleDir = process.argv[2];
  if (!bundleDir) throw new Error('Usage: node scripts/apply-public-course-migration.cjs <bundleDir> [--commit] --base-url=<url> --expected-plan-sha256=<hash>');
  const commit = process.argv.includes('--commit');
  const baseUrl = process.argv.find(value => value.startsWith('--base-url='))?.slice('--base-url='.length);
  const expectedPlanSha256 = process.argv.find(value => value.startsWith('--expected-plan-sha256='))?.slice('--expected-plan-sha256='.length);
  applyMigration(bundleDir, { commit, baseUrl, expectedPlanSha256, sessionToken: process.env.CLOUD_PUBLIC_CONTENT_ADMIN_SESSION })
    .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}

module.exports = { applyMigration, verifyPlan, apiUrl };
