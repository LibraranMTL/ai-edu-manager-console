const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { canonicalPath, samePath } = require('./project-workspace.cjs');

const SCHEMA_FOLDERS = {
  rawPath: ['项目原始资料库', '原始资料库'],
  conceptPath: ['概念库'],
  entityPath: ['实体库'],
  summaryPath: ['摘要库'],
  qaPath: ['问答精华库', '问答库'],
  synthesisPath: ['综合汇总库', '综合库'],
};

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function firstMatchingDirectory(root, names, suffixMatch = false) {
  const entries = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()) : [];
  const found = entries.find((entry) => names.includes(entry.name) || (suffixMatch && names.some((name) => entry.name.endsWith(name))));
  return found ? path.join(root, found.name) : '';
}

function scanProjectKnowledgeBase(rootPath, projects = []) {
  const root = canonicalPath(rootPath);
  const errors = [];
  const warnings = [];
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { ok: false, rootPath: root, errors: ['所选项目知识库不存在或不是文件夹。'], warnings };
  try { fs.accessSync(root, fs.constants.R_OK); } catch { errors.push('所选项目知识库不可读取。'); }
  const metadataCandidates = [path.join(root, '.edu-manager', 'knowledge-space.json'), path.join(root, '.ai-manager', 'metadata.json'), path.join(root, 'metadata.json')];
  const metadataPath = metadataCandidates.find((item) => fs.existsSync(item)) || '';
  const metadata = metadataPath ? readJson(metadataPath) : null;
  const knowledgeSpaceId = String(metadata?.knowledgeSpaceId || metadata?.workspace_id || metadata?.workspaceId || '').trim();
  const paths = {};
  for (const [key, names] of Object.entries(SCHEMA_FOLDERS)) paths[key] = firstMatchingDirectory(root, names, key === 'rawPath');
  const missingSchema = Object.entries(paths).filter(([, value]) => !value).map(([key]) => key);
  if (missingSchema.length) errors.push(`缺少统一项目知识 Schema 目录：${missingSchema.join('、')}。`);
  const agentPath = [path.join(root, 'AGENT.md'), path.join(path.dirname(root), 'AGENT.md')].find((item) => fs.existsSync(item)) || '';
  if (!agentPath) warnings.push('未发现 AGENT.md；接管后将使用项目控制目录中的规则文件，不会写入知识库。');
  const pathmapPath = [path.join(root, '.pathmap.json'), path.join(root, '.ai-manager', 'pathmap.json'), path.join(root, '.edu-manager', 'pathmap.json')].find((item) => fs.existsSync(item)) || '';
  let absolutePathCount = 0;
  for (const candidate of [agentPath, pathmapPath].filter(Boolean)) {
    const text = fs.readFileSync(candidate, 'utf8');
    absolutePathCount += (text.match(/[A-Za-z]:[\\/][^\r\n"']+/g) || []).length;
  }
  if (absolutePathCount) warnings.push(`发现 ${absolutePathCount} 处旧主机绝对路径；接管后通过当前主机逻辑路径映射兼容，不改写原文件。`);
  const duplicate = projects.find((project) => (knowledgeSpaceId && String(project.knowledgeSpaceId || '') === knowledgeSpaceId) || samePath(project.knowledgeRootPath, root));
  if (duplicate) errors.push(`该知识库已被项目“${duplicate.name}”绑定。`);
  let fileCount = 0;
  let totalBytes = 0;
  const identityEntries = Object.entries(paths).filter(([, value]) => value).map(([key, value]) => `${key}:${path.relative(root, value).replace(/\\/g, '/').toLocaleLowerCase('zh-CN')}`);
  const stack = [root];
  while (stack.length && fileCount <= 10000) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) {
        const size = fs.statSync(fullPath).size;
        fileCount += 1;
        totalBytes += size;
        identityEntries.push(`${path.relative(root, fullPath).replace(/\\/g, '/').toLocaleLowerCase('zh-CN')}:${size}`);
      }
    }
  }
  const inventoryFingerprint = crypto.createHash('sha256').update(identityEntries.sort().join('\n')).digest('hex');
  const identitySeed = knowledgeSpaceId || inventoryFingerprint.slice(0, 20);
  return {
    ok: errors.length === 0,
    rootPath: root,
    knowledgeSpaceId: knowledgeSpaceId || `project-kb-${identitySeed}`,
    identitySource: knowledgeSpaceId ? 'existing_metadata' : 'generated_compatibility_id',
    metadataPath,
    pathmapPath,
    agentPath,
    paths,
    checks: Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, Boolean(value)])),
    inventory: { fileCount, totalBytes, limited: fileCount > 10000, fingerprint: inventoryFingerprint },
    absolutePathCount,
    errors,
    warnings,
  };
}

function adoptionPathmap(project, scan) {
  return {
    version: 1,
    projectId: project.id,
    knowledgeSpaceId: scan.knowledgeSpaceId,
    adoptedAt: new Date().toISOString(),
    source: 'adopted_project_knowledge_base',
    paths: {
      '@PROJECT_ROOT': project.projectRootPath,
      '@PROJECT_WORKSPACE': project.workspacePath,
      '@PROJECT_KNOWLEDGE_ROOT': scan.rootPath,
      '@PROJECT_RAW': scan.paths.rawPath,
      '@PROJECT_CONCEPTS': scan.paths.conceptPath,
      '@PROJECT_ENTITIES': scan.paths.entityPath,
      '@PROJECT_SUMMARIES': scan.paths.summaryPath,
      '@PROJECT_QA': scan.paths.qaPath,
      '@PROJECT_SYNTHESIS': scan.paths.synthesisPath,
    },
  };
}

module.exports = { SCHEMA_FOLDERS, scanProjectKnowledgeBase, adoptionPathmap };
