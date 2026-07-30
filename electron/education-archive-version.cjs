const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { reportContentFingerprint } = require('./report-auto-publication.cjs');

const ARCHIVE_SCHEMA = 'edu-manager.education-archive.v1';

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function safeName(value) {
  return String(value || '').replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '_').slice(0, 100) || 'archive';
}

function inside(root, candidate) {
  const base = path.resolve(String(root || ''));
  const target = path.resolve(String(candidate || ''));
  const relative = path.relative(base, target);
  return Boolean(base) && (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)));
}

function replaceFileAtomic(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  const backup = `${target}.restore-backup-${process.pid}`;
  fs.writeFileSync(temporary, content, 'utf8');
  let backedUp = false;
  try {
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      backedUp = true;
    }
    fs.renameSync(temporary, target);
    if (backedUp && fs.existsSync(backup)) fs.unlinkSync(backup);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (backedUp && fs.existsSync(backup) && !fs.existsSync(target)) fs.renameSync(backup, target);
    throw error;
  }
}

function archiveFingerprint({ student, growthIndex = {}, reports = [] }) {
  return sha1(JSON.stringify({
    studentId: String(student?.id || ''),
    growthFingerprint: String(growthIndex.sourceFingerprint || ''),
    reports: reports.map((report) => ({
      id: String(report.id || ''),
      fingerprint: reportContentFingerprint(report.content || ''),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

function archiveSnapshot({ student, growthIndex = {}, reports = [], createdAt = new Date().toISOString() }) {
  const normalizedReports = reports.map((report) => ({
    id: String(report.id || ''),
    title: String(report.title || report.id || '学情报告'),
    fileName: String(report.fileName || path.basename(report.path || '') || `${safeName(report.id)}.md`),
    content: String(report.content || ''),
    fingerprint: reportContentFingerprint(report.content || ''),
  })).sort((a, b) => a.id.localeCompare(b.id));
  const fingerprint = archiveFingerprint({ student, growthIndex, reports: normalizedReports });
  return {
    schema: ARCHIVE_SCHEMA,
    version: 1,
    student: { id: String(student?.id || ''), name: String(student?.name || '') },
    createdAt,
    sourceFingerprint: fingerprint,
    growthFingerprint: String(growthIndex.sourceFingerprint || ''),
    growthIndex,
    reports: normalizedReports,
  };
}

function changeSummary(previous, current) {
  if (!previous) return ['建立首个教育档案版本。'];
  const changes = [];
  if (previous.growthFingerprint !== current.growthFingerprint) changes.push('成长模型依据已更新。');
  const previousReports = new Map((previous.reports || []).map((report) => [report.id, report.fingerprint]));
  for (const report of current.reports || []) {
    if (!previousReports.has(report.id)) changes.push(`新增报告：${report.title}。`);
    else if (previousReports.get(report.id) !== report.fingerprint) changes.push(`更新报告：${report.title}。`);
  }
  return changes.length ? changes : ['无实质变化。'];
}

function archiveMarkdown(snapshot, changes) {
  const summary = snapshot.growthIndex?.summary || {};
  const reports = snapshot.reports.map((report) => `## ${report.title}\n\n${report.content.trim() || '暂无内容'}\n`).join('\n');
  return `# ${snapshot.student.name} 教育档案\n\n档案时间：${snapshot.createdAt}\n\n档案指纹：${snapshot.sourceFingerprint}\n\n## 本次变化\n\n${changes.map((item) => `- ${item}`).join('\n')}\n\n## 成长概览\n\n- 成长证据：${Number(summary.evidenceCount || 0)} 条\n- 已确认：${Number(summary.confirmedCount || 0)} 条\n- 观察中：${Number(summary.watchingCount || 0)} 条\n- 能力维度：${Number(summary.abilityCount || 0)} 个\n- 关联项目：${Number(summary.projectCount || 0)} 个\n\n${reports}`;
}

function writeArchiveVersion(options = {}) {
  const root = path.resolve(String(options.rootDir || ''));
  if (!root) throw new Error('缺少教育档案版本目录。');
  fs.mkdirSync(root, { recursive: true });
  const snapshot = archiveSnapshot(options);
  const latestPath = path.join(root, 'latest.json');
  const latest = fs.existsSync(latestPath) ? JSON.parse(fs.readFileSync(latestPath, 'utf8')) : null;
  if (latest?.sourceFingerprint === snapshot.sourceFingerprint && latest?.versionDir && fs.existsSync(latest.versionDir)) {
    return { ok: true, unchanged: true, versionDir: latest.versionDir, snapshot };
  }
  let previous = null;
  if (latest?.versionDir && inside(root, latest.versionDir)) {
    const previousPath = path.join(latest.versionDir, 'education-archive.json');
    if (fs.existsSync(previousPath)) previous = JSON.parse(fs.readFileSync(previousPath, 'utf8'));
  }
  const changes = changeSummary(previous, snapshot);
  const stamp = snapshot.createdAt.replace(/[:.]/gu, '-');
  const versionId = `${stamp}-${snapshot.sourceFingerprint.slice(0, 10)}`;
  const target = path.join(root, versionId);
  const temporary = path.join(root, `.tmp-${versionId}-${process.pid}`);
  if (!inside(root, target) || !inside(root, temporary)) throw new Error('教育档案版本路径超出允许范围。');
  try {
    fs.mkdirSync(temporary, { recursive: true });
    const files = {
      '教育档案.md': archiveMarkdown(snapshot, changes),
      'education-archive.json': JSON.stringify(snapshot, null, 2),
      '变化摘要.md': `# 变化摘要\n\n${changes.map((item) => `- ${item}`).join('\n')}\n`,
    };
    const manifestFiles = [];
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(temporary, name), content, 'utf8');
      manifestFiles.push({ name, sha1: sha1(content), size: Buffer.byteLength(content, 'utf8') });
    }
    const manifest = {
      schema: ARCHIVE_SCHEMA,
      version: 1,
      versionId,
      studentId: snapshot.student.id,
      createdAt: snapshot.createdAt,
      sourceFingerprint: snapshot.sourceFingerprint,
      growthFingerprint: snapshot.growthFingerprint,
      files: manifestFiles,
    };
    fs.writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    fs.renameSync(temporary, target);
    replaceFileAtomic(latestPath, JSON.stringify({
      schema: ARCHIVE_SCHEMA,
      versionId,
      versionDir: target,
      sourceFingerprint: snapshot.sourceFingerprint,
      createdAt: snapshot.createdAt,
    }, null, 2));
    return { ok: true, unchanged: false, versionId, versionDir: target, manifest, snapshot, changes };
  } catch (error) {
    if (fs.existsSync(temporary) && inside(root, temporary)) fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function validateArchiveVersion(versionDir) {
  const root = path.resolve(String(versionDir || ''));
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, message: '档案版本缺少 manifest。' };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema !== ARCHIVE_SCHEMA) return { ok: false, message: '档案版本协议不受支持。' };
  for (const file of manifest.files || []) {
    const target = path.join(root, safeName(file.name));
    if (!inside(root, target) || !fs.existsSync(target)) return { ok: false, message: `档案文件缺失：${file.name}` };
    if (sha1(fs.readFileSync(target)) !== file.sha1) return { ok: false, message: `档案文件校验失败：${file.name}` };
  }
  return { ok: true, manifest };
}

function restoreArchiveVersion(options = {}) {
  const validation = validateArchiveVersion(options.versionDir);
  if (!validation.ok) return validation;
  const snapshot = JSON.parse(fs.readFileSync(path.join(options.versionDir, 'education-archive.json'), 'utf8'));
  if (String(snapshot.student?.id || '') !== String(options.studentId || '')) return { ok: false, message: '档案版本不属于当前学生。' };
  const writes = [
    { path: options.growthIndexPath, content: JSON.stringify(snapshot.growthIndex || {}, null, 2) },
    ...(snapshot.reports || []).map((report) => ({
      path: options.reportPaths?.[report.id],
      content: String(report.content || ''),
    })),
  ].filter((item) => item.path);
  for (const item of writes) {
    replaceFileAtomic(item.path, item.content);
  }
  return { ok: true, restored: writes.map((item) => item.path), snapshot };
}

module.exports = {
  ARCHIVE_SCHEMA,
  archiveFingerprint,
  archiveSnapshot,
  changeSummary,
  restoreArchiveVersion,
  validateArchiveVersion,
  writeArchiveVersion,
};
