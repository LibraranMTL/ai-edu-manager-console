const crypto = require('node:crypto');
const { invariant, relativeMaterialPath } = require('./project-material-contract.cjs');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const locationKey = (location) => JSON.stringify([location.kind, location.rootId,
  process.platform === 'win32' ? location.relativePath.toLowerCase() : location.relativePath]);

async function auditProjectMaterialContent(project, observed, store, {
  limit = 20, minAgeMs = WEEK_MS, nowMs = Date.now(),
} = {}) {
  invariant(Array.isArray(observed) && observed.length <= 6000,
    'invalid_observation', '项目资料复核范围无效。');
  invariant(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,
    'invalid_limit', '每次内容复核最多处理100份资料。');
  invariant(Number.isSafeInteger(minAgeMs) && minAgeMs >= 0 && minAgeMs <= 365 * 24 * 60 * 60 * 1000,
    'invalid_interval', '内容复核间隔无效。');
  invariant(Number.isFinite(nowMs) && !Number.isNaN(new Date(nowMs).getTime()),
    'invalid_time', '内容复核时间无效。');
  const observedByLocation = new Map();
  for (const file of observed) {
    const location = { kind: file.location?.kind, rootId: file.location?.rootId,
      relativePath: relativeMaterialPath(file.location?.relativePath) };
    invariant(Number.isSafeInteger(file.size) && file.size >= 0 && Number.isFinite(file.mtimeMs),
      'invalid_observation', '项目资料文件信息无效。');
    const key = locationKey(location);
    invariant(!observedByLocation.has(key), 'duplicate_location', '同一来源在本页扫描中重复。');
    observedByLocation.set(key, { location, size: file.size, mtimeMs: file.mtimeMs });
  }
  const index = await store.read();
  const due = index.materials.filter((item) => {
    const file = observedByLocation.get(locationKey(item.location));
    if (!file || item.size !== file.size || item.mtimeMs !== file.mtimeMs) return false;
    const previous = Date.parse(item.contentVerifiedAt || '');
    return !Number.isFinite(previous) || nowMs - previous >= minAgeMs;
  }).sort((left, right) => (Date.parse(left.contentVerifiedAt || '') || 0)
    - (Date.parse(right.contentVerifiedAt || '') || 0));
  const verified = [];
  const failed = [];
  let updated = 0;
  let unchanged = 0;
  for (const item of due.slice(0, limit)) {
    try {
      const resolved = await store.resolve(item.materialId);
      if (resolved.version !== item.version || resolved.sha256 !== item.sha256) {
        failed.push({ materialId: item.materialId, code: 'version_conflict' });
      } else verified.push(item);
    } catch (error) {
      if (error.code !== 'source_changed') {
        failed.push({ materialId: item.materialId, code: error.code || 'source_unavailable' });
        continue;
      }
      try {
        const next = (await store.registerFiles([{ location: item.location,
          materialId: item.materialId, expectedVersion: item.version,
          source: { eventId: `scan-audit-${crypto.createHash('sha256').update(JSON.stringify([
            project.id, item.location.rootId, item.location.relativePath,
          ])).digest('hex')}`, type: 'content_audit', deviceId: 'local-host', studentId: '' },
        }], { intent: 'later' })).result[0];
        if (next.version > item.version) updated++;
        else unchanged++;
      } catch (registrationError) {
        failed.push({ materialId: item.materialId,
          code: registrationError.code || 'audit_register_failed' });
      }
    }
  }
  if (verified.length) {
    const marked = (await store.mutate((fresh) => verified.map((item) => {
      const record = fresh.materials.find((value) => value.materialId === item.materialId);
      if (!record || record.version !== item.version || record.sha256 !== item.sha256
        || locationKey(record.location) !== locationKey(item.location)) return false;
      record.contentVerifiedAt = new Date(nowMs).toISOString();
      return true;
    }))).result;
    unchanged += marked.filter(Boolean).length;
    verified.forEach((item, index) => {
      if (!marked[index]) failed.push({ materialId: item.materialId, code: 'version_conflict' });
    });
  }
  return { checked: Math.min(due.length, limit), updated, unchanged, failed,
    pending: Math.max(0, due.length - limit) };
}

module.exports = { auditProjectMaterialContent };
