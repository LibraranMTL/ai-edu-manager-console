const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GOVERNANCE_SCHEMA = 'edu-manager.knowledge-governance.v1';

function isPathInside(candidate, root) {
  const target = path.resolve(String(candidate || ''));
  const base = path.resolve(String(root || ''));
  const relative = path.relative(base, target);
  return Boolean(base) && (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)));
}

function collectRecentKnowledgeArtifacts(root, since = '', limit = 300) {
  if (!root || !fs.existsSync(root)) return [];
  const sinceMs = Date.parse(String(since || '')) || 0;
  const found = [];
  const pending = [path.resolve(root)];
  const excluded = new Set(['.git', 'node_modules', '.trash', 'digest-receipts', 'digest-batches']);
  while (pending.length && found.length < limit) {
    const current = pending.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (found.length >= limit) break;
      if (entry.name.startsWith('.') && entry.name !== '.edu-manager') continue;
      if (excluded.has(entry.name)) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }
      if (!entry.isFile() || !/\.(?:md|txt|json|csv)$/i.test(entry.name)) continue;
      if (/^(?:log|index)\.md$/i.test(entry.name)
        || /^绑定学生\.md$/i.test(entry.name)
        || /(消化.{0,8}回执|回执.{0,8}消化|digest.{0,12}(?:receipt|result)|(?:receipt|result).{0,12}digest)/i.test(entry.name)) continue;
      try {
        const stat = fs.statSync(target);
        if (sinceMs && stat.mtimeMs < sinceMs - 1000) continue;
        found.push({ path: target, size: stat.size, modifiedAt: stat.mtime.toISOString() });
      } catch {
        // A concurrently replaced file is picked up in the next run.
      }
    }
  }
  return found;
}

function sourceLinksForArtifact(artifact, resolvedFiles) {
  const direct = resolvedFiles.filter((file) =>
    (file.artifacts || []).some((item) => path.resolve(String(item || '')) === path.resolve(artifact.path)));
  if (direct.length) return direct.map((file) => String(file.materialId || file.relativePath || '')).filter(Boolean);
  if (artifact.size > 1024 * 1024 || !/\.(?:md|txt|json|csv)$/i.test(artifact.path)) return [];
  let text = '';
  try { text = fs.readFileSync(artifact.path, 'utf8').slice(0, 1024 * 1024); } catch { return []; }
  return resolvedFiles
    .filter((file) => {
      const relativePath = String(file.relativePath || '').replace(/\\/g, '/');
      return Boolean(relativePath) && (text.includes(relativePath) || text.includes(path.basename(relativePath)));
    })
    .map((file) => String(file.materialId || file.relativePath || ''))
    .filter(Boolean);
}

