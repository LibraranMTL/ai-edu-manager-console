const crypto = require('crypto');
const path = require('path');

function sameOrInside(rootPath, candidatePath) {
  const root = path.resolve(String(rootPath || ''));
  const candidate = path.resolve(String(candidatePath || ''));
  const relative = path.relative(root, candidate);
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function mergeExternalMigrationCandidates(candidates = []) {
  const sorted = candidates
    .filter((item) => item?.rootPath)
    .map((item) => ({ ...item, rootPath: path.resolve(item.rootPath), required: Boolean(item.required) }))
    .sort((a, b) => a.rootPath.length - b.rootPath.length);
  const merged = [];
  for (const candidate of sorted) {
    const parent = merged.find((item) => sameOrInside(item.rootPath, candidate.rootPath));
    const reference = {
      rootPath: candidate.rootPath,
      label: candidate.label,
      ownerType: candidate.ownerType,
      ownerId: candidate.ownerId,
      required: candidate.required,
    };
    if (parent) {
      parent.required = parent.required || candidate.required;
      parent.references.push(reference);
      continue;
    }
    merged.push({
      id: `external-${crypto.createHash('sha256').update(candidate.rootPath.toLocaleLowerCase('zh-CN')).digest('hex').slice(0, 12)}`,
      kind: 'external',
      rootPath: candidate.rootPath,
      label: candidate.label,
      required: candidate.required,
      references: [reference],
    });
  }
  return merged;
}

function projectMigrationRequirements(projects = [], readMaterialIndex = () => ({ materials: [] })) {
  const directories = [];
  for (const project of projects) {
    if (project.materialStorageMode !== 'workspace-v1') continue;
    const index = readMaterialIndex(project);
    const fields = [['projectRootPath', '项目根目录'], ['workspacePath', '项目工作空间'],
      ['managerPath', '项目管理记录'], ['knowledgeRootPath', '项目知识空间']];
    if ((index.materials || []).some((item) => item.location?.kind === 'legacy_raw')) fields.push(['rawPath', '仍被引用的旧原始资料目录']);
    for (const [field, label] of fields) {
      if (!project[field] || !path.isAbsolute(project[field])) throw new Error(`项目“${project.name || project.id}”的${label}未配置有效路径，不能创建完整迁移包。`);
      directories.push({ projectId: String(project.id), field, label: `${label}：${project.name || project.id}`, rootPath: path.resolve(project[field]) });
    }
  }
  return directories;
}

module.exports = { mergeExternalMigrationCandidates, sameOrInside, projectMigrationRequirements };
