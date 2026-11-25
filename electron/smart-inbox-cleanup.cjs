'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashStableFile, writeJsonAtomic } = require('./project-materials.cjs');
const { realDirectory } = require('./download-inbox.cjs');
const { assessContent } = require('./smart-inbox-content.cjs');
const DEFAULTS = Object.freeze({ version: 1, automaticRecycle: true, expirationCleanup: true, technicalRecovery: true, retentionDays: 30 });
const DAY = 86400000, MAX_BYTES = 5 * 1024 * 1024;
function createInboxCleanup({ root, items, sources, save, now, withItemLock, host, verifyOriginal }) {
  let policy = { ...DEFAULTS }, nextCheck = 0;
  const inspected = new Map();
  const policyFile = path.join(root, 'cleanup-policy.json');
  const iso = () => new Date(now()).toISOString();
  const metadata = reason => ({ version: 1, reason, policyVersion: policy.version, recycledAt: iso(),
    expiresAt: new Date(now() + policy.retentionDays * DAY).toISOString(), stage: 'recycled', releasedBytes: 0 });
  async function init() {
    await fs.mkdir(path.join(root, 'cleanup-journal'), { recursive: true });
    try { policy = { ...DEFAULTS, ...JSON.parse(await fs.readFile(policyFile, 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (['automaticRecycle', 'expirationCleanup', 'technicalRecovery'].some(key => typeof policy[key] !== 'boolean')
      || policy.retentionDays !== 30 || !Number.isInteger(policy.version) || policy.version < 1) throw Error('自动清理策略损坏，已停止清理');
    for (const item of items.values()) if (item.status === 'ignored' && !item.manualLocked && !item.cleanup
      && item.lastDecision?.action === 'automatic_internal_ignore') await save('items', { ...item, cleanup: metadata('internal_task') });
  }
  async function recycle(item, reason) {
    return save('items', { ...item, previousStatus: item.status, status: 'ignored', manualLocked: false,
      revision: item.revision + 1, reasonCode: reason, cleanup: metadata(reason),
      lastDecision: { action: 'automatic_recycle', at: iso() }, message: '已自动回收，保留原件；30天后仅清理管家可再生副本。' });
  }
  async function candidates(item) {
    if (item.status !== 'ignored' || item.manualLocked || !item.cleanup || item.cleanup.restoredAt || item.receipt
      || item.previous?.receipt || item.learningReview || item.extractionReuse?.reused || item.associationChange
      || item.execution && !['host_committed', 'result_validated'].includes(item.execution.stage)) return [];
    if (!['internal_task', 'capture_probe', 'empty_content'].includes(item.cleanup.reason)) return [];
    const result = [];
    if (item.snapshotPath) result.push({ file: item.snapshotPath, kind: 'snapshot', root: path.join(root, 'snapshots', item.id) });
    // Extraction caches are shared: retain them while any other record still
    // references this content. Raw executor results are never purge candidates.
    const shared = [...items.values()].some(other => other.id !== item.id && other.studentId === item.studentId
      && other.fingerprint?.sha256 === item.fingerprint?.sha256 && other.cleanup?.stage !== 'purged');
    if (!shared && item.fingerprint?.sha256) for (const name of await fs.readdir(path.join(root, 'extractions'))) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = path.join(root, 'extractions', name), stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) continue;
      const record = JSON.parse(await fs.readFile(file, 'utf8'));
      const expected = require('./smart-inbox-policy.cjs').digest([item.studentId || item.sourceId, item.fingerprint.sha256,
        path.extname(item.name).toLowerCase(), host.extractorVersion || 'v1']);
      if (record.sha256 === item.fingerprint.sha256 && (record.studentId === item.studentId || name === `${expected}.json`)) result.push({ file, kind: 'extraction', root: path.join(root, 'extractions') });
    }
    return result;
  }
  async function validateFile(candidate, item) {
    const base = path.resolve(candidate.root), file = path.resolve(candidate.file), relative = path.relative(base, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('清理路径超出管家副本目录');
    await realDirectory(base); await realDirectory(path.dirname(file));
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('清理对象不是普通副本文件');
    const actualParent = await fs.realpath(path.dirname(file));
    if (path.resolve(actualParent).toLowerCase() !== path.resolve(path.dirname(file)).toLowerCase()) throw Error('清理目录不能经过重解析点');
    const hash = await hashStableFile(file);
    if (candidate.kind === 'snapshot') {
      if (hash.sha256 !== item.fingerprint?.sha256) throw Error('副本指纹已变化');
      if (hash.size > 200 * 1024) throw Error('副本超过自动判别上限');
      const content = await fs.readFile(file, 'utf8');
      if (assessContent({ text: content, name: item.name, size: hash.size, sourceType: item.sourceType }).action !== 'recycle') throw Error('副本不符合自动回收条件');
    }
    return hash;
  }
  async function sweep() {
    if (!policy.expirationCleanup || now() < nextCheck) return;
    nextCheck = now() + 15 * 60000;
    let count = 0, bytes = 0, release;
    try {
      for (const item of items.values()) {
        if (count >= 20 || bytes >= MAX_BYTES) break;
        const source = sources.get(item.sourceId);
        if (!source?.enabled || source.detached || !host.automaticAllowed(item.studentId) || !item.cleanup
          || item.cleanup.stage === 'purged' || !Number.isFinite(Date.parse(item.cleanup.expiresAt)) || Date.parse(item.cleanup.expiresAt) > now()) continue;
        if (!release) { release = await host.acquire(source, false); if (!release) return; }
        await withItemLock(item.id, async () => {
          const current = items.get(item.id), files = await candidates(current);
          if (!files.length) return;
          await verifyOriginal(current, source);
          count++;
          const journalFile = path.join(root, 'cleanup-journal', `${item.id}.json`);
          let journal;
          try { journal = JSON.parse(await fs.readFile(journalFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
          journal ||= { id: item.id, sourceId: item.sourceId, studentId: item.studentId, sha256: item.fingerprint?.sha256,
            reason: item.cleanup.reason, at: iso(), files: [] };
          for (const candidate of files) {
            let hash;
            try { hash = await validateFile(candidate, current); } catch (e) {
              if (e.code === 'ENOENT' && journal.files.some(f => f.file === candidate.file && f.state === 'prepared')) {
                const row = journal.files.find(f => f.file === candidate.file); row.state = 'released';
                await writeJsonAtomic(journalFile, journal); continue;
              }
              throw e;
            }
            if (bytes + hash.size > MAX_BYTES) break;
            let row = journal.files.find(f => f.file === candidate.file);
            if (!row) { row = { ...candidate, sha256: hash.sha256, bytes: hash.size, state: 'prepared' }; journal.files.push(row); }
            if (row.sha256 !== hash.sha256) throw Error('清理期间副本发生变化');
            await writeJsonAtomic(journalFile, journal);
            await realDirectory(path.dirname(candidate.file));
            if (path.resolve(await fs.realpath(path.dirname(candidate.file))).toLowerCase() !== path.resolve(path.dirname(candidate.file)).toLowerCase()) throw Error('清理目录发生变化');
            const final = await fs.lstat(candidate.file);
            if (final.isSymbolicLink() || (await hashStableFile(candidate.file)).sha256 !== hash.sha256) throw Error('清理期间副本发生变化');
            await fs.unlink(candidate.file); bytes += hash.size; row.state = 'released'; await writeJsonAtomic(journalFile, journal);
          }
          const released = journal.files.filter(f => f.state === 'released');
          await save('items', { ...current, snapshotPath: released.some(f => f.kind === 'snapshot') ? '' : current.snapshotPath,
            cleanup: { ...current.cleanup, stage: journal.files.length && journal.files.every(f => f.state === 'released')
              && files.every(f => released.some(r => r.file === f.file)) ? 'purged' : 'recycled',
              releasedBytes: released.reduce((sum, f) => sum + f.bytes, 0), lastCheckedAt: iso() } });
        }).catch(async error => { const current = items.get(item.id); await save('items', { ...current,
          cleanup: { ...current.cleanup, lastError: error.message, lastCheckedAt: iso() } }); });
      }
    } finally { release?.(); }
  }
  async function recheck() {
    if (!policy.automaticRecycle) return;
    let count = 0;
    for (const item of items.values()) {
      if (count >= 20) break;
      const source = sources.get(item.sourceId), stamp = `${item.revision}:${item.fingerprint?.sha256}:${policy.version}`;
      if (item.status !== 'review' || !item.automationEligible || item.manualLocked || item.receipt || item.originalMissing
        || !source?.enabled || !source.automatic || source.detached || !host.automaticAllowed(item.studentId)
        || !item.snapshotPath || item.fingerprint?.size > 200 * 1024 || inspected.get(item.id) === stamp) continue;
      inspected.set(item.id, stamp); count++;
      await withItemLock(item.id, async () => {
        const current = items.get(item.id); if (current?.status !== 'review' || current.revision !== item.revision) return;
        await verifyOriginal(current, source);
        if ((await hashStableFile(current.snapshotPath)).sha256 !== current.fingerprint.sha256) return;
        const text = await fs.readFile(current.snapshotPath, 'utf8');
        const result = assessContent({ text, name: current.name, size: current.fingerprint.size, sourceType: source.type,
          blocked: current.extractionBlocked, truncated: current.truncated });
        if (result.action === 'recycle') await recycle(current, result.reason);
      }).catch(() => {});
    }
  }
  return { init, recycle, sweep, recheck, enabled: () => policy.automaticRecycle, recoveryEnabled: () => policy.technicalRecovery,
    policy: () => ({ ...policy }), async update(input) {
      const next = { ...policy };
      for (const key of ['automaticRecycle', 'expirationCleanup', 'technicalRecovery']) if (key in input) {
        if (typeof input[key] !== 'boolean') throw Error('清理开关必须为布尔值'); next[key] = input[key];
      }
      if ('retentionDays' in input && input.retentionDays !== 30) throw Error('当前保留期限固定为30天');
      next.version++; await writeJsonAtomic(policyFile, next); policy = next; return { ...next };
    }, async preview(input = {}) {
      const rows = [...items.values()].filter(i => i.cleanup && (!input.studentId || i.studentId === input.studentId));
      const page = Math.max(1, Math.floor(Number(input.page) || 1));
      return { total: rows.length, page, policy: { ...policy }, releasedBytes: rows.reduce((n, i) => n + (i.cleanup.releasedBytes || 0), 0),
        entries: rows.slice((page - 1) * 25, page * 25).map(i => ({ id: i.id, revision: i.revision, name: i.name, studentId: i.studentId, ...i.cleanup })) };
    }, async detail(id) { const item = items.get(id); if (!item?.cleanup) throw Error('自动回收记录不存在'); return { id, name: item.name, ...item.cleanup }; },
    async restore(input) {
      return withItemLock(input.id, async () => {
        const item = items.get(input.id); if (!item?.cleanup || item.status !== 'ignored' || item.revision !== input.revision) throw Error('回收记录已变化');
        await verifyOriginal(item, sources.get(item.sourceId));
        return save('items', { ...item, status: 'review', manualLocked: true, revision: item.revision + 1,
          cleanup: { ...item.cleanup, stage: 'restored', restoredAt: iso() }, message: '已恢复并保留，自动回收不会再次处理本记录。' });
      });
    } };
}
module.exports = { createInboxCleanup, DEFAULTS };
