'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashStableFile, writeJsonAtomic } = require('./project-materials.cjs');
const { realDirectory, MAX_BYTES, ALLOWED } = require('./download-inbox.cjs');
const P = require('./smart-inbox-policy.cjs');
const { taskRetryDecision } = require('./task-recovery-policy.cjs');
const within = (root, file) => { const rel = path.relative(root, file); return !rel || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep)); };
const identity = s => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':');
const yieldTurn = () => new Promise(resolve => setImmediate(resolve));
const clone = value => structuredClone(value);
const safeId = id => { if (!/^[a-zA-Z0-9_-]{1,150}$/.test(id)) throw Error('记录编号无效'); return id; };
// Parser scope notices are not extraction failures. Unknown warnings still fail closed.
const SCOPE_NOTICES = new Set([
  '仅提取文档可读正文；图片、图表、嵌入对象和版式不作为已完整识别的证据。',
  '修订删除内容不计入正文；批注与脚注单独标注，不能推断为最终定稿。',
  '公式不执行，缓存结果可能过期；隐藏表已明确标注，超链接不抓取外部内容。',
  '图片文字由OCR识别，可能存在漏字或误识别；图示和版式未被完整理解。',
]);
const LEGACY_PRE_SEND = /后台通道未取得有效认证|需要重新登录并检测|已配置Agent尚不支持受控分类/;
function legacyAgentBlock(message) {
  if (!LEGACY_PRE_SEND.test(message || '')) return null;
  const authentication = /未取得有效认证|重新登录/.test(message || '');
  return { code: authentication ? 'AUTHENTICATION_REQUIRED' : 'AGENT_UNAVAILABLE', category: 'agent', recoverable: true,
    stage: 'not_sent', message: authentication
      ? '旧记录确认停在发送正文之前；请重新授权、启用备用 Agent，或直接手动投递。'
      : '旧记录确认未发送正文；请启用可用 Agent，或直接手动投递。' };
}

