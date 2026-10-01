'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { cloudRequestUrl } = require('./cloud-endpoint.cjs');
const { reportHasSubstantiveContent } = require('./education-archive-version.cjs');

const REPORTS = [
  { filename: '整体画像.md', type: 'learning_profile' },
  { filename: '历史变化.md', type: 'learning_change' },
  { filename: '每日行动建议.md', type: 'weekly_action' },
  { filename: '阶段总结.md', type: 'stage_summary' },
];
const FORMAL = new Set(['active', 'published', 'current', 'updated']);
const MAX_BYTES = 2 * 1024 * 1024;
const TYPE_ALIASES = {
  learning_profile: ['learning_profile', '整体画像'],
  learning_change: ['learning_change', 'learning_changes', '历史变化'],
  weekly_action: ['weekly_action', '每日行动建议', '每周行动建议'],
  stage_summary: ['stage_summary', 'learning_stage', '阶段总结'],
};
const LOCAL_PATHS = /(?:file:\/\/[^\r\n`\])"<>]+|(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\r\n`\])"<>]+|\\\\[^\\\s]+\\[^\r\n`\])"<>]+|\/(?:Users|home)\/[^\r\n`\])"<>]+)/g;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function frontmatter(content) {
  const match = String(content).match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([a-z_]+):\s*(.*?)\s*$/i);
    if (pair) result[pair[1].toLowerCase()] = pair[2].replace(/^["']|["']$/g, '');
  }
  return result;
}

function inspectMetadata(content, localStudentId, expectedType) {
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) return { ok: false, reason: '报告超过 2MB' };
  const meta = frontmatter(content);
  const declared = [meta.type, meta.report_type].filter(Boolean);
  const aliases = TYPE_ALIASES[expectedType] || [];
  // Current weekly reports may have no type field, but must have exact ownership,
  // a dated publication and a growth fingerprint in the trusted report directory.
  const weeklyLegacy = !declared.length && expectedType === 'weekly_action' && meta.student_id === localStudentId &&
    Boolean(meta.growth_fingerprint) && /^\d{4}-\d{2}-\d{2}$/.test(meta.date || '');
  if ((!declared.length && !weeklyLegacy) || declared.some(type => !aliases.includes(type))) return { ok: false, reason: '报告类型与文件名不一致' };
  if (!FORMAL.has(String(meta.status || '').toLowerCase())) return { ok: false, reason: '尚非正式报告' };
  if (meta.student_id && meta.student_id !== localStudentId) return { ok: false, reason: '报告学生归属不一致' };
  if (!/^\d{4}-\d{2}-\d{2}/.test(meta.updated || '')) return { ok: false, reason: '缺少正式更新时间' };
  if (!reportHasSubstantiveContent(content)) return { ok: false, reason: '仍是占位报告' };
  return { ok: true, sourceStatus: meta.status.toLowerCase(), publishedAt: meta.updated };
}

function inspectPublishedReport(content, localStudentId, expectedType) {
  const checked = inspectMetadata(content, localStudentId, expectedType);
  if (!checked.ok) return checked;
  if (new RegExp(LOCAL_PATHS.source).test(content)) {
    return { ok: false, reason: '报告包含本机绝对路径，需先去敏' };
  }
  return checked;
}

function projectPublishedReport(content, localStudentId, expectedType) {
  const checked = inspectMetadata(content, localStudentId, expectedType);
  if (!checked.ok) return checked;
  const header = String(content).match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  const metadata = header[1].replace(/^type:[ \t]*[^\r\n]*(?:\r?\n)?/im, '');
  const canonical = `---\ntype: ${expectedType}\n${metadata.trim()}\n---\n\n${content.slice(header[0].length)}`;
  const projected = canonical.replace(LOCAL_PATHS, '[本机来源路径已移除]');
  const removedPaths = projected !== canonical;
  const result = inspectPublishedReport(projected, localStudentId, expectedType);
  if (!result.ok) return result;
  return { ...result, content: projected, removedPaths, projectionVersion: 'cloud-report-projection.v1' };
}

async function snapshotPublishedReports({ reportDir, localStudentId, cloudStudentId }) {
  if (!reportDir || !localStudentId || !cloudStudentId) throw new Error('缺少学生目录或精确绑定');
  const root = path.resolve(reportDir);
  const dirStat = await fs.lstat(root);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error('学情报告目录不是可信目录');
  const ready = [];
  const skipped = [];
  for (const report of REPORTS) {
    const filename = path.join(root, report.filename);
    let stat;
    try { stat = await fs.lstat(filename); }
    catch (error) {
      if (error.code === 'ENOENT') { skipped.push({ filename: report.filename, reason: '文件不存在' }); continue; }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) {
      skipped.push({ filename: report.filename, reason: '文件类型或大小无效' }); continue;
    }
    const content = await fs.readFile(filename, 'utf8');
    const checked = projectPublishedReport(content, localStudentId, report.type);
    if (!checked.ok) { skipped.push({ filename: report.filename, reason: checked.reason }); continue; }
    const hash = sha256(checked.content);
    ready.push({ cloudStudentId, localStudentId, originPlatform: 'windows', reportType: report.type,
      sourceStatus: checked.sourceStatus, publishedAt: checked.publishedAt,
      sourceSha256: sha256(content), contentSha256: hash, filename: report.filename, content: checked.content,
      projectionVersion: checked.projectionVersion, removedLocalPaths: checked.removedPaths });
  }
  return { ready, skipped };
}

async function uploadPublishedReports({ serverUrl, deviceToken, reportDir, localStudentId, cloudStudentId, signal, proof, knownHashes = {} }) {
  if (!/^https:\/\//.test(serverUrl) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/.test(serverUrl)) {
    throw new Error('云端地址必须使用 HTTPS；仅允许本机 HTTP 测试');
  }
  const snapshot = await snapshotPublishedReports({ reportDir, localStudentId, cloudStudentId });
  const uploaded = [];
  const unchanged = [];
  const hashes = { ...knownHashes };
  let receipts = [], serverVerifiedAt = 0;
  const matching = snapshot.ready.filter(report => hashes[report.reportType] === report.contentSha256);
  if (matching.length) {
    const route = '/v1/reports/check';
    const body = JSON.stringify({ cloudStudentId, reports: matching.map(({ reportType,contentSha256 }) => ({ reportType,contentSha256 })) });
    const response = await fetch(cloudRequestUrl(serverUrl, route), { redirect: 'error', method: 'POST', headers: { authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json', ...(proof?.('POST', route, body) || {}) }, body, signal: signal || AbortSignal.timeout(15000) });
    if (response.ok) {
      const data = await response.json();
      if (data.cloudStudentId !== cloudStudentId || !Array.isArray(data.receipts) || data.receipts.length !== matching.length || matching.some(report => !data.receipts.some(item => item.reportType === report.reportType && item.contentSha256 === report.contentSha256 && ['active','withdrawn','missing'].includes(item.status) && (item.status === 'missing' || /^rev_[a-f0-9]{48}$/.test(item.revisionId || ''))))) throw Error('云端报告核对回执无效，未确认同步');
      receipts = data.receipts; serverVerifiedAt = Date.now();
    } else if (response.status !== 404) throw Object.assign(Error(`云端报告回执核对失败（HTTP ${response.status}）`), { status: response.status });
    // Older services fall back to server-side idempotent POST, never trust a local hash alone.
  }
  for (const report of snapshot.ready) {
    const receipt = receipts.find(item => item.reportType === report.reportType && item.contentSha256 === report.contentSha256);
    if (receipt?.status === 'active') { unchanged.push({ filename: report.filename, revisionId: receipt.revisionId, serverConfirmed: true }); continue; }
    if (receipt?.status === 'withdrawn') { snapshot.skipped.push({ filename: report.filename, reason: '云端已撤回此修订，未重新发布' }); continue; }
    const body = JSON.stringify(report);
    const response = await fetch(cloudRequestUrl(serverUrl, '/v1/reports'), {
      redirect: 'error',
      method: 'POST',
      headers: { authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json', ...(proof?.('POST', '/v1/reports', body) || {}) },
      body,
      signal: signal || AbortSignal.timeout(15000),
    });
    if (response.status === 410) { hashes[report.reportType] = report.contentSha256; snapshot.skipped.push({ filename: report.filename, reason: '云端已撤回此修订' }); continue; }
    if (!response.ok) throw Object.assign(new Error(`云端拒绝报告上传（HTTP ${response.status}）`), { status: response.status });
    const data = await response.json();
    if (!/^rev_[a-f0-9]{48}$/.test(data.revisionId || '') || typeof data.duplicate !== 'boolean') throw Error('上传回执无效，结果未确认，请核对云端');
    hashes[report.reportType] = report.contentSha256; serverVerifiedAt = Date.now();
    uploaded.push({ filename: report.filename, ...data });
  }
  return { uploaded, skipped: snapshot.skipped, unchanged, readyCount: snapshot.ready.length, hashes, serverVerifiedAt };
}

module.exports = { REPORTS, frontmatter, inspectPublishedReport, projectPublishedReport, snapshotPublishedReports, uploadPublishedReports };
