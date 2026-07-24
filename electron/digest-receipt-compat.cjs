const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { parseDigestReceipt } = require('./digest-receipt.cjs');
const { normalizeDigestResult } = require('./digest-result.cjs');

function receiptBatchId(payload) {
  return String(payload?.digestBatchId || payload?.batchId || '').trim();
}

function isDigestReceiptPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (!receiptBatchId(payload)) return false;
  return ['processed', 'digestedFiles', 'items', 'processedFiles', 'results', 'failed']
    .some((key) => Array.isArray(payload[key]));
}

function receiptFingerprint(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function readReceiptCandidate(file) {
  try {
    if (!fs.statSync(file).isFile()) return null;
    const parsed = parseDigestReceipt(fs.readFileSync(file, 'utf8'));
    if (!parsed.ok || !isDigestReceiptPayload(parsed.value)) return null;
    return {
      file,
      mtimeMs: fs.statSync(file).mtimeMs,
      payload: parsed.value,
      batchId: receiptBatchId(parsed.value),
      fingerprint: receiptFingerprint(parsed.value),
    };
  } catch {
    return null;
  }
}

function directJsonFiles(dir, limit = 200) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => {
        const file = path.join(dir, entry.name);
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(file).mtimeMs; } catch { /* ignored below */ }
        return { file, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, Math.max(1, Math.min(500, Number(limit || 200))))
      .map((entry) => entry.file);
  } catch {
    return [];
  }
}