function buildKnowledgeGovernanceRun(options = {}) {
  const completedAt = String(options.completedAt || new Date().toISOString());
  const knowledgeRoot = path.resolve(String(options.knowledgeRoot || ''));
  const resolvedFiles = (options.resolvedFiles || []).map((file) => ({
    materialId: String(file.materialId || ''),
    relativePath: String(file.relativePath || ''),
    sha1: String(file.sha1 || ''),
    artifacts: Array.isArray(file.artifacts) ? file.artifacts : [],
  }));
  const artifactMap = new Map();
  for (const item of options.artifacts || []) {
    const file = typeof item === 'string' ? item : item?.path;
    if (!file) continue;
    const absolute = path.resolve(String(file));
    let stat = null;
    try { stat = fs.statSync(absolute); } catch { /* recorded below as missing */ }
    artifactMap.set(absolute.toLowerCase(), {
      path: absolute,
      size: Number(stat?.size || (typeof item === 'object' ? item.size : 0) || 0),
      modifiedAt: stat?.mtime?.toISOString() || (typeof item === 'object' ? String(item.modifiedAt || '') : ''),
      exists: Boolean(stat?.isFile()),
    });
  }
  const artifacts = Array.from(artifactMap.values()).map((artifact) => {
    const insideRoot = isPathInside(artifact.path, knowledgeRoot);
    const sourceMaterialIds = sourceLinksForArtifact(artifact, resolvedFiles);
    const issues = [];
    if (!insideRoot) issues.push('outside_knowledge_root');
    if (!artifact.exists) issues.push('missing_artifact');
    else if (artifact.size <= 0) issues.push('empty_artifact');
    if (!sourceMaterialIds.length) issues.push('source_link_not_detected');
    const riskLevel = issues.some((issue) => ['outside_knowledge_root', 'missing_artifact', 'empty_artifact'].includes(issue))
      ? 'high'
      : issues.length ? 'medium' : 'low';
    return {
      id: `asset-${crypto.createHash('sha1').update(artifact.path.toLowerCase()).digest('hex').slice(0, 16)}`,
      ...artifact,
      relativePath: insideRoot ? path.relative(knowledgeRoot, artifact.path).replace(/\\/g, '/') : '',
      sourceMaterialIds,
      issues,
      riskLevel,
      decision: riskLevel === 'low' ? 'accepted_internal' : riskLevel === 'medium' ? 'monitor' : 'needs_attention',
      hiddenFromDefault: riskLevel === 'low',
    };
  });
  const lowRiskCount = artifacts.filter((item) => item.riskLevel === 'low').length;
  const monitoredCount = artifacts.filter((item) => item.riskLevel === 'medium').length;
  // A batch containing only ignored/invalid materials legitimately produces no
  // knowledge asset. Only require an artifact when at least one material was
  // actually resolved into the knowledge pipeline.
  const missingExpectedArtifact = resolvedFiles.length > 0 && artifacts.length === 0;
  const attentionCount = artifacts.filter((item) => item.riskLevel === 'high').length + (missingExpectedArtifact ? 1 : 0);
  const traceableCount = artifacts.filter((item) => item.sourceMaterialIds.length > 0).length;
  const coverage = artifacts.length ? Math.round(traceableCount / artifacts.length * 100) : 0;
  return {
    schema: GOVERNANCE_SCHEMA,
    runId: `governance-${crypto.createHash('sha1').update(`${options.scopeType}|${options.scopeId}|${options.batchId}`).digest('hex').slice(0, 20)}`,
    scope: { type: String(options.scopeType || ''), id: String(options.scopeId || ''), name: String(options.scopeName || '') },
    batchId: String(options.batchId || ''),
    knowledgeRoot,
    completedAt,
    status: attentionCount ? 'attention' : 'completed',
    stages: [
      { id: 'receipt_validation', status: 'completed', count: resolvedFiles.length },
      { id: 'knowledge_asset_registration', status: missingExpectedArtifact ? 'attention' : 'completed', count: artifacts.length },
      { id: 'digest_analysis', status: 'completed', coverage },
      { id: 'quality_gate', status: attentionCount ? 'attention' : 'completed', attentionCount },
    ],
    analysis: { materialCount: resolvedFiles.length, artifactCount: artifacts.length, traceableCount, coverage },
    quality: { lowRiskCount, monitoredCount, attentionCount },
    artifacts,
  };
}

function governanceMarkdown(run) {
  return `# 知识自动治理结果

- 批次：${run.batchId}
- 范围：${run.scope.type} / ${run.scope.name || run.scope.id}
- 状态：${run.status}
- 已结算资料：${run.analysis.materialCount}
- 新增或更新知识资产：${run.analysis.artifactCount}
- 可追溯资产：${run.analysis.traceableCount}（${run.analysis.coverage}%）
- 默认收起的低风险项：${run.quality.lowRiskCount}
- 内部观察项：${run.quality.monitoredCount}
- 需要处理的异常：${run.quality.attentionCount}

${run.artifacts.map((item) => `- [${item.riskLevel}] ${item.relativePath || item.path}${item.issues.length ? `：${item.issues.join(', ')}` : ''}`).join('\n') || '- 未发现本批更新的知识资产。'}
`;
}

function persistKnowledgeGovernanceRun(managerDir, run) {
  const root = path.join(managerDir, 'knowledge-governance');
  const runsDir = path.join(root, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const safeBatch = String(run.batchId || run.runId).replace(/[^0-9A-Za-z._-]/g, '_');
  const writeAtomic = (file, content) => {
    const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    fs.writeFileSync(temporary, content, 'utf8');
    fs.renameSync(temporary, file);
  };
  const json = `${JSON.stringify(run, null, 2)}\n`;
  writeAtomic(path.join(runsDir, `${safeBatch}.json`), json);
  writeAtomic(path.join(root, 'latest.json'), json);
  writeAtomic(path.join(root, 'latest.md'), governanceMarkdown(run));
  return { root, latestPath: path.join(root, 'latest.json'), reportPath: path.join(root, 'latest.md') };
}

module.exports = {
  GOVERNANCE_SCHEMA,
  buildKnowledgeGovernanceRun,
  collectRecentKnowledgeArtifacts,
  isPathInside,
  persistKnowledgeGovernanceRun,
};
