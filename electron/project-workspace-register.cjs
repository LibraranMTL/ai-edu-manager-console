const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { relativeMaterialPath } = require('./project-material-contract.cjs');
const { hashStableFile } = require('./project-materials.cjs');
const { reconcileWorkspacePathClassifications } = require('./project-material-classification.cjs');

async function registerProjectWorkspaceScan(project, files, store) {
  const index = await store.read();
  const pathKey = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  const previous = new Map(index.materials.filter((item) => item.location.kind === 'workspace'
    && item.location.rootId === 'workspace').map((item) => [pathKey(item.location.relativePath), item]));
  const inbox = relativeMaterialPath(project.inboxRelativePath || '收件箱');
  const groups = { active: [], later: [] };
  const movedEntries = [];
  const missingByFileKey = new Map();
  const scannedFileKeyCounts = new Map();
  for (const record of index.materials) {
    if (record.location.kind !== 'workspace' || record.location.rootId !== 'workspace'
      || !record.fileKey) continue;
    const items = missingByFileKey.get(record.fileKey) || [];
    items.push(record);
    missingByFileKey.set(record.fileKey, items);
  }
  for (const file of files) {
    if (file.fileKey) scannedFileKeyCounts.set(file.fileKey,
      (scannedFileKeyCounts.get(file.fileKey) || 0) + 1);
  }
  let unchanged = 0;
  let added = 0;
  let updated = 0;
  let moved = 0;
  for (const file of files) {
    const relativePath = relativeMaterialPath(file.relativePath);
    const prior = previous.get(pathKey(relativePath));
    if (prior && prior.availability !== 'missing' && prior.size === file.size
      && prior.mtimeMs === file.mtimeMs) { unchanged++; continue; }
    if (!prior && file.fileKey && Number(file.fileKey.split(':').at(-1)) > 0 && file.nlink === 1
      && scannedFileKeyCounts.get(file.fileKey) === 1
      && missingByFileKey.get(file.fileKey)?.length === 1) {
      const previousRecord = missingByFileKey.get(file.fileKey)[0];
      let oldPathMissing = false;
      try { await fs.stat(await store.locationPath(previousRecord.location)); }
      catch (error) { oldPathMissing = error.code === 'ENOENT'; }
      if (oldPathMissing) {
        const selected = await store.locationPath({ kind: 'workspace', rootId: 'workspace', relativePath });
        const observed = await hashStableFile(selected);
        if (observed.fileKey === file.fileKey && observed.sha256 === previousRecord.sha256) {
          movedEntries.push({ location: { kind: 'workspace', rootId: 'workspace', relativePath },
            materialId: previousRecord.materialId, expectedVersion: previousRecord.version,
            expectedSha256: previousRecord.sha256, expectedFileKey: file.fileKey,
            source: { eventId: `scan-relocation-${crypto.createHash('sha256').update(JSON.stringify([
              project.id, previousRecord.materialId, relativePath,
            ])).digest('hex')}`, type: 'workspace_scan_relocation', deviceId: 'local-host', studentId: '' } });
          moved++;
          continue;
        }
      }
    }
    const intent = pathKey(relativePath).startsWith(`${pathKey(inbox)}/`) ? 'active' : 'later';
    const entry = { location: { kind: 'workspace', rootId: 'workspace', relativePath },
      ...(prior ? { materialId: prior.materialId, expectedVersion: prior.version } : {}),
      source: { eventId: `scan-${crypto.createHash('sha256').update(JSON.stringify([project.id, relativePath])).digest('hex')}`,
        type: 'workspace_scan', deviceId: 'local-host', studentId: '' } };
    groups[intent].push(entry);
    if (prior) updated++; else added++;
  }
  let registered = 0;
  if (movedEntries.length) {
    for (let offset = 0; offset < movedEntries.length; offset += 100) {
      await store.registerFiles(movedEntries.slice(offset, offset + 100), {
        expectedRevision: index.revision + offset / 100,
      });
      registered += Math.min(100, movedEntries.length - offset);
    }
  }
  for (const [intent, entries] of Object.entries(groups)) {
    for (let offset = 0; offset < entries.length; offset += 100) {
      const batch = entries.slice(offset, offset + 100);
      await store.registerFiles(batch, { intent });
      registered += batch.length;
    }
  }
  const pathClassification = await reconcileWorkspacePathClassifications(project, store);
  return { scanned: files.length, registered, added, updated, moved, unchanged, pathClassification };
}

module.exports = { registerProjectWorkspaceScan };
