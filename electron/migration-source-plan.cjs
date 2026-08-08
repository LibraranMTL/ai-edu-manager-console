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

module.exports = { mergeExternalMigrationCandidates, sameOrInside };