function pathInside(candidate, root) {
  if (!candidate || !root) return false;
  const relative = path.relative(path.resolve(String(root)), path.resolve(String(candidate)));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function recentKnowledgeTextFiles(root, sinceMs, excludedRoots = [], limit = 300) {
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  const pending = [path.resolve(root)];
  while (pending.length && files.length < limit) {
    const current = pending.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (['.git', '.edu-manager', 'node_modules', '.trash'].includes(entry.name)) continue;
      const target = path.join(current, entry.name);
      if (excludedRoots.some((excluded) => pathInside(target, excluded))) continue;
      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }
      if (!entry.isFile() || !/\.(?:md|txt|json|csv)$/i.test(entry.name)) continue;
      try {
        const stat = fs.statSync(target);
        if (!stat.isFile() || stat.size <= 0 || (sinceMs && stat.mtimeMs < sinceMs - 2000)) continue;
        files.push({ path: target, size: stat.size, mtimeMs: stat.mtimeMs, modifiedAt: stat.mtime.toISOString() });
      } catch {
        // A concurrently replaced file is picked up on the next scan.
      }
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function isMarkdownDigestReceiptName(file) {
  const name = path.basename(String(file || ''));
  return /\.(?:md|txt)$/i.test(name)
    && /(消化.{0,8}回执|回执.{0,8}消化|digest.{0,12}(?:receipt|result)|(?:receipt|result).{0,12}digest)/i.test(name);
}

function discoverSingleFileMarkdownReceipt(options = {}) {
  const batch = options.batch && typeof options.batch === 'object' ? options.batch : {};
  const files = Array.isArray(batch.files) ? batch.files : Array.isArray(batch.submittedFiles) ? batch.submittedFiles : [];
  if (files.length !== 1 || !batch.batchId || !options.knowledgeRoot) return null;
  const submittedAt = String(batch.submittedAt || batch.createdAt || options.submittedAt || '');
  const submittedMs = Date.parse(submittedAt) || 0;
  if (!submittedMs) return null;
  const recentFiles = recentKnowledgeTextFiles(
    options.knowledgeRoot,
    submittedMs,
    [options.rawRoot, options.managerDir].filter(Boolean),
    options.scanLimit,
  );
  const receiptCandidates = recentFiles.filter((item) => isMarkdownDigestReceiptName(item.path));
  const receipt = receiptCandidates.find((item) => {
    let content = '';
    try { content = fs.readFileSync(item.path, 'utf8').slice(0, 1024 * 1024); } catch { return false; }
    const completed = /(消化完成|消化回执|处理完成|已完成|完成消化|status\s*[:：]\s*completed)/i.test(content);
    const correctScope = !batch.scope?.name || content.includes(String(batch.scope.name));
    return completed && correctScope;
  });
  if (!receipt) return null;
  const artifacts = recentFiles
    .filter((item) => item.path !== receipt.path)
    .filter((item) => !isMarkdownDigestReceiptName(item.path))
    .filter((item) => !/^(?:log|index)\.md$/i.test(path.basename(item.path)))
    .filter((item) => !/^绑定学生\.md$/i.test(path.basename(item.path)));
  if (!artifacts.length) return null;
  const source = files[0];
  const completedAt = receipt.modifiedAt || new Date().toISOString();
  const payload = {
    version: 3,
    status: 'completed',
    projectId: String(batch.scope?.type === 'project' ? batch.scope.id : batch.projectId || ''),
    digestBatchId: String(batch.batchId),
    lastDigestAt: completedAt,
    message: '已兼容识别 Agent 生成的单文件 Markdown 消化回执。',
    digestedFiles: [{
      materialId: String(source.materialId || ''),
      relativePath: String(source.relativePath || ''),
      sha1: String(source.sha1 || ''),
      status: 'completed',
      artifacts: artifacts.map((item) => item.path),
    }],
    compatibility: {
      mode: 'single_file_markdown_receipt',
      sourceReceiptPath: receipt.path,
      detectedAt: new Date().toISOString(),
      artifactPaths: artifacts.map((item) => item.path),
    },
  };
  return {
    payload,
    receiptPath: receipt.path,
    artifacts,
    fingerprint: receiptFingerprint(payload),
  };
}

function discoverDigestReceipts(options = {}) {
  const managerDir = String(options.managerDir || '');
  const canonicalFile = String(options.canonicalFile || '');
  const batchId = String(options.batchId || '');
  const archiveRoot = String(options.archiveRoot || path.join(managerDir, 'digest-receipts'));
  const files = new Set([
    ...(canonicalFile ? [canonicalFile] : []),
    // QClaw may choose localized or segmented filenames. Candidate detection is
    // therefore content-based; scanning is bounded to keep large inboxes fast.
    ...directJsonFiles(managerDir, options.scanLimit),
    ...directJsonFiles(path.join(archiveRoot, batchId), options.scanLimit),
  ]);
  const candidates = [];
  const stale = [];
  const fingerprints = new Set();
  for (const file of files) {
    if (!file || !fs.existsSync(file)) continue;
    const candidate = readReceiptCandidate(file);
    if (!candidate || fingerprints.has(candidate.fingerprint)) continue;
    fingerprints.add(candidate.fingerprint);
    if (candidate.batchId === batchId) candidates.push(candidate);
    else stale.push(candidate);
  }
  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
  stale.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return { candidates, stale };
}

function receiptItemKey(item) {
  return [
    String(item?.materialId || ''),
    String(item?.relativePath || '').replace(/\\/g, '/').toLowerCase(),
    String(item?.sha1 || '').toLowerCase(),
  ].join('|');
}

function mergeDigestReceipts(receipts, batch) {
  const normalized = (receipts || []).map((entry) => normalizeDigestResult(entry?.payload || entry, batch));
  const processedByKey = new Map();
  const failedByKey = new Map();
  for (const receipt of normalized) {
    for (const item of receipt.processed || []) {
      const key = receiptItemKey(item);
      if (!key) continue;
      processedByKey.set(key, item);
      failedByKey.delete(key);
    }
    for (const item of receipt.failed || []) {
      const key = receiptItemKey(item);
      if (!key || processedByKey.has(key)) continue;
      failedByKey.set(key, item);
    }
  }
  const last = normalized[normalized.length - 1] || {};
  return {
    schema: last.schema || 'edu-manager.digest-result.v1',
    digestBatchId: String(batch?.batchId || last.digestBatchId || ''),
    studentId: String(batch?.scope?.type === 'student' ? batch.scope.id : ''),
    projectId: String(batch?.scope?.type === 'project' ? batch.scope.id : ''),
    status: normalized.some((receipt) => receipt.status === 'completed') ? 'completed' : 'partial',
    processed: Array.from(processedByKey.values()),
    failed: Array.from(failedByKey.values()),
    completedAt: last.completedAt || '',
    message: normalized.map((receipt) => receipt.message).filter(Boolean).at(-1) || '',
    receiptCount: normalized.length,
  };
}

module.exports = {
  discoverSingleFileMarkdownReceipt,
  discoverDigestReceipts,
  isDigestReceiptPayload,
  mergeDigestReceipts,
  readReceiptCandidate,
  receiptBatchId,
  receiptFingerprint,
};
