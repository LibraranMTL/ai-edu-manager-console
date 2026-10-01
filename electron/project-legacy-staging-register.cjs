const crypto = require('node:crypto');
const path = require('node:path');
const { relativeMaterialPath } = require('./project-material-contract.cjs');
const { within } = require('./project-materials.cjs');

const GENERATED_NAMES = new Set(['staging-index.json', '研究暂存清单.md', '研究暂存治理建议.md']);

function legacyStagingLocation(project, file) {
  if (GENERATED_NAMES.has(String(file.filename || '').toLowerCase())) return null;
  const root = path.resolve(project.stagingPath);
  const workspace = path.resolve(project.workspacePath);
  const absolute = path.resolve(file.path);
  if (!within(root, absolute)) throw new Error('旧研究暂存来源越过授权目录。');
  const insideWorkspace = within(workspace, absolute);
  const relativePath = relativeMaterialPath(path.relative(insideWorkspace ? workspace : root, absolute).replace(/\\/g, '/'));
  return insideWorkspace
    ? { kind: 'workspace', rootId: 'workspace', relativePath }
    : { kind: 'external', rootId: 'legacy-staging', relativePath };
}

async function registerLegacyStagingFiles(project, files, store) {
  const index = await store.read();
  const key = (location) => JSON.stringify([location.rootId,
    process.platform === 'win32' ? location.relativePath.toLowerCase() : location.relativePath]);
  const previous = new Map(index.materials.map((item) => [key(item.location), item]));
  const entries = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let generated = 0;
  for (const file of files) {
    const location = legacyStagingLocation(project, file);
    if (!location) { generated++; continue; }
    const { relativePath } = location;
    const prior = previous.get(key(location));
    if (prior && prior.availability !== 'missing' && prior.size === file.size && prior.mtimeMs === file.mtimeMs) {
      unchanged++;
      continue;
    }
    entries.push({ location, ...(prior ? { materialId: prior.materialId, expectedVersion: prior.version } : {}),
      source: { eventId: `legacy-stage-${crypto.createHash('sha256').update(JSON.stringify([
        project.id, location.rootId, relativePath,
      ])).digest('hex')}`, type: 'legacy_staging', deviceId: 'local-host', studentId: '' } });
    if (prior) updated++; else added++;
  }
  for (let offset = 0; offset < entries.length; offset += 100) {
    await store.registerFiles(entries.slice(offset, offset + 100), { intent: 'later' });
  }
  return { scanned: files.length, registered: entries.length, added, updated, unchanged, generated };
}

module.exports = { registerLegacyStagingFiles, legacyStagingLocation };