// The host owns scheduling and resource admission. This service owns no timer,
// watcher, model credentials or arbitrary destination-file capability.
function createSmartInbox(host) {
  const root = host.directory, sources = new Map(), items = new Map(), rules = new Map();
  const cacheFiles = new Map(), itemOperations = new Map();
  let cacheBytes = 0;
  let loaded, active = null, closed = false, blocked = '', turn = 0, commands = Promise.resolve();
  let defaults = { schedule: { ...P.DEFAULT_SCHEDULE } };
  const now = () => host.now?.() ?? Date.now();
  const iso = () => new Date(now()).toISOString();
  const serial = work => { const result = commands.catch(() => {}).then(work); commands = result; return result; };
  const withItemLock = (itemId, work) => {
    const key = String(itemId || '');
    const previous = itemOperations.get(key) || Promise.resolve();
    const running = previous.catch(() => {}).then(work);
    itemOperations.set(key, running);
    return running.finally(() => { if (itemOperations.get(key) === running) itemOperations.delete(key); });
  };
  const stats = { discovered: 0, snapshots: 0, extracted: 0, classified: 0, delivered: 0, cacheHits: 0 };
  const fileFor = (kind, id) => path.join(root, kind, `${safeId(id)}.json`);
  async function read(file, fallback) {
    try { if ((await fs.lstat(file)).isSymbolicLink()) throw Error('资料状态文件不能使用链接'); return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  }
  async function save(kind, record) {
    if (blocked) throw Error(blocked);
    const value = clone(record);
    try { await writeJsonAtomic(fileFor(kind, value.id), value); }
    catch (e) { blocked = `资料状态保存失败，已停止新执行：${e.message}`; throw e; }
    ({ sources, items, rules }[kind])?.set(value.id, value);
    return value;
  }
  async function init() {
    return loaded ||= (async () => {
      for (const name of ['sources', 'items', 'rules', 'decisions', 'snapshots', 'extractions']) {
        await fs.mkdir(path.join(root, name), { recursive: true }); await realDirectory(path.join(root, name));
      }
      for (const [kind, map] of [['sources', sources], ['items', items], ['rules', rules]]) {
        for await (const entry of await fs.opendir(path.join(root, kind))) {
          if (!entry.isFile() || !/^[a-zA-Z0-9_-]+\.json$/.test(entry.name)) continue;
          const value = await read(path.join(root, kind, entry.name));
          if (!value?.id || `${value.id}.json` !== entry.name) throw Error('资料收件箱记录损坏');
          map.set(value.id, value);
        }
      }
      defaults = await read(path.join(root, 'defaults.json'), defaults);
      P.schedule(defaults.schedule);
      const migration = path.join(root, 'agent-recovery-migration-v2.json');
      if (!await read(migration, null)) {
        const backup = path.join(root, 'migration-backup-agent-v2');
        await fs.mkdir(backup, { recursive: true });
        for (const item of items.values()) {
          const blockReason = legacyAgentBlock(item.message);
          if (item.blockReason || item.receipt || !['review', 'retry'].includes(item.status) || !blockReason) continue;
          await fs.copyFile(fileFor('items', item.id), path.join(backup, `${item.id}.json`), require('node:fs').constants.COPYFILE_EXCL).catch(e => { if (e.code !== 'EEXIST') throw e; });
          await save('items', { ...item, status: 'review', blockReason, execution: { ...(item.execution || {}), stage: 'not_sent' }, revision: item.revision + 1 });
        }
        await writeJsonAtomic(migration, { version: 2, at: iso(), backup });
      }
      const repair = path.join(root, 'agent-recovery-migration-v3.json');
      if (!await read(repair, null)) {
        const backup = path.join(root, 'migration-backup-agent-v3');
        await fs.mkdir(backup, { recursive: true });
        let repaired = 0;
        for (const item of items.values()) {
          const blockReason = item.status === 'execution_unknown' && item.blockReason?.code === 'LEGACY_AGENT_BLOCKED'
            ? legacyAgentBlock(item.message) : null;
          if (!blockReason) continue;
          await fs.copyFile(fileFor('items', item.id), path.join(backup, `${item.id}.json`), require('node:fs').constants.COPYFILE_EXCL).catch(e => { if (e.code !== 'EEXIST') throw e; });
          await save('items', { ...item, status: 'review', blockReason, execution: { ...(item.execution || {}), stage: 'not_sent' },
            revision: item.revision + 1 });
          repaired++;
        }
        await writeJsonAtomic(repair, { version: 3, at: iso(), backup, repaired });
      }
      const storageMigration = path.join(root, 'delivered-copy-cleanup-v4.json');
      if (!await read(storageMigration, null)) {
        const backup = path.join(root, 'migration-backup-storage-v4');
        await fs.mkdir(backup, { recursive: true });
        let cleaned = 0, skipped = 0;
        for (const item of items.values()) {
          if (item.status !== 'delivered' || !item.receipt || (!item.snapshotPath && !item.archivePath)) continue;
          const source = sources.get(item.sourceId);
          try {
            await verifyReceipt(item, item.receipt);
            await fs.copyFile(fileFor('items', item.id), path.join(backup, `${item.id}.json`), require('node:fs').constants.COPYFILE_EXCL).catch(e => { if (e.code !== 'EEXIST') throw e; });
            let releasedSnapshot = false, releasedArchive = false;
            if (item.snapshotPath && path.resolve(item.snapshotPath) !== path.resolve(item.receipt.path)) {
              releasedSnapshot = await removeVerifiedCopy(item.snapshotPath, path.join(root, 'snapshots'), item.fingerprint.sha256);
            }
            if (item.archivePath && source?.staging && source.originalMode === 'archive') {
              releasedArchive = await removeVerifiedCopy(item.archivePath, path.join(source.folder, '已投递'), item.fingerprint.sha256);
            }
            const sourceRemovedAt = item.sourceRemovedAt || (releasedArchive ? iso() : '');
            await save('items', { ...item, snapshotPath: (releasedSnapshot || item.snapshotPath && !await exists(item.snapshotPath)) ? '' : item.snapshotPath,
              archivePath: (releasedArchive || item.archivePath && !await exists(item.archivePath)) ? '' : item.archivePath,
              retainedOriginalPath: item.receipt.path, sourceRemovedAt,
              storageOptimization: { version: 1, at: iso(), releasedSnapshot, releasedArchive } });
            cleaned++;
          } catch { skipped++; }
        }
        await writeJsonAtomic(storageMigration, { version: 4, at: iso(), backup, cleaned, skipped });
      }
      for await (const entry of await fs.opendir(path.join(root, 'extractions'))) {
        if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
        const file = path.join(root, 'extractions', entry.name), stat = await fs.lstat(file);
        cacheFiles.set(file, { size: stat.size, at: stat.mtimeMs }); cacheBytes += stat.size;
      }
    })().catch(e => { blocked = `资料收件箱初始化失败：${e.message}`; throw e; });
  }
  async function putCache(file, value) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > 2 * 1024 * 1024) return;
    const previousSize = cacheFiles.get(file)?.size || 0;
    for (const [candidate, meta] of [...cacheFiles].sort((a, b) => a[1].at - b[1].at)) {
      if (cacheBytes - previousSize + bytes <= 256 * 1024 * 1024) break;
      if (candidate === file) continue;
      await fs.unlink(candidate); cacheBytes -= meta.size; cacheFiles.delete(candidate);
    }
    await writeJsonAtomic(file, value); cacheBytes += bytes - previousSize; cacheFiles.set(file, { size: bytes, at: now() });
  }
  async function folderAllowed(folder) {
    const resolved = await realDirectory(folder);
    if (path.parse(resolved).root === resolved) throw Error('不能扫描磁盘根目录');
    for (const forbidden of [root, ...await host.forbiddenRoots()]) {
      if (forbidden && within(path.resolve(forbidden), resolved)) throw Error('不能扫描系统或受管资料目录');
    }
    return resolved;
  }
  async function excluded(file) {
    return [root, ...await host.forbiddenRoots()].filter(Boolean).some(p => within(path.resolve(p), file));
  }
  async function updateSource(input, { trusted = false } = {}) {
    await init();
    return serial(async () => {
      const old = input.id ? sources.get(input.id) : null;
      if (input.id && !old && !trusted) throw Error('来源不存在');
      const type = old?.type || (trusted ? input.type : 'folder');
      if (!['folder', 'download', 'share', 'history', 'session'].includes(type)) throw Error('来源类型无效');
      const studentId = String(input.studentId ?? old?.studentId ?? '');
      if (old && !['folder', 'download'].includes(type) && studentId !== old.studentId) throw Error('采集来源不能改绑学生');
      if (studentId) await host.context(studentId);
      const selectedTarget = input.target === null ? null : input.target ? P.target(input.target) : old?.target || null;
      if (selectedTarget && selectedTarget.studentId !== studentId) throw Error('投递目标与来源学生不一致');
      if (selectedTarget) await host.validateTarget(selectedTarget);
      const folder = ['folder', 'download'].includes(type) ? await folderAllowed(old?.folder || input.folder) : '';
      if (folder && [...sources.values()].some(s => s.id !== old?.id && s.folder?.toLowerCase() === folder.toLowerCase() && !s.detached)) throw Error('此目录已经是资料来源');
      const mode = input.originalMode ?? old?.originalMode ?? 'keep';
      if (!['keep', 'archive'].includes(mode) || (mode === 'archive' && !input.staging && !old?.staging)) throw Error('只有专用中转目录可以归档原件');
      if (mode === 'archive' && !['folder', 'download'].includes(type)) throw Error('受管采集原件须保留');
      const schedule = input.schedule === null ? null : input.schedule ? P.schedule(input.schedule) : old?.schedule || null;
      const enabled = input.enabled ?? old?.enabled ?? false;
      const automatic = Boolean(enabled && (input.automatic ?? old?.automatic ?? false));
      const record = { ...old, id: old?.id || (trusted && input.id) || crypto.randomUUID(), type, folder,
        name: String(input.name || old?.name || path.basename(folder) || type).slice(0, 120), studentId, target: selectedTarget,
        enabled: Boolean(enabled), automatic, detached: false,
        managedRouting: Boolean(input.managedRouting ?? old?.managedRouting),
        activationAt: String(input.activationAt ?? old?.activationAt ?? ''),
        staging: Boolean(input.staging ?? old?.staging), originalMode: mode, schedule,
        confidenceThreshold: P.confidenceThreshold(input.confidenceThreshold ?? old?.confidenceThreshold ?? .85),
        recursive: Boolean(input.recursive ?? old?.recursive), allHistory: Boolean(input.allHistory ?? old?.allHistory),
        createdAt: old?.createdAt || iso(), updatedAt: iso(), revision: (old?.revision || 0) + 1,
        nextRunAt: enabled ? P.nextRun(schedule || defaults.schedule, now()) : '', error: '', pendingManual: false, manualWork: false,
        resumeItemIds: enabled ? old?.resumeItemIds || [] : [], waitingReason: enabled ? old?.waitingReason || '' : '',
        waitingSince: enabled ? old?.waitingSince || '' : '',
      };
      if (old?.studentId !== record.studentId || !P.sameTarget(old?.target, record.target)) {
        for (const rule of rules.values()) if (rule.sourceId === record.id && rule.active) await save('rules', { ...rule, active: false });
      }
      return save('sources', record);
    });
  }
  async function bootstrap({ legacy, students = [] } = {}) {
    await init();
    const marker = path.join(root, 'migration-v1.json');
    if (!await read(marker, null)) {
      if (legacy?.folder && !sources.has('legacy-download')) {
        // Preserve original configuration/ledger and copy a non-overwriting backup.
        if (!await read(path.join(root, 'legacy-settings-backup.json'), null)) await writeJsonAtomic(path.join(root, 'legacy-settings-backup.json'), legacy);
        const migrated = { id: 'legacy-download', type: 'download', folder: legacy.folder, name: '下载文件', staging: true, originalMode: 'archive', allHistory: true, enabled: false, automatic: false };
        try { await updateSource(migrated, { trusted: true }); }
        catch (error) {
          if (blocked) throw error;
          await save('sources', { ...migrated, studentId: '', target: null, schedule: null, recursive: false,
            revision: 1, createdAt: iso(), nextRunAt: '', error: `原下载目录暂不可用，请恢复目录或解除关联后重选：${error.message}` });
        }
      }
      await writeJsonAtomic(marker, { schema: 1, at: iso() });
    }
    for (const student of students) for (const type of ['share', 'history', 'session']) {
      const id = `${type}-${P.digest(String(student.id)).slice(0, 24)}`;
      if (!sources.has(id)) await updateSource({ id, type, studentId: String(student.id), name: `${student.name} · ${{ share: '分享资料', history: '对话历史', session: '自动会话' }[type]}`, enabled: false }, { trusted: true });
    }
  }
  async function syncConversationRouting({ enabled = false, authorizedAt = '' } = {}, students = []) {
    await bootstrap({ students });
    const effective = Boolean(enabled && authorizedAt);
    const validStudentIds = new Set(students.map(student => String(student.id)));
    for (const source of sources.values()) {
      if (!source.managedRouting || !['history', 'session'].includes(source.type) || validStudentIds.has(String(source.studentId))) continue;
      if (source.enabled || source.nextRunAt || source.pendingManual || source.manualWork) await save('sources', {
        ...source, enabled: false, nextRunAt: '', pendingManual: false, manualWork: false,
        waitingReason: '学生不活跃或已归档，已停止新的会话分类与投递。', revision: source.revision + 1, updatedAt: iso(),
      });
    }
    for (const student of students) for (const type of ['history', 'session']) {
      const id = `${type}-${P.digest(String(student.id)).slice(0, 24)}`;
      const old = sources.get(id);
      if (!old) continue;
      const desired = {
        enabled: effective,
        automatic: type === 'session',
        managedRouting: true,
        activationAt: String(authorizedAt || ''),
        confidenceThreshold: .85,
      };
      if (old.enabled === desired.enabled && old.automatic === desired.automatic && old.managedRouting === true
        && String(old.activationAt || '') === desired.activationAt && Number(old.confidenceThreshold || .85) === .85) continue;
      const activationMs = Date.parse(desired.activationAt);
      if (Number.isFinite(activationMs) && String(old.activationAt || '') !== desired.activationAt) {
        for (const item of items.values()) {
          if (item.sourceId !== id || item.receipt || !['pending', 'retry'].includes(item.status) || Date.parse(item.modifiedAt || item.createdAt || '') >= activationMs) continue;
          await save('items', { ...item, status: 'ignored', manualLocked: true, revision: item.revision + 1,
            message: '此对话早于本次自动处理授权边界，未回溯分类或投递；原始对话资产仍保留。',
            lastDecision: { action: 'authorization_boundary', at: iso() } });
        }
      }
      await updateSource({ ...old, ...desired }, { trusted: true });
    }
  }
  async function resolveSourceFile(source, locator) {
    if (!['folder', 'download'].includes(source.type)) return host.resolveEvent(source, locator);
    const folder = await folderAllowed(source.folder), file = path.resolve(folder, locator);
    if (!within(folder, file) || file === folder || await excluded(file)) throw Error('来源文件不在授权目录');
    await realDirectory(path.dirname(file));
    const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw Error('来源文件不是普通文件');
    return { path: file, stat };
  }
  async function markMissing(item, message = '原件已不存在，未分析或投递。可移除待办记录（保留操作历史，不删除文件）；恢复原件后请重新扫描。') {
    const current = items.get(item.id);
    // Never discard receipts or hide an unknown execution behind a missing-file state.
    if (!current || !['pending', 'review', 'retry'].includes(current.status) || current.receipt) return;
    if (current.originalMissing) return;
    await save('items', { ...current, originalMissing: true, status: 'review', revision: current.revision + 1,
      nextRetryAt: '', proposedTarget: null, suggestion: null,
      message });
  }
  async function resolveItemFile(item, source) {
    try { return await resolveSourceFile(source, item.locator); }
    catch (error) {
      if (!['ENOENT', 'original_missing'].includes(error.code)) throw error;
      await markMissing(item, error.code === 'original_missing'
        ? '源会话已移入回收站或彻底删除；如仍在回收站，请先恢复会话，否则请移除此待办记录。'
        : undefined);
      throw Object.assign(Error(error.code === 'original_missing'
        ? '源会话已移入回收站或彻底删除；如仍在回收站，请先恢复会话，否则请移除此待办记录。'
        : '原件已不存在，请移除待办记录，或恢复原件后重新扫描'), { code: 'original_missing' });
    }
  }
  async function discover(source) {
    const activationFloor = Date.parse(source.activationAt || '');
    const generation = source.revision, floor = Number.isFinite(activationFloor) ? activationFloor : source.allHistory ? 0 : Date.parse(source.createdAt) - 30 * 86400000;
    let count = 0;
    const seen = new Set();
    async function receive(entry) {
      if (closed || !sources.get(source.id)?.enabled && !sources.get(source.id)?.pendingManual || sources.get(source.id)?.revision !== generation) throw Error('来源已暂停或修改');
      seen.add(entry.locator);
      const stat = entry.stat, modified = Math.max(stat.mtimeMs, stat.birthtimeMs || 0);
      const stableAge = host.stableAgeMs ?? 1500;
      if (modified < floor || stableAge > 0 && now() - stat.mtimeMs < stableAge) return;
      const key = P.digest([source.id, entry.locator, identity(stat)]);
      if (items.has(key)) {
        const old = items.get(key);
        if (old.originalMissing && ['review', 'ignored'].includes(old.status)) await save('items', { ...old, originalMissing: false,
          revision: old.revision + 1, message: '原件已恢复；可恢复待办或重新分析。' });
        return;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED.has(ext) && !P.EXTRACTABLE.has(ext)) return;
      const supported = stat.size > 0 && stat.size <= MAX_BYTES;
      const unassigned = !source.studentId && !source.target;
      await save('items', { id: key, sourceId: source.id, sourceRevision: generation, sourceType: source.type,
        locator: entry.locator, name: entry.name, size: stat.size, identity: identity(stat), modifiedAt: new Date(stat.mtimeMs).toISOString(),
        studentId: source.studentId, revision: 1, createdAt: iso(), status: supported && !unassigned ? 'pending' : 'review',
        automationDisposition: unassigned ? 'unassigned' : '',
        message: unassigned ? '待指定学生或投递目标；未创建自动任务，未发送正文给Agent。'
          : supported ? '' : '文件超过容量限制，需手动处理', manualLocked: false, supported, attempts: 0 });
      count++; stats.discovered++;
    }
    if (['folder', 'download'].includes(source.type)) {
      const base = await folderAllowed(source.folder), directories = [base];
      const forbidden = [root, ...await host.forbiddenRoots()].filter(Boolean).map(p => path.resolve(p));
      for (let index = 0; index < directories.length; index++) {
        await realDirectory(directories[index]);
        for await (const entry of await fs.opendir(directories[index])) {
          if (entry.isSymbolicLink() || entry.name.startsWith('.') || /^~\$|\.tmp$|\.part$|\.crdownload$|\.download$/i.test(entry.name) || entry.name === '已投递') continue;
          const file = path.join(directories[index], entry.name);
          if (forbidden.some(p => within(p, file))) continue;
          if (entry.isDirectory() && source.recursive) directories.push(file);
          else if (entry.isFile()) {
            const stat = await fs.lstat(file);
            if (!stat.isSymbolicLink()) await receive({ locator: path.relative(base, file), name: entry.name, stat });
          }
          await yieldTurn();
        }
      }
    } else {
      for (const event of await host.events(source)) {
        const resolved = await resolveSourceFile(source, event.locator);
        await receive({ ...event, stat: resolved.stat }); await yieldTurn();
      }
    }
    if (['folder', 'download'].includes(source.type)) for (const old of items.values()) {
      if (old.sourceId !== source.id || seen.has(old.locator) || old.originalMissing || old.receipt || !['pending', 'review', 'retry'].includes(old.status)) continue;
      // Only a missing-file result marks stale rows; permissions, exclusions and links do not.
      try { await resolveSourceFile(source, old.locator); }
      catch (error) { if (error.code === 'ENOENT') { await markMissing(old); count++; } }
      await yieldTurn();
    }
    return count;
  }
  async function snapshot(item, source) {
    if (item.receipt && !item.snapshotPath) {
      await verifyReceipt(item, item.receipt);
      const directory = path.join(root, 'snapshots', item.id);
      await fs.mkdir(directory, { recursive: true }); await realDirectory(directory);
      const destination = path.join(directory, path.basename(item.name));
      try { await hashStableFile(item.receipt.path, { copyTo: destination }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      if ((await fs.lstat(destination)).isSymbolicLink() || (await hashStableFile(destination)).sha256 !== item.fingerprint.sha256) throw Error('受管原件快照校验失败');
      return save('items', { ...item, snapshotPath: destination });
    }
    const resolved = await resolveSourceFile(source, item.locator);
    if (identity(resolved.stat) !== item.identity) throw Error('来源文件已变化，请重新扫描');
    if (resolved.stat.size > MAX_BYTES) throw Error('文件超出容量限制');
    const directory = path.join(root, 'snapshots', item.id);
    await fs.mkdir(directory, { recursive: true }); await realDirectory(directory);
    const destination = path.join(directory, path.basename(item.name));
    if (item.fingerprint) {
      if ((await hashStableFile(destination)).sha256 !== item.fingerprint.sha256) throw Error('固定快照校验失败');
      return item;
    }
    let fingerprint;
    try { fingerprint = await hashStableFile(resolved.path, { copyTo: destination }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      fingerprint = await hashStableFile(resolved.path);
      if ((await fs.lstat(destination)).isSymbolicLink() || (await hashStableFile(destination)).sha256 !== fingerprint.sha256) throw Error('已有快照与原件不一致，需人工核对');
    }
    if (resolved.sha256 && resolved.sha256 !== fingerprint.sha256) throw Error('分享原件与登记哈希不一致');
    if (identity((await resolveSourceFile(source, item.locator)).stat) !== item.identity) throw Error('快照期间原件已变化');
    stats.snapshots++;
    return save('items', { ...item, fingerprint, snapshotPath: destination });
  }
  async function extraction(item) {
    if (!P.EXTRACTABLE.has(path.extname(item.name).toLowerCase())) throw Error('此格式保留手动导入，暂不支持智能分类');
    const key = P.digest([item.studentId || item.sourceId, item.fingerprint.sha256, path.extname(item.name).toLowerCase(), host.extractorVersion || 'v1']);
    const file = path.join(root, 'extractions', `${key}.json`), cached = await read(file, null);
    if (cached?.schema === 3 && cached.sha256 === item.fingerprint.sha256) { stats.cacheHits++; return { ...cached.result, cacheFile: file }; }
    const result = await host.extract(item);
    if (typeof result.text !== 'string') throw Error('内容提取未返回文本');
    const warnings = result.warnings || [];
    const truncated = Boolean(result.truncated || Buffer.byteLength(result.text) > 200 * 1024);
    const blocked = warnings.some(w => !SCOPE_NOTICES.has(w));
    const partial = result.coverage === 'partial' || (warnings.length > 0 && result.coverage !== 'complete');
    const text = Buffer.from(result.text).subarray(0, 200 * 1024).toString('utf8');
    const value = { text, truncated, warnings, blocked, partial };
    await putCache(file, { schema: 3, sha256: item.fingerprint.sha256, result: value }); stats.extracted++;
    return { ...value, cacheFile: file };
  }
  async function checkCurrent(item, source, auto = false) {
    if (closed || blocked) throw Error(blocked || '已停止资料处理');
    const current = sources.get(source.id);
    if (!current || current.detached || current.revision !== source.revision) throw Error('来源设置已变化，需重新确认');
    if (auto && (!host.automaticAllowed(item.studentId || current.studentId) || !current.enabled || !current.automatic)) throw Error('自动投递已暂停');
    if (item.studentId && !P.studentScopeMatches(item, current)) throw Error('来源学生已变化，请人工核对历史资料');
    if (item.receipt) { await verifyReceipt(item, item.receipt); return; }
    const resolved = await resolveItemFile(item, current);
    if (identity(resolved.stat) !== item.identity) {
      // Windows can change ctime when metadata or permissions are touched even
      // though the file bytes and mtime remain unchanged. Preserve the fast
      // identity path, then fall back to a stable content check before
      // rejecting a manually reviewed suggestion.
      if (!item.fingerprint?.sha256) throw Error('来源版本已变化，未投递旧建议');
      const currentFingerprint = await hashStableFile(resolved.path);
      if (currentFingerprint.size !== item.fingerprint.size || currentFingerprint.sha256 !== item.fingerprint.sha256) {
        throw Error('来源版本已变化，未投递旧建议');
      }
    }
    if (item.fingerprint && (await hashStableFile(item.snapshotPath)).sha256 !== item.fingerprint.sha256) throw Error('快照校验失败');
  }
  async function verifyReceipt(item, receipt) {
    if (!receipt?.ok || !receipt.path || !receipt.recordId) throw Error('尚未获得可核验的登记回执');
    await realDirectory(path.dirname(receipt.path));
    if ((await fs.lstat(receipt.path)).isSymbolicLink() || (await hashStableFile(receipt.path)).sha256 !== item.fingerprint.sha256) throw Error('投递副本校验失败');
  }
  async function exists(file) { return Boolean(file) && fs.stat(file).then(s => s.isFile(), () => false); }
  async function removeVerifiedCopy(file, allowedRoot, sha256) {
    const resolved = path.resolve(file), base = path.resolve(allowedRoot);
    if (!within(base, resolved) || resolved === base) throw Error('待清理副本超出受控目录');
    let stat;
    try { stat = await fs.lstat(resolved); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || (await hashStableFile(resolved)).sha256 !== sha256) throw Error('待清理副本校验失败');
    await fs.unlink(resolved); return true;
  }
  async function archive(item, source) {
    await verifyReceipt(item, item.receipt);
    let sourceRemovedAt = item.sourceRemovedAt || '';
    if (source.originalMode === 'archive' && source.staging && !sourceRemovedAt) {
      let original;
      try { original = await resolveSourceFile(source, item.locator); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (original && path.resolve(original.path) !== path.resolve(item.receipt.path)) {
        if (identity(original.stat) !== item.identity || (await hashStableFile(original.path)).sha256 !== item.fingerprint.sha256) throw Error('原件变化，已保留原件及投递副本');
        await verifyReceipt(item, item.receipt);
        const final = await resolveSourceFile(source, item.locator);
        if (identity(final.stat) !== item.identity || (await hashStableFile(final.path)).sha256 !== item.fingerprint.sha256) throw Error('清理中转原件前文件发生变化');
        await fs.unlink(final.path);
      }
      sourceRemovedAt = iso();
    }
    let snapshotPath = item.snapshotPath || '';
    if (snapshotPath && path.resolve(snapshotPath) !== path.resolve(item.receipt.path)) {
      await removeVerifiedCopy(snapshotPath, path.join(root, 'snapshots'), item.fingerprint.sha256); snapshotPath = '';
    }
    return { ...item, snapshotPath, archivePath: '', retainedOriginalPath: item.receipt.path, sourceRemovedAt,
      storageOptimization: { version: 1, at: iso(), releasedSnapshot: !snapshotPath, releasedArchive: false } };
  }
  async function deliverItem(item, source, destination, automatic = false) {
    const selected = P.target(destination);
    if (source.studentId && selected.studentId !== source.studentId && !(selected.studentId === item.studentId && item.studentConfirmation?.reassigned && P.studentScopeMatches(item, source))) throw Error('目标学生超出来源范围');
    if (item.studentConfirmation && selected.studentId !== item.studentId) throw Error('目标超出已确认学生范围，不能跨学生投递');
    await host.validateTarget(selected);
    if (['execution_unknown', 'delivery_reconcile', 'delivering', 'analyzing'].includes(item.status)) throw Error('上一执行结果尚未核对，不能重新投递');
    if (automatic) await checkCurrent(item, source, true);
    if (item.receipt && P.sameTarget(item.target, selected)) {
      await verifyReceipt(item, item.receipt);
      if (selected.categoryId) await host.applyCategory?.(item, automatic);
      item = { ...item, extractionReuse: await host.registerAssociation?.(item) };
      if (item.previous) item = await save('items', { ...item, associationChange: await host.correctAssociation?.(item, item.previous) });
      await host.acknowledge?.(source, item);
      return save('items', { ...await archive(item, source), status: 'delivered', message: item.associationChange?.retained && item.associationChange.status !== 'same_target' ? '改投完成；旧资料因引用或独立来源保留，详见诊断记录' : item.extractionPartial ? '基于可读正文完成投递；图片、公式未完整识别，消化阶段按需补充。' : '' });
    }
    if (['execution_unknown', 'delivery_reconcile', 'delivering', 'analyzing', 'archive_pending'].includes(item.status)) throw Error('上一执行结果尚未核对，不能重新投递');
    if (!item.snapshotPath && !item.receipt) item = await snapshot(item, source);
    // A correction uses the immutable accepted version even if its original was archived.
    if (!item.receipt) await checkCurrent(item, source, automatic);
    else await verifyReceipt(item, item.receipt);
    const previous = item.receipt ? { target: item.target, receipt: item.receipt } : null;
    const deliveryInput = previous?.receipt.path || item.snapshotPath;
    const operationId = P.digest([item.id, selected, item.revision]);
    item = await save('items', { ...item, previous, target: selected, operationId, status: 'delivering', receipt: null, associationChange: null,
      destinationPath: '', executionId: operationId, automatic, message: '', blockReason: null });
    try {
      await host.prepareAssociation?.(item);
      const operation = { ...item, folder: source.folder || path.dirname(item.snapshotPath), name: path.basename(item.name) };
      const receipt = await host.deliver(deliveryInput, await host.validateTarget(selected), operation,
        async patch => { item = await save('items', { ...item, ...patch }); Object.assign(operation, patch); });
      await host.validateTarget(selected);
      await verifyReceipt(item, receipt);
      item = await save('items', { ...item, receipt, status: 'archive_pending', deliveredAt: iso() });
      if (selected.categoryId) await host.applyCategory?.(item, automatic);
      item = { ...item, extractionReuse: await host.registerAssociation?.(item) };
      if (previous) item = await save('items', { ...item, associationChange: await host.correctAssociation?.(item, previous) });
      await host.acknowledge?.(source, item);
      item = await archive(item, source);
      stats.delivered++;
      return save('items', { ...item, revision: item.revision + 1, status: 'delivered',
        message: item.associationChange?.retained && item.associationChange.status !== 'same_target' ? '改投完成；旧资料因引用或独立来源保留，详见诊断记录' : item.extractionPartial ? '基于可读正文完成投递；图片、公式未完整识别，消化阶段按需补充。' : '', manualLocked: !automatic });
    } catch (e) {
      await save('items', { ...item, status: item.receipt ? 'archive_pending' : 'delivery_reconcile', message: e.message });
      throw e;
    }
  }
  async function analyze(item, source, remainingBytes = 200 * 1024) {
    if (!P.studentScopeMatches(item, source)) return save('items', { ...item, status: 'review', message: '来源学生已修改，历史资料须人工核对' });
    if (!item.studentId) return save('items', { ...item, status: 'review', message: '请勾选资料，在“仅确认学生，由AI分类”中选择学生；未发送正文给Agent。也可手动指定位置投递。' });
    const routingSource = { ...source, studentId: item.studentId, target: source.target?.studentId === item.studentId ? source.target : null };
    await checkCurrent(item, source);
    const context = await host.context(item.studentId);
    if (context.studentId !== item.studentId) throw Error('分类上下文超出已确认学生范围');
    item = await snapshot(item, source);
    const data = await extraction(item);
    const textBytes = Buffer.byteLength(data.text);
    if (textBytes > remainingBytes) return { deferred: true, textBytes: 0 };
    item = await save('items', { ...item, originalMissing: false, truncated: data.truncated,
      extractionWarnings: data.warnings, extractionPartial: data.partial, extractionBlocked: data.blocked });
    const review = async message => ({ ...await save('items', { ...item, status: 'review', message }), textBytes });
    if (!data.text.trim() || data.truncated || data.blocked) return review('正文为空、被截断或提取异常，未发送给Agent，请人工确认');
    if (P.risks(data.text)) return review('包含敏感资料线索，未发送给Agent，请人工确认');
    if (Buffer.byteLength(JSON.stringify(context)) > 100 * 1024) return review('项目上下文过多，请指定来源投递项目');
    let suggestion = { candidates: [], sensitive: false, conflict: false, reason: '' };
    let decision = P.automaticTarget({ source: routingSource, item, context, text: data.text, suggestion, rules: [...rules.values()] });
    if (!decision) {
      const examples = [...rules.values()].filter(r => r.sourceId === source.id && r.studentId === item.studentId).slice(-8)
        .map(r => ({ identifier: r.identifier, target: r.target, confirmations: r.count, active: r.active, suspended: r.suspended, version: r.version }));
      const contextHash = P.digest({ context, examples }), cached = await read(data.cacheFile, null);
      if (cached?.contextHash === contextHash && cached.suggestion) { suggestion = P.validateSuggestion(cached.suggestion, context, data.text); stats.cacheHits++; }
      else {
        const executionId = crypto.randomUUID();
        item = await save('items', { ...item, status: 'analyzing', executionId, attempts: item.attempts + 1, blockReason: null,
          execution: { stage: 'qualifying', contextHash, sha256: item.fingerprint.sha256, studentId: item.studentId } });
        const result = await host.classify({ context: { ...context, confirmedExamples: examples, extractionLimitations: data.warnings || [] }, text: data.text, executionId, itemId: item.id,
          onStage: async stage => {
            if (stage.stage === 'not_sent' || stage.stage === 'possibly_sent') {
              await checkCurrent(item, source);
              if (!host.automaticAllowed(item.studentId)) throw Object.assign(Error('自动处理已暂停'), { code: 'ROUTE_CHANGED' });
              if (P.digest({ context: await host.context(item.studentId), examples }) !== contextHash) throw Object.assign(Error('学生项目上下文已变化'), { code: 'ROUTE_CHANGED' });
            }
            item = await save('items', { ...item, execution: { ...item.execution, ...stage } });
          },
          onResult: async result => { await writeJsonAtomic(path.join(root, 'decisions', `${executionId}.json`), {
            itemId: item.id, studentId: item.studentId, sha256: item.fingerprint.sha256, result: P.validateSuggestion(result, context, data.text), at: iso() }); },
        });
        suggestion = P.validateSuggestion(result, context, data.text); stats.classified++;
        await writeJsonAtomic(path.join(root, 'decisions', `${executionId}.json`), { itemId: item.id, result: suggestion, at: iso() });
        const { cacheFile, ...extracted } = data;
        await putCache(data.cacheFile, { schema: 3, sha256: item.fingerprint.sha256, result: extracted, suggestion, contextHash });
      }
      decision = P.automaticTarget({ source: routingSource, item, context, text: data.text, suggestion, rules: [...rules.values()] });
    }
    item = await save('items', { ...item, status: 'review', suggestion, blockReason: null,
      execution: item.execution ? { ...item.execution, stage: 'host_committed' } : null, message: data.partial ? '已基于可读正文判断；图片、公式未完整识别，不影响有充分正文证据的分类投递' : suggestion.reason || '请确认投递位置',
      identifier: P.identifiers(data.text, context.projects).length === 1 ? P.identifiers(data.text, context.projects)[0].id : '',
      proposedTarget: decision?.target || suggestion.candidates[0] || routingSource.target || null, ruleId: decision?.ruleId || '',
      ruleVersion: rules.get(decision?.ruleId)?.version || 0, basis: decision?.basis || 'agent_suggestion' });
    if (decision && source.enabled && host.automaticAllowed(item.studentId)) item = await deliverItem(item, source, decision.target, true);
    return { ...item, textBytes: Buffer.byteLength(data.text) };
  }
  async function processSource(id, manual = false) {
    const source = sources.get(id); if (!source || source.detached || (!manual && !source.enabled)) return;
    const resumeIds=Array.isArray(source.resumeItemIds)&&source.resumeItemIds.length?new Set(source.resumeItemIds):null;
    const inScope=item=>item.sourceId===id&&(!resumeIds||resumeIds.has(item.id));
    let release, batchId, changed = false;
    try {
      if (!resumeIds&&(source.pendingManual || (!source.manualWork && (!source.nextRunAt || Date.parse(source.nextRunAt) <= now())))) {
        changed = (await discover(source)) > 0;
        await save('sources', { ...sources.get(id), lastScanAt: iso(), nextRunAt: P.nextRun(source.schedule || defaults.schedule, now()), error: '', pendingManual: false, manualWork: manual });
      }
      const due = (value) => !value.nextRetryAt || Date.parse(value.nextRetryAt) <= now();
      const reconcileDue = value => ['execution_unknown', 'delivery_reconcile', 'archive_pending'].includes(value.status)
        && Number(value.reconcileAttempts || 0) < 3
        && (!value.nextReconcileAt || Date.parse(value.nextReconcileAt) <= now());
      let pendingAvailable = [...items.values()].some(i => inScope(i) && ['pending', 'retry'].includes(i.status) && due(i));
      const reconcileAvailable = [...items.values()].some(i => inScope(i) && reconcileDue(i));
      if (!pendingAvailable && !reconcileAvailable) {
        if(resumeIds&&![...items.values()].some(item=>inScope(item)&&['pending','retry'].includes(item.status)))await save('sources',{...sources.get(id),resumeItemIds:[],pendingManual:false,manualWork:false});
        return;
      }
      let reconciled = 0;
      for (const value of items.values()) {
        if (reconciled >= 5 || !inScope(value)
          || !['execution_unknown', 'delivery_reconcile'].includes(value.status)
          || !reconcileDue(value)) continue;
        await withItemLock(value.id, async () => {
          let current = items.get(value.id);
          if (!current) return;
          try {
            if (current.status === 'execution_unknown') {
              const saved = await read(fileFor('decisions', current.executionId), null);
              if (saved && saved.itemId === current.id
                && (!saved.studentId || saved.studentId === current.studentId)
                && (!saved.sha256 || saved.sha256 === current.fingerprint?.sha256)) {
                await checkCurrent(current, source);
                await save('items', { ...current, status: 'review', suggestion: saved.result,
                  proposedTarget: saved.result?.candidates?.[0] || null, revision: current.revision + 1,
                  nextReconcileAt: '', message: '已自动找回分类结果，请批量确认。' });
                reconciled++; changed = true;
                return;
              }
              // Reconciliation is control-plane work. Give the host a chance to
              // inspect executor receipts/process state even while heavy work is
              // blocked, but never treat an arbitrary delivery receipt as a
              // classification decision here.
              await host.reconcile?.(current);
              const attempts = Math.max(0, Number(current.reconcileAttempts || 0)) + 1;
              await save('items', { ...current, reconcileAttempts: attempts,
                nextReconcileAt: attempts >= 3 ? '' : new Date(now() + Math.min(15 * 60_000, 30_000 * 2 ** (attempts - 1))).toISOString(),
                message: attempts >= 3 ? '未找到可验证的执行结果；自动核对已暂停，请人工核对。' : '尚未找到执行结果，将自动再次核对。' });
              return;
            }
            const receipt = current.receipt || await host.reconcile?.(current);
            if (!receipt) {
              const attempts = Math.max(0, Number(current.reconcileAttempts || 0)) + 1;
              await save('items', { ...current, reconcileAttempts: attempts,
                nextReconcileAt: attempts >= 3 ? '' : new Date(now() + Math.min(15 * 60_000, 30_000 * 2 ** (attempts - 1))).toISOString(),
                message: attempts >= 3 ? '未找到可验证的投递回执；自动核对已暂停，请人工核对。' : '尚未找到投递回执，将自动再次核对。' });
              return;
            }
            await verifyReceipt(current, receipt);
            await save('items', { ...current, receipt, status: 'archive_pending', nextReconcileAt: '',
              message: '已找回投递回执，等待后台资源完成归档。' });
            reconciled++; changed = true;
          } catch (error) {
            const attempts = Math.max(0, Number(current.reconcileAttempts || 0)) + 1;
            await save('items', { ...current, reconcileAttempts: attempts,
              nextReconcileAt: attempts >= 3 ? '' : new Date(now() + Math.min(15 * 60_000, 30_000 * 2 ** (attempts - 1))).toISOString(),
              message: attempts >= 3 ? `${error.message}；自动核对已暂停，请人工核对。` : error.message });
          }
        });
        await yieldTurn();
      }
      pendingAvailable = [...items.values()].some(i => inScope(i) && ['pending', 'retry'].includes(i.status) && due(i));
      let archiveAvailable = [...items.values()].some(i => inScope(i) && i.status === 'archive_pending' && reconcileDue(i));
      if (!pendingAvailable && !archiveAvailable) {
        if (reconciled && (sources.get(id)?.waitingReason || sources.get(id)?.waitingSince)) {
          await save('sources', { ...sources.get(id), waitingReason: '', waitingSince: '' });
        }
        if (reconciled) await host.settleItems?.([...items.values()].filter(item => item.sourceId === id));
        return reconciled;
      }
      release = await host.acquire(source, manual);
      if (!release) {
        const waitingReason = host.waitingReason?.(source, manual) || '等待后台资源空闲，稍后自动继续；未调用Agent';
        if (sources.get(id)?.waitingReason !== waitingReason || !sources.get(id)?.waitingSince) {
          await save('sources', { ...sources.get(id), waitingReason,
            waitingSince: sources.get(id)?.waitingSince || iso() }); changed = true;
        }
        return reconciled;
      }
      if (archiveAvailable) {
        let archived = 0;
        for (const value of items.values()) {
          if (archived >= 5 || !inScope(value) || value.status !== 'archive_pending' || !reconcileDue(value)) continue;
          await withItemLock(value.id, async () => {
            const current = items.get(value.id);
            if (!current || current.status !== 'archive_pending') return;
            try {
              await deliverItem(current, source, current.target, false);
              archived++; reconciled++; changed = true;
            } catch (error) {
              const attempts = Math.max(0, Number(current.reconcileAttempts || 0)) + 1;
              await save('items', { ...current, reconcileAttempts: attempts,
                nextReconcileAt: attempts >= 3 ? '' : new Date(now() + Math.min(15 * 60_000, 30_000 * 2 ** (attempts - 1))).toISOString(),
                message: attempts >= 3 ? `${error.message}；自动核对已暂停，请人工核对。` : error.message });
            }
          });
          await yieldTurn();
        }
        archiveAvailable = [...items.values()].some(i => inScope(i) && i.status === 'archive_pending' && reconcileDue(i));
      }
      if (!pendingAvailable) {
        if (reconciled) await host.settleItems?.([...items.values()].filter(item => item.sourceId === id));
        return reconciled;
      }
      const batchItems = [...items.values()]
        .filter(i => inScope(i) && ['pending', 'retry'].includes(i.status) && (!i.nextRetryAt || Date.parse(i.nextRetryAt) <= now()))
        .slice(0, 20)
        .map(i => ({ id: i.id, revision: i.revision || '', studentId: i.studentId || '',
          target: i.target || i.proposedTarget || null, sha256: i.fingerprint?.sha256 || '', attempts: Number(i.attempts || 0) }));
      batchId = await host.beginBatch?.(source, manual, { sourceRevision: source.revision, items: batchItems });
      if (sources.get(id)?.error || sources.get(id)?.waitingReason || sources.get(id)?.waitingSince) {
        await save('sources', { ...sources.get(id), error: '', waitingReason: '', waitingSince: '' });
      }
      let count = 0, budget = 0;
      for (const value of items.values()) {
        if (count >= 20 || budget >= 200 * 1024 || closed || (!manual && !host.automaticAllowed())) break;
        if (!inScope(value) || !['pending', 'retry'].includes(value.status) || (value.nextRetryAt && Date.parse(value.nextRetryAt) > now())) continue;
        if (sources.get(id)?.revision !== source.revision || (!manual && !sources.get(id)?.enabled)) break;
        count++; changed = true;
        try {
          const result = await withItemLock(value.id, () => analyze(items.get(value.id) || value, source, 200 * 1024 - budget));
          if (result?.deferred) break;
          budget += result?.textBytes || 0;
        }
        catch (e) {
          if (blocked) throw e;
          await withItemLock(value.id, async () => {
            const current = items.get(value.id);
            if (!current || e.code === 'original_missing' || ['delivery_reconcile', 'archive_pending', 'delivered', 'ignored'].includes(current.status)) return;
            const unknown = e.code === 'execution_unknown';
            const retry = taskRetryDecision({ ...current, attempt: current.attempts, maxAttempts: 3 }, { code: e.code, message: e.message }, { now: now(), stopConfirmed: e.stopConfirmed === true });
            const resourceRetry = e.blockReason?.category === 'resource' && e.blockReason.recoverable;
            const mayRetry = !e.blockReason && retry.autoRetry || resourceRetry && (retry.autoRetry || e.code === 'EXECUTOR_CIRCUIT_OPEN');
            await save('items', { ...current, status: unknown ? 'execution_unknown' : mayRetry ? 'retry' : 'review',
              blockReason: e.blockReason || null, nextRetryAt: mayRetry ? retry.nextRetryAt || new Date(now() + 60000).toISOString() : '', message: e.message });
          });
        }
        await yieldTurn();
      }
      const finalItems = batchItems.map(({ id: itemId }) => items.get(itemId)).filter(Boolean);
      await host.endBatch?.(batchId, null, { count, sourceId: id,
        itemStates:finalItems.map(item=>({id:item.id,status:item.status,receipt:Boolean(item.receipt)})),
        delivered: finalItems.filter(item => item.status === 'delivered').length,
        ignored: finalItems.filter(item => item.status === 'ignored').length,
        review: finalItems.filter(item => item.status === 'review').length,
        unknown: finalItems.filter(item => item.status === 'execution_unknown').length,
        reconcile: finalItems.filter(item => ['delivery_reconcile', 'archive_pending'].includes(item.status)).length,
        pending: finalItems.filter(item => ['pending', 'retry', 'analyzing', 'delivering'].includes(item.status)).length });
      await host.settleItems?.(finalItems);
      if(resumeIds&&!finalItems.some(item=>['pending','retry'].includes(item.status)))await save('sources',{...sources.get(id),resumeItemIds:[],pendingManual:false,manualWork:false});
      return count;
    } catch (e) {
      if (!blocked) await save('sources', { ...sources.get(id), error: e.message, pendingManual: false, nextRunAt: P.nextRun(source.schedule || defaults.schedule, now()) });
      await host.endBatch?.(batchId, e);
    } finally {
      try { if (!blocked && sources.get(id)?.manualWork && ![...items.values()].some(i => i.sourceId === id && ['pending', 'retry'].includes(i.status))) await save('sources', { ...sources.get(id), manualWork: false }); }
      finally { release?.(); if (changed) host.changed?.(); }
    }
  }
  async function tick() {
    await init(); if (closed || blocked || active) return active;
    let progress = false;
    const work = (async () => {
      const ordered = [...sources.values()]; if (ordered.length) turn %= ordered.length;
      const round = [...ordered.slice(turn), ...ordered.slice(0, turn)].sort((a, b) => Number(Boolean(b.pendingManual || b.manualWork)) - Number(Boolean(a.pendingManual || a.manualWork)));
      for (let n = 0; n < ordered.length; n++) {
        const s = sources.get(round[n].id);
        const pending = [...items.values()].some(i => i.sourceId === s.id && ['pending', 'retry'].includes(i.status) && (!i.nextRetryAt || Date.parse(i.nextRetryAt) <= now()));
        const reconciling = [...items.values()].some(i => i.sourceId === s.id
          && ['execution_unknown', 'delivery_reconcile', 'archive_pending'].includes(i.status)
          && (!i.nextReconcileAt || Date.parse(i.nextReconcileAt) <= now()) && Number(i.reconcileAttempts || 0) < 3);
        if (!s.detached && (s.pendingManual || s.manualWork && (pending || reconciling)
          || (host.automaticAllowed() && s.enabled && (pending || reconciling || s.nextRunAt && Date.parse(s.nextRunAt) <= now())))) {
          progress = Boolean(await processSource(s.id, Boolean(s.pendingManual || s.manualWork))) || progress;
        }
      }
      turn++;
    })();
    active = work;
    try { await work; } finally {
      active = null;
      if (!closed && !blocked && progress && [...items.values()].some(i => { const s = sources.get(i.sourceId); return s && !s.detached && (s.manualWork || s.enabled && host.automaticAllowed(s.studentId)) && (
        ['pending', 'retry'].includes(i.status) && (!i.nextRetryAt || Date.parse(i.nextRetryAt) <= now())
        || ['execution_unknown', 'delivery_reconcile', 'archive_pending'].includes(i.status)
          && (!i.nextReconcileAt || Date.parse(i.nextReconcileAt) <= now()) && Number(i.reconcileAttempts || 0) < 3); })) setImmediate(() => tick().catch(e => host.onError?.(e)));
    }
  }
  async function feedback(item, before, selected, action) {
    const key = P.digest([item.sourceId, item.studentId, item.identifier || '']);
    const prior = rules.get(key);
    const consistent = action !== 'correct' && (!before || P.sameTarget(before, selected)) && (!prior?.target || P.sameTarget(prior.target, selected));
    const confirmations = consistent ? [...new Set([...(prior?.confirmations || []), item.fingerprint?.sha256 || item.id])].slice(-3) : [];
    if (item.identifier) await save('rules', { id: key, sourceId: item.sourceId, studentId: item.studentId, identifier: item.identifier,
      target: selected, confirmations, count: confirmations.length, active: consistent && confirmations.length >= 3,
      suspended: !consistent || Boolean(prior?.suspended && confirmations.length < 3), version: (prior?.version || 0) + 1, updatedAt: iso() });
  }
  async function reassign(item, source, studentId, requestId, requestedRevision, analyzeAgain) {
    if (!source || source.detached) throw Error('来源已解除关联');
    if (!['pending', 'review', 'retry', 'delivered'].includes(item.status)) throw Error('上一执行尚未核对，不能更正学生或重新派发');
    if (item.blockReason?.category === 'unknown') throw Error('请先核对上次执行结果');
    if (analyzeAgain && item.blockReason?.category === 'security') throw Error('安全原因须人工核对，不能通过更正学生自动重派');
    if (analyzeAgain && !source.enabled) throw Error('请先开启资料来源，再重新智能分类');
    if (item.studentId) await host.context(item.studentId);
    const context = await host.context(studentId);
    if (context.studentId !== studentId) throw Error('学生授权范围不匹配');
    if (item.receipt) await verifyReceipt(item, item.receipt);
    else await checkCurrent(item, source);
    for (const rule of rules.values()) if (rule.sourceId === source.id && rule.studentId === item.studentId && rule.identifier === item.identifier) {
      await save('rules', { ...rule, active: false, suspended: true, version: (rule.version || 0) + 1 });
    }
    if (analyzeAgain) await save('sources', { ...sources.get(source.id), manualWork: true });
    const history = [...(item.studentCorrections || []), { requestId, requestedRevision, from: item.studentId,
      to: studentId, at: iso(), target: item.target || null, suggestion: item.suggestion || null, execution: item.execution || null }];
    if (history.length > 100) throw Error('此记录更正次数已达上限，请保留历史并人工核对');
    return save('items', { ...item, studentId, studentCorrections: history, revision: item.revision + 1,
      studentConfirmation: { studentId, sourceId: source.id, sourceStudentId: source.studentId, sourceRevision: source.revision,
        identity: item.identity, reassigned: true, requestId, requestedRevision, at: iso() },
      status: analyzeAgain ? 'pending' : item.status, manualLocked: false, suggestion: null, proposedTarget: null,
      execution: null, blockReason: null, executionId: '', ruleId: '', ruleVersion: 0, identifier: '', basis: '', nextRetryAt: '', attempts: 0,
      message: analyzeAgain ? '所属学生已更正，按新学生范围重新智能分类；旧建议已清除。' : '所属学生已更正，准备投递。' });
  }
  async function decide(request) {
    await init();
    const id = safeId(request.requestId), payloadHash = P.digest(request), receiptFile = fileFor('decisions', id);
    if (!Array.isArray(request.items) || !request.items.length || request.items.length > 100 || !['accept', 'correct', 'confirm_student', 'reassign_student', 'ignore', 'restore', 'retry', 'reconcile', 'archive_unknown', 'restart_unknown'].includes(request.action)) throw Error('批量处理请求无效');
    const previous = await serial(async () => {
      const saved = await read(receiptFile, null);
      if (saved?.payloadHash !== undefined && saved.payloadHash !== payloadHash) throw Error('请求编号被用于不同操作');
      if (!saved) await writeJsonAtomic(receiptFile, { payloadHash, results: [], at: iso() });
      return saved;
    });
    if (previous?.result) return previous.result;
    const results = previous?.results || [];
      for (const selected of request.items) {
        if (results.some(r => r.id === selected.id)) continue;
        await withItemLock(selected.id, async () => {
        try {
          const checkpoint = await read(receiptFile, null);
          const checkpointResult = checkpoint?.results?.find(result => result.id === selected.id);
          if (checkpointResult) { results.push(checkpointResult); return; }
          let item = items.get(selected.id);
          if (request.action === 'reconcile' && item?.status === 'delivered'
            && Number(item.revision || 0) >= Number(selected.revision || 0)) {
            results.push({ id: selected.id, ok: true, status: item.status, recovered: true }); return;
          }
          if (['confirm_student', 'reassign_student'].includes(request.action) && item?.studentConfirmation?.requestId === id && item.studentConfirmation.requestedRevision === selected.revision) {
            results.push({ id: selected.id, ok: true, status: item.status, recovered: true }); return;
          }
          const continuingCorrection = request.action === 'correct' && item?.studentConfirmation?.requestId === id
            && item.studentConfirmation.requestedRevision === selected.revision;
          if (!item || item.revision !== selected.revision && !continuingCorrection) throw Error('资料版本已变化，请刷新');
          const source = sources.get(item.sourceId);
          const before = item.proposedTarget || item.target;
          if (request.action === 'reassign_student') {
            if (selected.confirmedStudentChange !== true || !selected.studentId) throw Error('请明确确认更正所属学生并重新分类');
            item = await reassign(item, source, String(selected.studentId), id, selected.revision, true);
          } else if (request.action === 'confirm_student') {
            const studentId = String(selected.studentId || '');
            if (!studentId) throw Error('请选择要确认的学生');
            if (!source || source.detached || !source.enabled) throw Error('请先开启资料来源，再确认学生并分析');
            if (!['pending', 'review', 'retry'].includes(item.status) || item.receipt || item.manualLocked) throw Error('仅未投递且无未知执行的待办可以确认学生');
            if (item.studentId && item.studentId !== studentId || source.studentId && source.studentId !== studentId) throw Error('资料已属于其他学生，不能批量改归属');
            const context = await host.context(studentId);
            if (context.studentId !== studentId) throw Error('学生授权范围不匹配');
            await checkCurrent(item, source);
            // Queue before committing the item, so recovery cannot strand it.
            // No scan, OCR or Agent call occurs inside this action.
            await save('sources', { ...sources.get(source.id), manualWork: true });
            item = await save('items', { ...item, studentId, status: 'pending', revision: item.revision + 1,
              studentConfirmation: { studentId, sourceId: source.id, sourceRevision: source.revision,
                identity: item.identity, requestId: id, requestedRevision: selected.revision, at: iso() },
              automationDisposition: '', suggestion: null, proposedTarget: null, blockReason: null, execution: null, ruleId: '', ruleVersion: 0, identifier: '', basis: '',
              nextRetryAt: '', executionId: '', attempts: 0, message: '学生已确认，已排队智能分析；可信项按来源设置自动投递，其余请确认。' });
          } else if (request.action === 'archive_unknown') {
            if (!['execution_unknown', 'delivery_reconcile'].includes(item.status) || Number(item.reconcileAttempts || 0) < 3) throw Error('仅自动核对已耗尽的未知执行可以归档');
            item = await save('items', { ...item, previousStatus: item.status, status: 'ignored', manualLocked: true,
              revision: item.revision + 1, nextReconcileAt: '', unknownResolution: { disposition: 'abandoned',
                executionId: item.executionId || '', reconcileAttempts: Number(item.reconcileAttempts || 0), requestId: id, at: iso() },
              lastDecision: { action: 'archive_unknown', requestId: id, at: iso() },
              message: '已确认放弃本次未知执行并归档；原执行、快照与审计记录保留，未重新调用Agent。' });
          } else if (request.action === 'restart_unknown') {
            if (item.status !== 'execution_unknown' || Number(item.reconcileAttempts || 0) < 3) throw Error('仅自动核对已耗尽的未知分类执行可以明确重新执行');
            if (!source || source.detached || !source.enabled) throw Error('请先开启资料来源');
            await checkCurrent(item, source);
            const history = [...(item.executionHistory || []), { executionId: item.executionId || '', execution: item.execution || null,
              status: item.status, reconcileAttempts: Number(item.reconcileAttempts || 0), resolution: 'user_requested_new_execution', requestId: id, at: iso() }];
            if (history.length > 100) throw Error('未知执行历史已达上限，请先归档本次执行');
            await save('sources', { ...sources.get(source.id), manualWork: true });
            item = await save('items', { ...item, status: 'pending', revision: item.revision + 1, executionId: '', execution: null,
              executionHistory: history, reconcileAttempts: 0, nextReconcileAt: '', nextRetryAt: '', blockReason: null,
              attempts: 0, suggestion: null, proposedTarget: null, manualLocked: false,
              message: '已保留旧未知执行审计，并按用户明确要求创建新的独立执行。' });
          } else if (request.action === 'ignore') {
            if (!['review', 'pending', 'retry'].includes(item.status)) throw Error('此状态不能忽略');
            item = await save('items', { ...item, previousStatus: item.status, status: 'ignored', manualLocked: true, revision: item.revision + 1,
              lastDecision: { action: 'ignore', requestId: id, at: iso() } });
          } else if (request.action === 'restore') {
            if (item.status !== 'ignored') throw Error('只有已忽略资料可恢复');
            item = await save('items', { ...item, status: 'review', revision: item.revision + 1 });
          } else if (request.action === 'retry') {
            if (!['review', 'retry'].includes(item.status) || item.receipt) throw Error('未知执行或已投递资料不能重新分析');
            if (item.manualLocked) throw Error('人工锁定的资料请手动指定位置，不自动覆盖');
            if (item.blockReason?.recoverable === false) throw Error('此记录需要核对上次执行或安全原因，不能重新派发');
            if (!source || source.detached || !source.enabled) throw Error('请先开启资料来源');
            await checkCurrent(item, source);
            await save('sources', { ...sources.get(source.id), manualWork: true });
            item = await save('items', { ...item, originalMissing: false, status: 'pending', nextRetryAt: '', revision: item.revision + 1,
              suggestion: null, proposedTarget: null, blockReason: null, execution: null, message: '已加入分析队列；完成后请在本学生的待处理／已投递查看。' });
          } else if (request.action === 'reconcile') {
            if (item.status === 'execution_unknown') {
              const saved = await read(fileFor('decisions', item.executionId), null);
              if (!saved || saved.itemId !== item.id || (saved.studentId && saved.studentId !== item.studentId)
                || (saved.sha256 && saved.sha256 !== item.fingerprint?.sha256)) throw Error('尚无可验证分类回执，保持待核对');
              await checkCurrent(item, source);
              item = await save('items', { ...item, status: 'review', suggestion: saved.result, proposedTarget: saved.result.candidates[0] || null, revision: item.revision + 1, message: '已找回分类结果，请确认' });
            } else {
              if (!['delivery_reconcile', 'archive_pending', 'delivering'].includes(item.status)) throw Error('此资料无需核对投递');
              const receipt = item.receipt || await host.reconcile?.(item);
              await verifyReceipt(item, receipt);
              item = await save('items', { ...item, receipt, status: 'archive_pending' });
              item = await deliverItem(item, source, item.target, false);
            }
          } else {
            const destination = P.target(selected.target || item.proposedTarget);
            if (request.action === 'accept' && !P.sameTarget(destination, item.proposedTarget)) throw Error('目标已改变，请使用纠正投递');
            if (source.detached) throw Error('来源已解除关联');
            await host.validateTarget(destination);
            if (request.action === 'correct' && destination.studentId !== item.studentId) {
              if (item.studentId && selected.confirmedStudentChange !== true) throw Error('请明确确认将所选资料更正为目标学生');
              item = await reassign(item, source, destination.studentId, id, selected.revision, false);
            }
            if (request.action === 'correct' && item.identifier) await feedback(item, before, destination, 'correct');
            item = await deliverItem(item, source, destination);
            if (request.action === 'accept') await feedback(item, before, destination, 'accept');
            item = await save('items', { ...item, manualLocked: true, revision: item.revision + 1, lastDecision: { action: request.action, requestId: id, before, after: destination, at: iso() } });
          }
          results.push({ id: selected.id, ok: true, status: item.status, feedback: {
            action: request.action, sourceId: item.sourceId, studentId: item.target?.studentId || item.studentId,
            requestedRevision: selected.revision, resultingRevision: item.revision, sha256: item.fingerprint?.sha256 || '',
            suggestion: item.suggestion || null, before: before || null, after: item.target || null,
            ruleId: item.ruleId || '', ruleVersion: item.ruleVersion || 0, at: iso(),
          } });
        } catch (e) { results.push({ id: selected.id, ok: false, message: e.message }); }
        });
        await serial(() => writeJsonAtomic(receiptFile, { payloadHash, results, at: iso() }));
      }
    const result = { results };
    await serial(() => writeJsonAtomic(receiptFile, { payloadHash, result, at: iso() }));
    await host.settleItems?.(results.filter(entry => entry.ok).map(entry => items.get(entry.id)).filter(Boolean));
    if (['confirm_student', 'reassign_student', 'retry', 'restart_unknown'].includes(request.action) && results.some(r => r.ok)) setImmediate(() => tick().catch(e => host.onError?.(e)));
    host.changed?.(); return result;
  }
  return {
    init, bootstrap, syncConversationRouting, updateSource, tick, decide,
    async intakeManual(sourceId, entries) {
      await init();
      return serial(async () => {
        const source = sources.get(sourceId);
        if (!source || source.detached || !Array.isArray(entries) || !entries.length || entries.length > 100) throw Error('手动收件来源无效');
        const result = [];
        for (const entry of entries) {
          let resolved;
          try { resolved = await resolveSourceFile(source, entry.locator); }
          catch (error) {
            const previous = entry.identity && items.get(P.digest([source.id, entry.locator, entry.identity]));
            if (error.code !== 'ENOENT' || previous?.status !== 'delivered' || !previous.receipt) throw error;
            await verifyReceipt(previous, previous.receipt);
            result.push({ id: previous.id, revision: previous.revision }); continue;
          }
          const version = identity(resolved.stat);
          if (entry.identity && entry.identity !== version) throw Error('原文件已变化，请刷新');
          const id = P.digest([source.id, entry.locator, version]);
          let item = items.get(id);
          // A released share object resolves to its verified receipt; retain the original intake identity.
          if (!item && source.type === 'share') item = [...items.values()].find(i => i.sourceId === source.id && i.locator === entry.locator && i.receipt);
          if (!item) {
            if (!resolved.stat.size || resolved.stat.size > MAX_BYTES) throw Error('文件须为1字节至100 MiB');
            if (now() - resolved.stat.mtimeMs < (host.stableAgeMs ?? 1500)) throw Error('文件仍在写入，请稍后重试');
            item = await save('items', { id, sourceId: source.id, sourceRevision: source.revision, sourceType: source.type,
              locator: entry.locator, name: path.basename(entry.name), size: resolved.stat.size, identity: version,
              studentId: source.studentId, revision: 1, createdAt: iso(), status: 'review', supported: true, manualLocked: false, attempts: 0 });
          }
          result.push({ id: item.id, revision: item.revision });
        }
        return result;
      });
    },
    async legacyRecords(folder) {
      await init();
      const ids = new Set([...sources.values()].filter(s => s.folder && path.resolve(s.folder).toLowerCase() === path.resolve(folder).toLowerCase()).map(s => s.id));
      return [...items.values()].filter(i => ids.has(i.sourceId)).map(i => ({ id: i.id, identity: i.identity, name: i.name, size: i.size,
        status: i.status, target: i.target, message: i.message, deliveredAt: i.deliveredAt, receipt: i.receipt }));
    },
    async resumeAgent(studentId, requestId) {
      await init(); await host.context(studentId);
      const candidates = [], skipReasons = {};
      for (const item of items.values()) {
        if (item.studentId !== studentId || !item.blockReason) continue;
        const source = sources.get(item.sourceId);
        const reason = !item.blockReason.recoverable ? '需核对执行或安全原因' : item.manualLocked ? '人工锁定或已忽略'
          : item.originalMissing ? '原件失效' : !source?.enabled || source?.detached ? '来源暂停或已解除关联'
          : item.receipt || !['review', 'retry'].includes(item.status) ? '状态不允许恢复' : '';
        if (reason) skipReasons[reason] = (skipReasons[reason] || 0) + 1;
        else candidates.push(item);
      }
      const skipped = Object.values(skipReasons).reduce((a, b) => a + b, 0);
      const results = [];
      if (!host.automaticAllowed(studentId)) return { count: 0, skipped: skipped + candidates.length, skipReasons: { ...skipReasons, '自动处理暂停': candidates.length }, results: [], message: '自动处理已暂停' };
      for (let offset = 0; offset < candidates.length; offset += 100) {
        const result = await decide({ requestId: `${safeId(requestId)}-${offset}`, action: 'retry',
          items: candidates.slice(offset, offset + 100).map(i => ({ id: i.id, revision: i.revision })) });
        results.push(...result.results); await yieldTurn();
      }
      return { count: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, skipped, skipReasons, results };
    },
    hasPendingWork() { return !closed && !blocked && [...items.values()].some(i => { const s = sources.get(i.sourceId); return s && !s.detached && (s.manualWork || s.pendingManual || s.enabled && host.automaticAllowed(s.studentId)) && (
      ['pending', 'retry'].includes(i.status) && (!i.nextRetryAt || Date.parse(i.nextRetryAt) <= now())
      || ['execution_unknown', 'delivery_reconcile', 'archive_pending'].includes(i.status)
        && (!i.nextReconcileAt || Date.parse(i.nextReconcileAt) <= now()) && Number(i.reconcileAttempts || 0) < 3); }); },
    async pause(id) { await init(); const s = sources.get(id); if (!s) throw Error('来源不存在'); return save('sources', { ...s, enabled: false, automatic: false, pendingManual: false, manualWork: false, resumeItemIds: [], waitingReason: '', waitingSince: '', revision: s.revision + 1, nextRunAt: '' }); },
    async notifySource(type, studentId) { await init(); for (const s of sources.values()) if (s.type === type && s.studentId === String(studentId) && s.enabled && !s.detached) await save('sources', { ...s, nextRunAt: iso() });
      if (host.automaticAllowed()) setImmediate(() => tick().catch(e => host.onError?.(e))); },
    async recover() { await init(); for (const item of items.values()) {
      if (item.status === 'analyzing') {
        const safe = ['qualifying', 'not_sent'].includes(item.execution?.stage);
        await save('items', { ...item, status: safe ? 'pending' : 'execution_unknown',
          message: safe ? '上次尚未发送正文，将自动继续' : '上次分类结果待核对，不自动重派' });
      }
      if (item.status === 'delivering') await save('items', { ...item, status: 'delivery_reconcile', message: '上次投递待核对，不重复导入' });
    } },
    async sources() { await init(); return { sources: [...sources.values()].map(clone), defaults: clone(defaults), running: Boolean(active), error: blocked, statistics: { ...stats } }; },
    async setDefaults(input) { await init(); const s = P.schedule(input.schedule); return serial(async () => { const value = { schedule: s }; await writeJsonAtomic(path.join(root, 'defaults.json'), value); defaults = value;
      for (const source of sources.values()) if (!source.schedule) await save('sources', { ...source, nextRunAt: source.enabled ? P.nextRun(s, now()) : '' }); return value; }); },
    async detach(id) { await init(); return serial(async () => { const s = sources.get(id); if (!s) throw Error('来源不存在'); return save('sources', { ...s, enabled: false, automatic: false, detached: true, revision: s.revision + 1, pendingManual: false, manualWork: false, resumeItemIds: [], waitingReason: '', waitingSince: '', nextRunAt: '' }); }); },
    async requestScan(id) { await init(); const s = sources.get(id); if (!s || s.detached) throw Error('来源不存在'); await save('sources', { ...s, pendingManual: true }); setImmediate(() => tick().catch(e => host.onError?.(e))); return { queued: true }; },
    async requestResume(id,itemIds,scope={}){
      await init();const source=sources.get(id);if(!source||source.detached)throw Error('来源不存在');
      if(scope.automatic&&(!source.enabled||!source.automatic))return {ok:true,queued:false,reason:'automation_disabled',message:'该来源自动处理已关闭，保留原批次。'};
      if(scope.studentId!=null&&String(source.studentId||'')!==String(scope.studentId))throw Error('来源学生已变化，请核对原批次');
      const ids=[...new Set((itemIds||[]).map(String))];if(!ids.length||ids.length>100)throw Error('原批次资料范围无效');
      const safe=[],protectedItemIds=[];
      for(const key of ids){const item=items.get(key);if(!item||item.sourceId!==id)throw Error('原批次包含失效或不同来源资料');
        if(['pending','retry'].includes(item.status)&&!item.receipt)safe.push(key);else protectedItemIds.push(key);}
      if(safe.length){await save('sources',{...source,resumeItemIds:[...new Set([...(source.resumeItemIds||[]),...safe])].slice(0,100),pendingManual:true});setImmediate(()=>tick().catch(error=>host.onError?.(error)));}
      return {ok:true,queued:safe.length>0,itemIds:safe,protectedItemIds,message:safe.length?'原批次安全项已排队，未决执行保持核对':'没有可安全重派的原批次资料，请核对原回执'};
    },
    async list(query = {}) {
      await init(); const rows = [], sourceId = String(query.sourceId || ''), scope = String(query.studentId || '');
      const page = Math.max(1, Math.floor(Number(query.page) || 1)), size = 25;
      for (const i of items.values()) {
        if (sourceId && i.sourceId !== sourceId || scope && i.studentId && i.studentId !== scope) continue;
        if (query.status === 'delivered' ? i.status !== 'delivered' : query.status === 'ignored' ? i.status !== 'ignored' : ['delivered', 'ignored'].includes(i.status)) continue;
        rows.push(i);
      }
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { total: rows.length, page, pageSize: size, rows: rows.slice((page - 1) * size, page * size).map(i => ({
        id: i.id, sourceId: i.sourceId, sourceName: sources.get(i.sourceId)?.name, sourceType: i.sourceType, studentId: i.studentId, name: i.name, size: i.size, status: i.status, revision: i.revision, automationDisposition: i.automationDisposition || '', originalMissing: Boolean(i.originalMissing),
        blockReason: i.blockReason || null, execution: i.execution ? { stage: i.execution.stage, providerId: i.execution.providerId,
          switched: Boolean(i.execution.switched || i.execution.attempts?.some(a => a.providerId && a.providerId !== i.execution.providerId)) } : null,
        message: i.status === 'pending' && sources.get(i.sourceId)?.waitingReason || i.message, proposedTarget: i.proposedTarget, target: i.target, reason: i.status === 'pending' ? sources.get(i.sourceId)?.waitingReason || i.message : i.originalMissing || i.extractionPartial || i.associationChange?.retained ? i.message : i.suggestion?.candidates[0]?.reason || i.message, manualLocked: i.manualLocked,
        reconcileAttempts: Number(i.reconcileAttempts || 0), reconcileExhausted: ['execution_unknown', 'delivery_reconcile'].includes(i.status) && Number(i.reconcileAttempts || 0) >= 3, createdAt: i.createdAt,
      })) };
    },
    async detail(id) { await init(); const i = items.get(id); if (!i) throw Error('资料不存在'); return clone(i); },
    async openOriginal(id) { await init(); const i = items.get(id); if (!i) throw Error('资料不存在');
      const source = sources.get(i.sourceId);
      if (i.receipt) { await verifyReceipt(i, i.receipt); return i.receipt.path; }
      const file = i.archivePath || (await resolveItemFile(i, source)).path;
      if (i.archivePath && (await hashStableFile(file)).sha256 !== i.fingerprint.sha256) throw Error('归档原件已变化'); return file; },
    async close() { closed = true; await active?.catch(() => {}); await commands.catch(() => {}); },
  };
}
module.exports = { createSmartInbox, identity, within };
