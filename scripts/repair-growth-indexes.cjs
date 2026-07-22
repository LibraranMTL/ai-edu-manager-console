const fs = require('node:fs');
const path = require('node:path');

const { writeJsonAtomic } = require('../electron/digest-batch.cjs');
const { buildGrowthIndexV2, parseLegacyGrowthEvidenceMarkdown } = require('../electron/growth-model.cjs');
const { growthIndexNeedsRebuild, growthSourceFingerprint, legacyReportCandidate } = require('../electron/growth-index-consistency.cjs');

const REPORTS = [
  ['profile', '整体画像', '整体画像.md'],
  ['changes', '历史变化', '历史变化.md'],
  ['daily', '每周行动建议', '每日行动建议.md'],
  ['stage', '阶段总结', '阶段总结.md'],
];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')); } catch { return fallback; }
}

function copySnapshot(files, target, metadata) {
  fs.mkdirSync(target, { recursive: true });
  const copied = [];
  for (const source of files) {
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const backup = `${copied.length + 1}-${path.basename(source)}`;
    fs.copyFileSync(source, path.join(target, backup));
    copied.push({ source, backup });
  }
  writeJsonAtomic(path.join(target, 'manifest.json'), { version: 1, createdAt: new Date().toISOString(), ...metadata, files: copied });
}

function markdownFor(index) {
  return `# ${index.studentName} 成长模型结构化索引\n\n生成时间：${index.updatedAt}\n\n| 指标 | 数量 |\n| --- | ---: |\n| 成长证据 | ${index.summary.evidenceCount} |\n| 已确认 | ${index.summary.confirmedCount} |\n| 待审核 | ${index.summary.pendingCount} |\n| 能力维度 | ${index.summary.abilityCount} |\n| 关联项目 | ${index.summary.projectCount} |\n\n> 此索引由修复工具依据成长证据审核台账重建；历史学情报告只登记为待核验候选。\n`;
}

function main() {
  const apply = process.argv.includes('--apply');
  const userData = process.env.EDU_USER_DATA || path.join(process.env.APPDATA || '', 'edu-manager-launcher');
  const studentsRaw = readJson(path.join(userData, 'students.json'), []);
  const projectsRaw = readJson(path.join(userData, 'projects.json'), []);
  const students = Array.isArray(studentsRaw) ? studentsRaw : studentsRaw.students || [];
  const projects = (Array.isArray(projectsRaw) ? projectsRaw : projectsRaw.projects || []);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const results = [];

  for (const student of students) {
    const growthDir = path.join(student.summaryPath || '', '成长模型');
    const reportDir = path.join(student.summaryPath || '', '学情报告');
    const reviewFile = path.join(growthDir, '成长证据审核.json');
    const indexFile = path.join(growthDir, 'growth-index.json');
    const indexMd = path.join(growthDir, 'growth-index.md');
    const evidenceMd = path.join(growthDir, '成长证据.md');
    const review = readJson(reviewFile, { version: 1, candidates: [] });
    review.candidates = Array.isArray(review.candidates) ? review.candidates : [];
    const knownIds = new Set(review.candidates.map((item) => String(item.id || '')));
    const knownEvidenceKeys = new Set(review.candidates.map((item) => `${item.title || ''}|${item.sourcePath || ''}|${item.ability || ''}`));
    const knownSources = new Set(review.candidates.map((item) => String(item.migratedFrom || '')));
    let importedReports = 0;
    let importedLegacyEvidence = 0;

    if (fs.existsSync(evidenceMd)) {
      for (const item of parseLegacyGrowthEvidenceMarkdown(fs.readFileSync(evidenceMd, 'utf8'), evidenceMd)) {
        const key = `${item.title || ''}|${item.sourcePath || ''}|${item.ability || ''}`;
        if (knownIds.has(item.id) || knownEvidenceKeys.has(key)) continue;
        review.candidates.push({ ...item, studentId: student.id, studentName: student.name });
        knownIds.add(item.id);
        knownEvidenceKeys.add(key);
        importedLegacyEvidence += 1;
      }
    }
    for (const [reportId, title, fileName] of REPORTS) {
      const sourcePath = path.join(reportDir, fileName);
      if (!fs.existsSync(sourcePath) || knownSources.has(sourcePath)) continue;
      const candidate = legacyReportCandidate({ studentId: student.id, reportId, title, sourcePath, content: fs.readFileSync(sourcePath, 'utf8') });
      if (!candidate) continue;
      const timestamp = fs.statSync(sourcePath).mtime.toISOString();
      review.candidates.push({ ...candidate, studentId: student.id, studentName: student.name, createdAt: timestamp, updatedAt: timestamp });
      knownSources.add(sourcePath);
      importedReports += 1;
    }

    const relatedProjects = projects.filter((project) => (project.studentIds || []).map(String).includes(String(student.id)));
    const fingerprint = growthSourceFingerprint(review, relatedProjects);
    const previous = readJson(indexFile, {});
    const stale = growthIndexNeedsRebuild(previous, fingerprint) || importedReports > 0 || importedLegacyEvidence > 0;
    let backupPath = '';
    if (apply && stale) {
      backupPath = path.join(userData, 'growth-recovery', `${stamp}-${String(student.name || student.id).replace(/[<>:"/\\|?*]/g, '_')}-${student.id}`);
      copySnapshot([path.join(userData, 'projects.json'), reviewFile, indexFile, indexMd, evidenceMd, ...REPORTS.map((item) => path.join(reportDir, item[2]))], backupPath, { reason: 'manual-p0-repair', studentId: student.id, studentName: student.name });
      fs.mkdirSync(growthDir, { recursive: true });
      if (importedReports || importedLegacyEvidence || !fs.existsSync(reviewFile)) writeJsonAtomic(reviewFile, { version: 1, updatedAt: new Date().toISOString(), candidates: review.candidates });
      const index = buildGrowthIndexV2({ student, growthDir, review, projects: relatedProjects, sourceFiles: { evidenceReview: reviewFile, evidenceMd }, migration: { legacyEvidenceImported: importedLegacyEvidence, legacyReportCandidatesImported: importedReports } });
      index.sourceFingerprint = fingerprint;
      writeJsonAtomic(indexFile, index);
      fs.writeFileSync(indexMd, markdownFor(index), 'utf8');
    }
    results.push({ studentId: student.id, studentName: student.name, stale, importedReports, importedLegacyEvidence, before: previous.summary || null, afterEvidenceCount: review.candidates.length, backupPath });
  }
  console.log(JSON.stringify({ ok: true, mode: apply ? 'apply' : 'dry-run', userData, results }, null, 2));
}

main();
