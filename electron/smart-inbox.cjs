'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashStableFile, writeJsonAtomic } = require('./project-materials.cjs');
const { realDirectory, MAX_BYTES, ALLOWED } = require('./download-inbox.cjs');
const P = require('./smart-inbox-policy.cjs');
const { inspectConversation } = require('./smart-inbox-conversation.cjs');
const { taskRetryDecision } = require('./task-recovery-policy.cjs');
const Content = require('./smart-inbox-content.cjs');
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
// Groups are presentation metadata only. Legacy messages are interpreted for
// display; they never authorize a retry, ignore, or delivery.
function reasonGroup(item) {
  const message = String(item.message || '');
  if (item.status === 'execution_unknown') return 'execution_unknown';
  if (['delivery_reconcile', 'archive_pending', 'delivering'].includes(item.status)) return 'receipt_review';
  if (item.originalMissing) return 'original_missing';
  if (P.isTechnicalWait(item)) return 'technical_wait';
  if (item.reasonCode === 'student_conflict' || /多个学生|涉及其他学生/.test(message)) return 'student_conflict';
  if (!item.studentId) return 'student_unknown';
  if (item.conversationKind === 'internal_task') return 'internal_task';
  if (item.blockReason?.category === 'agent') return 'agent';
  if (['no_candidate', 'candidate_scope_too_large'].includes(item.reasonCode)
    || /项目上下文过多|候选项目过多|没有足够的本机证据|无法可靠缩小|尚无可信项目候选/.test(message)) return 'no_candidate';
  if (item.status === 'review') return 'classification_review';
  return 'other';
}

// The host owns scheduling and resource admission. This service owns no timer,
// watcher, model credentials or arbitrary destination-file capability.
function createSmartInbox(host) {
  const root = host.directory, sources = new Map(), items = new Map(), rules = new Map(), userRules = new Map();
  const cacheFiles = new Map(), itemOperations = new Map();
  const previews = new Map(), batches = new Map();
  const localProbeCursors = new Map();
  let readIndex = null;
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
  const cleanup = require('./smart-inbox-cleanup.cjs').createInboxCleanup({ root, items, sources, save, now, withItemLock, host,
    verifyOriginal: async (item, source) => {
      if (!source || source.detached) throw Error('来源不可用');
      await host.context(item.studentId, { mode: 'light' });
      const original = await resolveSourceFile(source, item.locator), hash = await hashStableFile(original.path);
      if (hash.sha256 !== item.fingerprint?.sha256) throw Error('原件内容已变化，请按新资料扫描');
    } });
  const batchRuntime = require('./smart-inbox-batches.cjs').createInboxBatches({ init, items, sources, batches, save, now,
    changed: host.changed, reason: reasonGroup, previewOne, decide, checkCurrent, withItemLock,
    allowed: id => host.automaticAllowed(id), wake: () => setImmediate(() => tick().catch(error => host.onError?.(error))),
    decisionReceipt: id => read(fileFor('decisions', id), null) });
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
    ({ sources, items, rules, 'user-rules': userRules, batches }[kind])?.set(value.id, value);
    if (kind === 'items' && readIndex) {
      try { readIndex.update(value); } catch { try { readIndex.close(); } catch {} readIndex = null; }
    }
    return value;
  }
  async function init() {
    return loaded ||= (async () => {
      for (const name of ['sources', 'items', 'rules', 'user-rules', 'rule-audit', 'decisions', 'snapshots', 'extractions', 'batches', 'analysis-budgets', 'raw-results']) {
        await fs.mkdir(path.join(root, name), { recursive: true }); await realDirectory(path.join(root, name));
      }
      for (const [kind, map] of [['sources', sources], ['items', items], ['rules', rules], ['user-rules', userRules], ['batches', batches]]) {
        for await (const entry of await fs.opendir(path.join(root, kind))) {
          if (!entry.isFile() || !/^[a-zA-Z0-9_-]+\.json$/.test(entry.name)) continue;
          const value = await read(path.join(root, kind, entry.name));
          if (!value?.id || `${value.id}.json` !== entry.name) throw Error('资料收件箱记录损坏');
          map.set(value.id, value);
        }
      }
      defaults = await read(path.join(root, 'defaults.json'), defaults);
      P.schedule(defaults.schedule);
      const activation = path.join(root, 'automation-v6.json');
      if (!await read(activation, null)) await writeJsonAtomic(activation, { at: iso(), policyVersion: P.ROUTING_POLICY_VERSION });
      defaults.automationActivatedAt = (await read(activation, null)).at;
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
      await cleanup.init();
      for await (const entry of await fs.opendir(path.join(root, 'extractions'))) {
        if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
        const file = path.join(root, 'extractions', entry.name), stat = await fs.lstat(file);
        cacheFiles.set(file, { size: stat.size, at: stat.mtimeMs }); cacheBytes += stat.size;
      }
      try { readIndex = require('./smart-inbox-index.cjs').createInboxIndex(root, items.values()); }
      catch { readIndex = null; }
    })().catch(e => { blocked = `资料收件箱初始化失败：${e.message}`; throw e; });
  }
  async function putCache(file, value) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > 2 * 1024 * 1024) return;
    const previousSize = cacheFiles.get(file)?.size || 0;
    for (const [candidate, meta] of [...cacheFiles].sort((a, b) => a[1].at - b[1].at)) {
      if (cacheBytes - previousSize + bytes <= 256 * 1024 * 1024) break;
      if (candidate === file) continue;
      await fs.unlink(candidate).catch(e => { if (e.code !== 'ENOENT') throw e; }); cacheBytes -= meta.size; cacheFiles.delete(candidate);
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
      if (selectedTarget && studentId && selectedTarget.studentId !== studentId) throw Error('投递目标与来源学生不一致');
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
        ownershipBasis: studentId && !trusted && Object.hasOwn(input, 'studentId') ? 'explicit_source' : old?.ownershipBasis || 'legacy_scope',
        enabled: Boolean(enabled), automatic, detached: false,
        autoAttributeShared: host.routingV2Enabled !== false
          && Boolean(input.autoAttributeShared ?? old?.autoAttributeShared ?? false),
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
      if (old?.studentId !== record.studentId || old?.folder !== record.folder
        || Boolean(old?.target || record.target) && !P.sameTarget(old?.target, record.target)) {
        for (const rule of rules.values()) if (rule.sourceId === record.id && rule.active) await save('rules', { ...rule, active: false });
      }
      await save('sources', record);
      if (record.enabled && record.studentId && record.ownershipBasis === 'explicit_source') {
        for (const item of items.values()) {
          if (item.sourceId !== record.id || item.studentId || item.receipt || item.manualLocked
            || item.automationDisposition !== 'unassigned' || !['review', 'retry'].includes(item.status)) continue;
          await save('items', { ...item, studentId: record.studentId, sourceRevision: record.revision, status: 'pending',
            revision: item.revision + 1, automationEligible: true, automationDisposition: '', ownershipBasis: 'explicit_source',
            studentConfirmation: { studentId: record.studentId, sourceId: record.id, sourceRevision: record.revision,
              identity: item.identity, at: iso(), requestId: `source-${record.id}-${record.revision}` } });
        }
      }
      return record;
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
      const supported = stat.size >= 0 && stat.size <= MAX_BYTES;
      const unassigned = !source.studentId && !source.target && !(source.automatic && source.autoAttributeShared);
      await save('items', { id: key, sourceId: source.id, sourceRevision: generation, sourceType: source.type,
        locator: entry.locator, name: entry.name, size: stat.size, identity: identity(stat), modifiedAt: new Date(stat.mtimeMs).toISOString(),
        studentId: source.studentId, revision: 1, createdAt: iso(), status: supported && !unassigned ? 'pending' : 'review',
        ownershipBasis: source.ownershipBasis || 'legacy_scope', automationEligible: true,
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
    await putCache(file, { schema: 3, studentId: item.studentId, sha256: item.fingerprint.sha256, result: value }); stats.extracted++;
    return { ...value, cacheFile: file };
  }
  const userRuleVersion = () => P.digest([...userRules.values()].map(rule => ({ id: rule.id, version: rule.version, enabled: rule.enabled }))
    .sort((left, right) => left.id.localeCompare(right.id)));
  async function auditRule(event, item, match) {
    if (!match?.hit?.rule) return;
    const record = { id: crypto.randomUUID(), event, at: iso(), itemId: item.id, sourceId: item.sourceId,
      studentId: item.studentId, sha256: item.fingerprint?.sha256 || '', ruleId: match.hit.rule.id,
      ruleVersion: match.hit.rule.version, action: match.action, target: match.target || null, reason: match.reason || '' };
    await writeJsonAtomic(fileFor('rule-audit', record.id), record);
  }
  async function checkCurrent(item, source, auto = false) {
    if (closed || blocked) throw Error(blocked || '已停止资料处理');
    const current = sources.get(source.id);
    if (!current || current.detached || current.revision !== source.revision) throw Error('来源设置已变化，需重新确认');
    if (auto && (!host.automaticAllowed(item.studentId || current.studentId) || !current.enabled || !current.automatic)) throw Error('自动投递已暂停');
    if (auto && item.ruleId) {
      const rule = userRules.get(item.ruleId) || rules.get(item.ruleId);
      if (!rule || rule.version !== item.ruleVersion || !(rule.enabled ?? rule.active) || rule.suspended) throw Error('投递规则已变化，需重新判断');
    }
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
    const deliveryWorkKey = P.digest([item.fingerprint.sha256, selected.type, selected.id,
      selected.categoryId, 'intake-association-v2']);
    const operationId = P.digest([item.id, deliveryWorkKey, item.revision]);
    // Reuse only an independently verified receipt in the same student and
    // project. Conversation/share deliveries have separate source ledgers and
    // deliberately continue through their normal importer.
    if (!previous && item.studentId && selected.type === 'project' && ['folder', 'download'].includes(source.type)
      && typeof host.registerAssociation === 'function' && await host.canReuseReceipt?.(selected)) {
      let matching = null;
      try { matching = readIndex?.matchingFingerprint(item.studentId, item.fingerprint.sha256) || null; }
      catch { try { readIndex?.close(); } catch {} readIndex = null; }
      const priorItems = matching ? matching.map(id => items.get(id)).filter(Boolean) : [...items.values()];
      const prior = priorItems.find(candidate => candidate.id !== item.id && candidate.status === 'delivered'
        && candidate.studentId === item.studentId && candidate.fingerprint?.sha256 === item.fingerprint.sha256
        && candidate.receipt && P.sameTarget(candidate.target, selected));
      if (prior) {
        await verifyReceipt(prior, prior.receipt);
        await checkCurrent(item, source, automatic);
        await host.validateTarget(selected);
        item = await save('items', { ...item, target: selected, operationId, deliveryWorkKey, automatic, receipt: prior.receipt,
          status: 'archive_pending', deliveredAt: iso(), reusedReceiptFrom: prior.id, message: '已复用相同资料的已验回执，正在登记来源关联。' });
        try {
          if (selected.categoryId) await host.applyCategory?.(item, automatic);
          item = { ...item, extractionReuse: await host.registerAssociation(item) };
          await host.acknowledge?.(source, item);
          item = await archive(item, source); stats.delivered++;
          return save('items', { ...item, revision: item.revision + 1, status: 'delivered', manualLocked: !automatic,
            message: '已复用同学生、同项目的已验资料并登记来源关联。' });
        } catch (error) { await save('items', { ...item, status: 'archive_pending', message: error.message }); throw error; }
      }
    }
    item = await save('items', { ...item, previous, target: selected, operationId, captureStudentId: source.studentId,
      status: 'delivering', receipt: null, associationChange: null,
      destinationPath: '', executionId: operationId, deliveryWorkKey, automatic, message: '', blockReason: null });
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
  function automaticSubject(item, source, text) {
    if (host.automaticTriage === false || !source.automatic || source.target || item.receipt || item.manualLocked
      || item.studentConfirmation && !item.studentConfirmation.automatic) return null;
    if (source.studentId ? source.type !== 'session' : !source.autoAttributeShared) return null;
    const subject = require('./smart-inbox-conversation.cjs').explicitStudentSubject(text, host.studentHints?.() || []);
    return subject && host.automaticAllowed(subject.studentId) ? subject : null;
  }
  async function analysisKey(item, source, lightContext, runtime) {
    return P.digest({ sourceId: source.id, sourcePolicy: [source.studentId, source.target, source.confidenceThreshold, source.autoAttributeShared],
      sha256: item.fingerprint.sha256, runtime, extractor: host.extractorVersion || 'v1', lightContext,
      rules: userRuleVersion(), policy: P.ANALYSIS_CONTRACT_VERSION, ownership: item.ownershipBasis,
      learned: [...rules.values()].filter(rule => rule.sourceId === source.id)
        .map(rule => [rule.id, rule.active, rule.suspended, rule.target]).sort((a, b) => a[0].localeCompare(b[0])) });
  }
  // Reconstruct and compare each stage's original authorized context. A saved
  // suggestion by itself is not enough: content, runtime, rules and scope must
  // still match. This path is shared by dry-run and real processing.
  async function storedRouting(item, source, lightContext, text, fingerprint) {
    if (!item.analysisWork?.stages || !fingerprint || fingerprint.sha256 !== item.fingerprint?.sha256
      || item.studentId !== lightContext.studentId || item.manualLocked || item.receipt
      || item.execution?.stage !== 'host_committed') return null;
    const runtime = await host.recoveryIdentity?.(item.studentId) || '';
    const sameWork = item.analysisWork.key === await analysisKey(item, source, lightContext, runtime);
    const currentIdentity = P.projectIdentityEvidence(text, lightContext.projects, { allowProductAbbreviation: true });
    if (!sameWork && !currentIdentity) return null;
    const conversation = inspectConversation(text, host.studentHints?.() || [], item.studentId);
    if (conversation.studentConflict) return null;
    const work = item.analysisWork.stages, candidateIds = item.routingScope?.candidateIds || [];
    if (candidateIds.length > 5) return null;
    const details = candidateIds.length ? await host.context(item.studentId, { mode: 'details', projectIds: candidateIds }) : lightContext;
    const bounded = P.boundedRoutingContext(details, text), stages = [], repairedExecutions = [];
    const storedStages = Object.entries(work).map(([purpose, value]) => ({ ...value, purpose }));
    for (const executionId of [item.executionId, ...(item.executionHistory || []).map(h => h.executionId)].filter(Boolean)) {
      const saved = await read(fileFor('raw-results', executionId), null);
      if (saved?.itemId === item.id && saved.studentId === item.studentId && saved.sha256 === fingerprint.sha256
        && ['candidate_recall', 'classification', 'competition_review'].includes(saved.purpose)) storedStages.push({ ...saved, executionId });
    }
    const order = ['candidate_recall', 'classification', 'competition_review'];
    storedStages.sort((a, b) => order.indexOf(a.purpose) - order.indexOf(b.purpose));
    let previousSuggestion;
    for (const cached of storedStages) {
      const purpose = cached.purpose;
      let context;
      if (purpose === 'candidate_recall') {
        const hints = await host.workspaceCandidates?.(item.studentId, [conversation.workspacePath, conversation.repositoryPath]) || [];
        context = { ...lightContext, projects: lightContext.projects.map(project => ({ ...project,
          summary: String(project.summary || '').slice(0, 300), categories: [], materialTerms: [], knowledgeTerms: [], workspaceHint: hints.includes(project.id) })) };
      } else if (purpose === 'classification') context = bounded.context;
      else context = { ...lightContext, projects: lightContext.projects.map(project => ({ ...project,
        categories: bounded.context?.projects.find(p => p.id === project.id)?.categories || [], summary: String(project.summary || '').slice(0, 300) })),
        candidateDetails: bounded.context?.projects.slice(0, 5) || [], previousSuggestion };
      if (!context) continue;
      const agentContext = { ...context, purpose, ownership: { studentId: item.studentId, basis: item.ownershipBasis,
        studentConflict: conversation.studentConflict, mentionedStudentIds: conversation.studentIds || [] },
        confirmedExamples: [...rules.values()].filter(rule => rule.sourceId === source.id && rule.studentId === item.studentId).slice(-8),
        extractionLimitations: item.extractionWarnings || [] };
      const hashes = [P.digest(agentContext)], lastFailure = item.executionHistory?.at(-1);
      if (lastFailure?.execution?.purpose === purpose && /^ROUTING_[A-Z_]+$/.test(lastFailure.blockReason?.validationCode || ''))
        hashes.push(P.digest({ ...agentContext, validationFeedback: { code: lastFailure.blockReason.validationCode,
          instruction: '纠正上次合同错误。证据必须逐字摘自所给可读正文；不确定主体时studentId和subjectEvidence填空，不创造ID或引用。' } }));
      // Changed ranking/profile metadata invalidates old coverage. It need not
      // discard a grounded project suggestion when a unique literal identity
      // independently resolves that project in the CURRENT authorized scope.
      if (!hashes.includes(cached.contextHash) && !currentIdentity) continue;
      try {
        previousSuggestion = P.validateSourceBoundSuggestion(cached.raw ?? cached.result, agentContext, text,
          source.studentId === item.studentId && P.studentScopeMatches(item, source));
        stages.push({ purpose, result: previousSuggestion });
        if (cached.raw) repairedExecutions.push(cached.executionId);
      } catch { /* A stale or ungrounded saved result never authorizes delivery. */ }
    }
    if (!stages.length) return null;
    const merged = P.mergeVerifiedRouting(stages, lightContext.projects), first = merged.suggestion.candidates[0];
    const identity = currentIdentity;
    const agreeingStages = stages.filter(stage => stage.result.candidates[0]?.id === first?.id
      && stage.result.candidates[0]?.score >= (source.confidenceThreshold || .85)
      && stage.result.candidates[0]?.evidence.trim().length >= 12);
    const identityEvidence = identity && first?.type === 'project' && first.id === identity.projectId
      && (!identity.abbreviated || new Set(agreeingStages.map(stage => stage.purpose)).size >= 2)
      && identity.competingIdentityIds.every(id => merged.suggestion.assessment?.checkedProjectIds.includes(id))
      && !merged.suggestion.conflict && first.score >= (source.confidenceThreshold || .85)
      && first.evidence.trim().length >= 12 && Content.quoteExists(text, first.evidence)
      && (!merged.suggestion.assessment || merged.suggestion.assessment.kind === 'project'
        && merged.suggestion.assessment.score >= (source.confidenceThreshold || .85)
        && !merged.suggestion.assessment.competingProjectIds.length) ? identity : null;
    const coverage = Boolean(identityEvidence) || sameWork && (merged.coverage || lightContext.projects.length <= 5);
    const context = { ...lightContext, projects: lightContext.projects.map(project => ({ ...project,
      categories: bounded.context?.projects.find(p => p.id === project.id)?.categories || [] })) };
    const decision = coverage ? P.automaticTarget({ source: { ...source, studentId: item.studentId }, item, context, text,
      suggestion: merged.suggestion, rules: host.learnedRulesEnabled === false ? [] : [...rules.values()] }) : null;
    return { ...merged, coverage, identityEvidence, decision, repairedExecutions };
  }
  async function analyze(item, source, remainingBytes = 200 * 1024) {
    if (!P.studentScopeMatches(item, source)) return save('items', { ...item, status: 'review', reasonCode: 'student_conflict', message: '来源学生已修改，历史资料须人工核对' });
    if (!item.studentId && (!source.automatic || !source.autoAttributeShared)) return save('items', { ...item, status: 'review', message: '共享来源未开启自动投递；可确认学生后由 AI 分类。' });
    const triageEnabled = host.automaticTriage !== false && item.automationEligible === true;
    await checkCurrent(item, source);
    item = await snapshot(item, source);
    if (cleanup.enabled() && source.automatic && triageEnabled && item.fingerprint.size === 0)
      return { ...await cleanup.recycle(item, 'empty_content'), textBytes: 0 };
    const data = await extraction(item), textBytes = Buffer.byteLength(data.text);
    if (textBytes > remainingBytes) return { deferred: true, textBytes: 0 };
    const identified = automaticSubject(item, source, data.text);
    if (identified && item.studentId && identified.studentId !== item.studentId && triageEnabled && !data.blocked && !data.truncated) {
      item = await reassign(item, source, identified.studentId, `subject-${item.id}`, item.revision, false);
      item = await save('items', { ...item, ownershipBasis: 'verified_subject', studentConfirmation: {
        ...item.studentConfirmation, automatic: true, evidence: identified.evidence } });
    }
    if (!item.studentId && source.automatic && source.autoAttributeShared && triageEnabled
      && !data.blocked && !data.truncated) {
      const subject = require('./smart-inbox-conversation.cjs').explicitStudentSubject(data.text, host.studentHints?.() || []);
      if (subject) {
        if (source.target && source.target.studentId !== subject.studentId) return save('items', { ...item,
          status: 'review', reasonCode: 'student_conflict', message: '正文明确主体与固定投递目标不一致，请确认归属。' });
        await host.context(subject.studentId, { mode: 'light' });
        item = await save('items', { ...item, studentId: subject.studentId, automationDisposition: '', ownershipBasis: 'verified_subject',
          studentConfirmation: { studentId: subject.studentId, sourceId: source.id, sourceRevision: source.revision, identity: item.identity,
            automatic: true, evidence: subject.evidence, requestId: `subject-${item.id}`, at: iso() } });
      }
    }
    const lightContext = await host.context(item.studentId, { mode: 'light' });
    if (lightContext.studentId !== item.studentId) throw Error('分类上下文超出已确认学生范围');
    const routingSource = { ...source, studentId: item.studentId,
      target: source.target && (!item.studentId || source.target.studentId === item.studentId) ? source.target : null };
    item = await save('items', { ...item, originalMissing: false, truncated: data.truncated,
      extractionWarnings: data.warnings, extractionPartial: data.partial, extractionBlocked: data.blocked });
    const review = async (message, reasonCode = 'review_required') => ({ ...await save('items', {
      ...item, status: 'review', reasonCode, message, execution: item.execution ? { ...item.execution, stage: 'host_committed' } : null,
    }), textBytes });
    const disposition = Content.assessContent({ ...data, name: item.name, size: item.fingerprint.size, sourceType: source.type });
    if (cleanup.enabled() && source.automatic && triageEnabled && disposition.action === 'recycle')
      return { ...await cleanup.recycle(item, disposition.reason), textBytes };
    if (!data.text.trim() || data.truncated || data.blocked) return review('正文提取未完成，未发送给Agent，已保留原件，等待提取服务恢复。', 'extraction_incomplete');
    const conversation = inspectConversation(data.text, host.studentHints?.() || [], item.studentId);
    item = await save('items', { ...item, conversationKind: conversation.kind, conversationSourceAgent: conversation.sourceAgent || '',
      conversationSessionId: conversation.sessionId || '', referencedStudentIds: conversation.referencedStudentIds || [],
      ownershipBasis: item.studentConfirmation ? item.studentConfirmation.automatic ? 'verified_subject' : 'user_confirmation'
        : source.ownershipBasis || item.ownershipBasis || 'legacy_scope' });
    if (cleanup.enabled() && conversation.kind === 'internal_task' && source.automatic && triageEnabled
      && (source.type === 'session' || !conversation.studentConflict && !P.identifiers(data.text, lightContext.projects).length)) {
      return { ...await save('items', { ...item, status: 'ignored', revision: item.revision + 1,
        manualLocked: false, reasonCode: 'internal_task', lastDecision: { action: 'automatic_internal_ignore', at: iso() },
        message: '已识别为纯系统内部会话，可恢复；原会话和原件保留。' }), textBytes };
    }
    let suggestion = { candidates: [], sensitive: false, conflict: false, reason: '' }, routingScope = null;
    const ruleMatch = P.matchUserRules({ rules: [...userRules.values()], source: routingSource, item, text: data.text, context: lightContext });
    if (ruleMatch.bypassed?.length) item = await save('items', { ...item, ruleBypasses: ruleMatch.bypassed });
    if (ruleMatch.status === 'conflict') return review(ruleMatch.reason, 'rule_conflict');
    if (ruleMatch.status === 'matched' && ruleMatch.action === 'ignore' && !conversation.studentConflict) {
      if (!source.automatic) return review(`${ruleMatch.reason}；来源设置为仅生成建议，未自动忽略。`);
      await auditRule('matched_ignore', item, ruleMatch);
      return { ...await save('items', { ...item, previousStatus: item.status, status: 'ignored', manualLocked: false,
        revision: item.revision + 1, userRuleDecision: { ruleId: ruleMatch.hit.rule.id, ruleVersion: ruleMatch.hit.rule.version,
          action: 'ignore', reason: ruleMatch.reason, at: iso() }, lastDecision: { action: 'rule_ignore', at: iso() }, message: `${ruleMatch.reason}；已移至可恢复的已忽略，未删除原件。` }), textBytes };
    }
    let decision = conversation.studentConflict ? null : ruleMatch.status === 'matched' && ruleMatch.action === 'deliver'
      ? { target: ruleMatch.target, basis: 'user_rule', resolutionBasis: 'user_rule', ruleId: ruleMatch.hit.rule.id,
        ruleVersion: ruleMatch.hit.rule.version,
        confidence: 1, evidence: ruleMatch.reason, policyVersion: P.ROUTING_POLICY_VERSION }
      : P.automaticTarget({ source: routingSource, item, context: lightContext, text: data.text, suggestion,
        rules: host.learnedRulesEnabled === false ? [] : [...rules.values()], routingV2Enabled: host.routingV2Enabled !== false, classificationAttempted: false });
    if (!decision && !conversation.studentConflict && item.studentId && item.fingerprint?.sha256 && typeof host.fingerprintProjects === 'function') {
      const matches = await host.fingerprintProjects(item.studentId, item.fingerprint.sha256);
      if (matches.length === 1) decision = { target: { studentId: item.studentId, type: 'project', id: matches[0], categoryId: '' },
        basis: 'verified_content_history', confidence: 1, evidence: item.fingerprint.sha256, policyVersion: P.ROUTING_POLICY_VERSION };
      else if (matches.length > 1) return review('相同文件指纹已关联多个项目，请确认。', 'multiple_fingerprint_targets');
    }
    const decisionRuleVersion = userRuleVersion();
    const workKey = await analysisKey(item, source, lightContext, !decision ? await host.recoveryIdentity?.(item.studentId) || '' : '');
    const stored = !decision && triageEnabled ? await storedRouting(item, source, lightContext, data.text, item.fingerprint) : null;
    if (stored?.decision) {
      decision = stored.decision; suggestion = stored.suggestion; stats.cacheHits++;
      if (stored.repairedExecutions.length) item = await save('items', { ...item,
        localResultRepair: { executionIds: stored.repairedExecutions, at: iso(), basis: 'source_bound_subject_discarded' } });
    }
    if (item.analysisWork?.key !== workKey && !stored?.decision) item = await save('items', { ...item, analysisWork: { key: workKey, calls: 0, stages: {} } });
    const verifiedStages = [];
    let budgetExhausted = false;
    const rememberStage = (purpose, result) => { verifiedStages.push({ purpose, result }); return result; };
    const validateResult = (result, context) => P.validateSourceBoundSuggestion(result, context, data.text,
      source.studentId === item.studentId && !conversation.studentConflict && P.studentScopeMatches(item, source));
    async function classifyStage(purpose, context) {
      const agentContext = { ...context, purpose, ownership: { studentId: item.studentId, basis: item.ownershipBasis,
        studentConflict: conversation.studentConflict, mentionedStudentIds: conversation.studentIds || [] },
        confirmedExamples: [...rules.values()].filter(rule => rule.sourceId === source.id && rule.studentId === item.studentId).slice(-8),
        extractionLimitations: data.warnings || [] };
      const lastFailure = item.executionHistory?.at(-1);
      if (lastFailure?.execution?.purpose === purpose && /^ROUTING_[A-Z_]+$/.test(lastFailure.blockReason?.validationCode || ''))
        agentContext.validationFeedback = { code: lastFailure.blockReason.validationCode,
          instruction: '纠正上次合同错误。证据必须逐字摘自所给可读正文；不确定主体时studentId和subjectEvidence填空，不创造ID或引用。' };
      const contextHash = P.digest(agentContext), cached = item.analysisWork.stages[purpose];
      const validationContext = { ...agentContext }; delete validationContext.validationFeedback;
      const scopeContextHash = P.digest(validationContext);
      if (cached?.contextHash === contextHash || cached?.contextHash === scopeContextHash) { stats.cacheHits++; return rememberStage(purpose, validateResult(cached.result, agentContext)); }
      const recovered = item.recoveredDecision;
      if (recovered?.workKey === workKey && recovered.contextHash === contextHash && recovered.purpose === purpose) {
        const result = validateResult(recovered.result, agentContext);
        item = await save('items', { ...item, recoveredDecision: null, analysisWork: { ...item.analysisWork,
          stages: { ...item.analysisWork.stages, [purpose]: { contextHash, result } } } });
        stats.cacheHits++; return rememberStage(purpose, result);
      }
      const extractionCache = await read(data.cacheFile, null);
      const shared = extractionCache?.routingStages?.[purpose];
      if (shared?.contextHash === contextHash) {
        stats.cacheHits++; return rememberStage(purpose, validateResult(shared.result, agentContext));
      }
      for (const executionId of [item.executionId, ...(item.executionHistory || []).slice(-3).map(h => h.executionId)].filter(Boolean)) {
        const saved = await read(fileFor('raw-results', executionId), null);
        if (!saved || saved.itemId !== item.id || saved.studentId !== item.studentId || saved.sha256 !== item.fingerprint.sha256
          || saved.contextHash !== contextHash && saved.contextHash !== scopeContextHash && saved.scopeContextHash !== scopeContextHash || saved.purpose !== purpose) continue;
        try {
          const repaired = validateResult(saved.raw, agentContext);
          stats.cacheHits++;
          item = await save('items', { ...item, analysisWork: { ...item.analysisWork, stages: {
            ...item.analysisWork.stages, [purpose]: { contextHash, result: repaired } } }, localResultRepair: { executionId, at: iso() } });
          return rememberStage(purpose, repaired);
        } catch { /* Unsupported or ungrounded output still consumes the original budget. */ }
      }
      const budgetFile = fileFor('analysis-budgets', workKey), budget = await read(budgetFile, { calls: item.analysisWork.calls || 0 });
      item.analysisWork.calls = Math.max(item.analysisWork.calls, budget.calls);
      if (item.analysisWork.calls >= 3) { budgetExhausted = true; return null; }
      await writeJsonAtomic(budgetFile, { calls: item.analysisWork.calls + 1, at: iso(), studentId: item.studentId, sha256: item.fingerprint.sha256 });
      const executionId = crypto.randomUUID();
      item = await save('items', { ...item, status: 'analyzing', executionId, attempts: item.attempts + 1, blockReason: null,
        analysisWork: { ...item.analysisWork, calls: item.analysisWork.calls + 1 },
        execution: { stage: 'qualifying', purpose, contextHash, workKey, sha256: item.fingerprint.sha256, studentId: item.studentId } });
      const outbound = Content.prepareRoutingInput(data.text, agentContext);
      if (outbound.redactions) item = await save('items', { ...item,
        routingPrivacy: { policyVersion: outbound.policyVersion, redactions: outbound.redactions, sourcePreserved: true } });
      const result = await host.classify({ context: outbound.context, text: outbound.text,
        validationText: data.text, executionId, itemId: item.id,
        allowSourceSubjectFallback: source.studentId === item.studentId && !conversation.studentConflict && P.studentScopeMatches(item, source),
        onRawResult: async raw => {
          const payload = JSON.stringify(raw);
          if (payload && Buffer.byteLength(payload) <= 200 * 1024) await writeJsonAtomic(fileFor('raw-results', executionId), {
            itemId: item.id, studentId: item.studentId, sha256: item.fingerprint.sha256, purpose, contextHash, scopeContextHash, workKey, raw, at: iso() });
        },
        onStage: async stage => {
          if (stage.stage === 'not_sent' || stage.stage === 'possibly_sent') {
            await checkCurrent(item, source);
            if (!host.automaticAllowed(item.studentId)) throw Object.assign(Error('自动处理已暂停'), { code: 'ROUTE_CHANGED' });
            const current = await host.context(item.studentId, { mode: 'light' });
            if (P.digest(current) !== P.digest(lightContext)) throw Object.assign(Error('学生项目上下文或规则已变化'), { code: 'ROUTE_CHANGED' });
            if (purpose === 'classification' && context.projects.length) {
              const details = await host.context(item.studentId, { mode: 'details', projectIds: context.projects.map(project => project.id) });
              if (P.digest(P.boundedRoutingContext(details, data.text).context) !== P.digest(context)) throw Object.assign(Error('项目详细上下文已变化'), { code: 'ROUTE_CHANGED' });
            }
          }
          item = await save('items', { ...item, execution: { ...item.execution, ...stage } });
        },
        onResult: async result => writeJsonAtomic(fileFor('decisions', executionId), { itemId: item.id, studentId: item.studentId,
          sha256: item.fingerprint.sha256, purpose, contextHash, workKey, result: validateResult(result, agentContext), at: iso() }),
      }).catch(async error => {
        if (error.blockReason?.stage === 'not_sent' || item.execution?.stage === 'qualifying') {
          item = await save('items', { ...item, analysisWork: { ...item.analysisWork, calls: Math.max(0, item.analysisWork.calls - 1) } });
          await writeJsonAtomic(budgetFile, { calls: item.analysisWork.calls, at: iso() });
        }
        throw error;
      });
      const validated = validateResult(result, agentContext);
      await writeJsonAtomic(fileFor('decisions', executionId), { itemId: item.id, studentId: item.studentId,
        sha256: item.fingerprint.sha256, purpose, contextHash, workKey, result: validated, at: iso() });
      item = await save('items', { ...item, analysisWork: { ...item.analysisWork,
        stages: { ...item.analysisWork.stages, [purpose]: { contextHash, result: validated } } } });
      const currentCache = await read(data.cacheFile, null);
      if (currentCache) await putCache(data.cacheFile, { ...currentCache, routingStages: { ...(currentCache.routingStages || {}), [purpose]: { contextHash, result: validated } } });
      stats.classified++;
      return rememberStage(purpose, validated);
    }
    let decisionContext = lightContext, coverage = stored?.coverage || lightContext.projects.length <= 5,
      reusedStages = stored?.reusedStages || [], identityEvidence = stored?.identityEvidence || null;
    if (!decision) {
      let selected = P.selectRoutingCandidates({ context: lightContext, text: data.text, item, ruleMatch });
      if (lightContext.projects.length > 5 && !selected.strong) {
        const workspaceHints = await host.workspaceCandidates?.(item.studentId, [conversation.workspacePath, conversation.repositoryPath]) || [];
        const recallContext = { ...lightContext, projects: lightContext.projects.map(project => ({ ...project,
          summary: String(project.summary || '').slice(0, 300), categories: [], materialTerms: [], knowledgeTerms: [],
          workspaceHint: workspaceHints.includes(project.id) })) };
        if (Buffer.byteLength(JSON.stringify(recallContext)) > 100 * 1024) return review('项目轻量信息超过召回上限，请确认。', 'candidate_scope_too_large');
        suggestion = await classifyStage('candidate_recall', recallContext) || suggestion;
        coverage = P.verifiedCoverage(suggestion.assessment, lightContext.projects);
        const recalledIds = suggestion.candidates.filter(candidate => candidate.type === 'project').map(candidate => candidate.id);
        selected = { ...selected, candidateIds: recalledIds, complete: coverage, strong: false };
        routingScope = { totalProjects: lightContext.projects.length, candidateIds: recalledIds, complete: coverage, recallCoveredAll: true };
        if (!recalledIds.length && !suggestion.candidates.length && !suggestion.assessment) {
          item = { ...item, suggestion, routingScope };
          return review(suggestion.reason || '已检查全部项目，尚无可信项目候选。', 'no_candidate');
        }
      }
      const candidateIds = selected.candidateIds.slice(0, 5);
      if (candidateIds.length || lightContext.projects.length <= 5) {
        const details = candidateIds.length ? await host.context(item.studentId, { mode: 'details', projectIds: candidateIds }) : lightContext;
        const bounded = P.boundedRoutingContext(details, data.text);
        if (!bounded.context) return review(bounded.reason, 'candidate_scope_too_large');
        decisionContext = bounded.context;
        suggestion = await classifyStage('classification', decisionContext) || suggestion;
        coverage = selected.complete || selected.strong;
        routingScope = { ...routingScope, candidateIds, totalProjects: lightContext.projects.length, complete: coverage, strong: selected.strong };
      }
      const reuse = P.mergeVerifiedRouting(verifiedStages, lightContext.projects);
      if (reuse.suggestion) suggestion = reuse.suggestion;
      coverage ||= reuse.coverage;
      reusedStages = reuse.reusedStages;
      const identity = P.projectIdentityEvidence(data.text, lightContext.projects, { allowProductAbbreviation: true }), first = suggestion.candidates[0];
      const agreeingStages = verifiedStages.filter(stage => stage.result.candidates[0]?.id === first?.id
        && stage.result.candidates[0]?.score >= (source.confidenceThreshold || .85)
        && stage.result.candidates[0]?.evidence.trim().length >= 12);
      if (identity && first?.type === 'project' && first.id === identity.projectId && !suggestion.conflict
        && (!identity.abbreviated || new Set(agreeingStages.map(stage => stage.purpose)).size >= 2)
        && identity.competingIdentityIds.every(id => suggestion.assessment?.checkedProjectIds.includes(id))
        && first.score >= (source.confidenceThreshold || .85) && first.evidence.trim().length >= 12 && Content.quoteExists(data.text, first.evidence)
        && (!suggestion.assessment || suggestion.assessment.kind === 'project' && suggestion.assessment.score >= (source.confidenceThreshold || .85)
          && !suggestion.assessment.competingProjectIds.length)) {
        coverage = true; identityEvidence = identity;
      }
      if (triageEnabled && (!coverage || suggestion.conflict || conversation.studentConflict
        || suggestion.assessment && (suggestion.assessment.score < .85 || suggestion.assessment.kind === 'unknown'))) {
        const reviewContext = { ...lightContext, projects: lightContext.projects.map(project => ({ ...project, categories: decisionContext.projects.find(value => value.id === project.id)?.categories || [],
          summary: String(project.summary || '').slice(0, 300) })), candidateDetails: decisionContext.projects.slice(0, 5), previousSuggestion: suggestion };
        if (Buffer.byteLength(JSON.stringify(reviewContext)) <= 100 * 1024) {
          const checked = await classifyStage('competition_review', reviewContext);
          if (checked) {
            const reviewed = P.mergeVerifiedRouting(verifiedStages, lightContext.projects);
            suggestion = reviewed.suggestion;
            coverage = reviewed.coverage;
            reusedStages = reviewed.reusedStages;
            // Only category IDs from the detailed authorized context can be used.
            decisionContext = { ...reviewContext, projects: reviewContext.projects.map(project => ({ ...project,
              categories: decisionContext.projects.find(value => value.id === project.id)?.categories || [] })) };
          }
        }
      }
      if (conversation.studentConflict) {
        const assessment = suggestion.assessment;
        const own = (host.studentHints?.() || []).find(student => String(student.id) === item.studentId);
        const ownMention = assessment?.subjectEvidence && (assessment.subjectEvidence.includes(item.studentId)
          || own?.name && assessment.subjectEvidence.includes(own.name));
        if (!triageEnabled || !assessment || assessment.studentId !== item.studentId || assessment.score < .85 || !ownMention) {
          item = { ...item, suggestion, routingScope };
          return review('正文涉及其他学生或多个学生，主体核验仍存在冲突，请确认。', 'student_conflict');
        }
      }
      const assessment = suggestion.assessment;
      if (triageEnabled && !suggestion.candidates.length && assessment?.kind === 'learning'
        && assessment.studentId === item.studentId && item.studentId && assessment.score >= (source.confidenceThreshold || .85)
        && assessment.evidence.trim().length >= 12 && assessment.subjectEvidence.trim().length >= 4
        && !assessment.competingProjectIds.length && !suggestion.conflict) {
        suggestion = { ...suggestion, candidates: [{ studentId: item.studentId, type: 'student', id: '', categoryId: '',
          score: assessment.score, evidence: assessment.evidence, reason: '学习内容归入学生原始库，保留主题等待关联' }] };
      }
      decision = P.automaticTarget({ source: routingSource, item, context: decisionContext, text: data.text, suggestion,
        rules: host.learnedRulesEnabled === false ? [] : [...rules.values()], routingV2Enabled: host.routingV2Enabled !== false, classificationAttempted: true });
      if (!coverage && !(selected.strong && decision?.basis === 'verified_project_identifier')) decision = null;
      if (!triageEnabled && lightContext.projects.length > 5 && !selected.strong) decision = null;
    }
    if (decisionRuleVersion !== userRuleVersion()
      || P.digest(await host.context(item.studentId, { mode: 'light' })) !== P.digest(lightContext)) {
      return review('项目上下文或分类规则已变化，将按最新版本重新判断。', 'routing_context_changed');
    }
    await observeLearnedRules(item, source, suggestion, data.text);
    if (item.reassociation && (!decision || decision.target.type === 'student')) {
      return { ...await save('items', { ...item, status: 'delivered', reassociation: false, awaitingProject: true,
        suggestion, suggestedTags: suggestion.assessment?.tags || item.suggestedTags || [],
        message: '已保留学生原始库资料，当前项目仍无充分关联证据。' }), textBytes };
    }
    if (ruleMatch.status === 'matched') await auditRule('matched_deliver', item, ruleMatch);
    const sharedUnresolved = !decision && !item.studentId && source.automatic && source.autoAttributeShared
      && !item.analysisWork.stages.competition_review;
    const [best, next] = suggestion.candidates;
    const businessAmbiguity = suggestion.conflict || suggestion.assessment?.competingProjectIds.length
      || P.identifiers(data.text, lightContext.projects).length > 1
      || best?.type === 'project' && next?.type === 'project' && best.id !== next.id && best.score - next.score < .10;
    const technicalWait = !decision && !businessAmbiguity && (!coverage || budgetExhausted);
    const waitReason = budgetExhausted ? 'analysis_budget_exhausted' : 'routing_verification_incomplete';
    item = await save('items', { ...item, status: sharedUnresolved ? 'retry' : 'review', reasonCode: decision ? '' : technicalWait ? waitReason : 'classification_review', suggestion, blockReason: null,
      routingEvidence: { reusedStages, coveredAll: coverage, identityEvidence, policyVersion: P.ROUTING_POLICY_VERSION },
      routingWorkKey: workKey, routingScope, nextRetryAt: sharedUnresolved ? new Date(now() + 6 * 60 * 60 * 1000).toISOString() : '',
      execution: item.execution ? { ...item.execution, stage: 'host_committed' } : null,
      identifier: P.identifiers(data.text, lightContext.projects).length === 1 ? P.identifiers(data.text, lightContext.projects)[0].id : '',
      proposedTarget: decision?.target || suggestion.candidates[0] || routingSource.target || null,
      ruleId: decision?.ruleId || '', ruleVersion: decision?.ruleVersion || userRules.get(decision?.ruleId)?.version || rules.get(decision?.ruleId)?.version || 0,
      basis: decision?.basis || 'agent_suggestion', ruleSetVersion: userRuleVersion(),
      suggestedTags: suggestion.assessment?.tags || [], assessment: suggestion.assessment || null,
      awaitingProject: decision?.target.type === 'student' && decision?.provisional === true, reassociation: false,
      routingDecision: decision ? { primaryTarget: decision.target, matchedProjectId: decision.matchedProjectId || '',
        primaryStudentId: decision.primaryStudentId || decision.target.studentId,
        linkedStudentIds: decision.linkedStudentIds || [decision.target.studentId], categoryDecision: decision.target.categoryId || '',
        confidence: decision.confidence ?? null, evidence: decision.evidence || '', resolutionBasis: decision.resolutionBasis || decision.basis || '',
        provisional: decision.provisional === true, policyVersion: P.ROUTING_POLICY_VERSION } : null,
      message: technicalWait ? budgetExhausted ? '分析预算已用满，保留已核验结果，等待服务、上下文或晚到结果变化后自动恢复；无需人工分类。'
        : '项目核验证据尚未完整，保留已有建议并自动恢复；无需人工分类。'
        : sharedUnresolved ? '共享资料已进入自动暂存池，等待相关项目上下文变化。' : suggestion.reason || '请确认投递位置' });
    if (decision && source.enabled && source.automatic && host.automaticAllowed(item.studentId)) item = await deliverItem(item, source, decision.target, true);
    return { ...item, textBytes };
  }
  let decisionEvidenceIndex = null, decisionEvidenceStamp = '';
  async function classificationEvidence(item) {
    const matches = saved => saved?.itemId === item.id && saved.studentId === item.studentId
      && saved.sha256 && saved.sha256 === item.fingerprint?.sha256
      && (!item.execution?.contextHash || saved.contextHash === item.execution.contextHash)
      && (!item.execution?.purpose || saved.purpose === item.execution.purpose) && saved.result;
    const own = item.executionId ? await read(fileFor('decisions', item.executionId), null) : null;
    if (matches(own)) return own;
    // A result may have been durably saved under a previous attempt of the
    // exact same read-only classification. Never reuse by item ID alone.
    if (!item.execution?.contextHash) return null;
    const directory = path.join(root, 'decisions'), stat = await fs.stat(directory);
    const stamp = `${stat.mtimeMs}:${stat.ctimeMs}`;
    if (!decisionEvidenceIndex || stamp !== decisionEvidenceStamp) {
      const index = new Map();
      for (const name of await fs.readdir(directory)) {
        if (!name.endsWith('.json')) continue;
        const saved = await read(path.join(directory, name), null);
        if (saved?.itemId && saved.contextHash && saved.sha256 && saved.result) index.set(
          P.digest([saved.itemId, saved.studentId, saved.sha256, saved.contextHash, saved.purpose]), saved);
      }
      decisionEvidenceIndex = index; decisionEvidenceStamp = stamp;
    }
    const saved = decisionEvidenceIndex.get(P.digest([item.id, item.studentId, item.fingerprint?.sha256,
      item.execution.contextHash, item.execution.purpose]));
    return matches(saved) ? saved : null;
  }
  async function reconciliationEvidence(item) {
    if (item.status === 'execution_unknown') {
      const saved = await classificationEvidence(item);
      if (saved) return { decision: saved };
      if (cleanup.recoveryEnabled() && item.execution?.stage === 'result_rejected' && item.blockReason?.resultReceived === true
        && !item.receipt && !item.operationId) return { rejected: true };
      return null;
    }
    const receipt = item.receipt || await host.reconcile?.(item);
    if (!receipt) return null;
    if (cleanup.recoveryEnabled() && receipt.notDelivered === true && receipt.noInFlight === true
      && receipt.operationId === item.operationId && receipt.sha256 === item.fingerprint?.sha256
      && P.sameTarget(receipt.target, item.target)) return { notDelivered: true };
    await host.validateTarget(item.target);
    await verifyReceipt(item, receipt);
    return { receipt };
  }
  async function resumeVerifiedDelivery(item, source) {
    await checkCurrent(item, source, true);
    const current = await save('items', { ...item, status: 'review', reconcileAttempts: 0, nextReconcileAt: '',
      deliveryRecovery: { operationId: item.operationId, basis: 'verified_no_effect', at: iso() } });
    return deliverItem(current, source, current.target, true);
  }
  async function resumeRejectedResult(item) {
    const history = [...(item.executionHistory || []), { executionId: item.executionId, execution: item.execution,
      blockReason: item.blockReason, resolution: 'verified_result_rejected', at: iso() }];
    const exhausted = Number(item.analysisWork?.calls || 0) >= 3 || history.filter(x => x.resolution === 'verified_result_rejected'
      && x.execution?.workKey === item.analysisWork?.key).length >= 3;
    return save('items', { ...item, executionHistory: history, executionId: '', execution: null,
      status: exhausted ? 'review' : 'pending', reasonCode: exhausted ? 'classification_invalid' : '',
      blockReason: null, reconcileAttempts: 0, nextReconcileAt: '', nextRetryAt: '', revision: item.revision + 1,
      message: exhausted ? '分类结果连续无效，资料已保留，等待服务修复后重新判断。' : '已确认上次分类返回无效结果，按原分析预算自动继续。' });
  }
  const passiveChecks = new Map();
  async function refreshLateEvidence() {
    if (!cleanup.recoveryEnabled()) return;
    let checked = 0;
    for (const item of items.values()) {
      const source = sources.get(item.sourceId);
      const technical = item.status === 'review' && P.isTechnicalWait(item) && item.execution?.stage === 'host_committed'
        && item.automationEligible && !item.receipt && batchMayRun(item);
      if (technical && checked < 5 && source?.enabled && source.automatic && !source.detached && !item.manualLocked
        && host.eventRecovery !== false && host.automaticAllowed(item.studentId) && (passiveChecks.get(item.id) || 0) <= now()) {
        checked++; passiveChecks.set(item.id, now() + 15 * 60_000);
        try {
          const preview = await previewOne(item);
          if (preview.eligible && preview.suggestedAction === 'deliver') await withItemLock(item.id, async () => {
            const current = items.get(item.id);
            if (current?.revision === item.revision && current.status === item.status) await save('items', {
              ...current, status: 'pending', nextRetryAt: '', message: '已找到可复用的核验证据，自动续接；不新增分类调用。' });
          });
        } catch { /* Missing originals or invalid proofs remain retained. */ }
        continue;
      }
      if (checked >= 5 || !['execution_unknown', 'delivery_reconcile', 'archive_pending'].includes(item.status)
        || Number(item.reconcileAttempts || 0) < 3 || !source?.enabled || source.detached || item.manualLocked
        || host.eventRecovery === false || !host.automaticAllowed(item.studentId)
        || (passiveChecks.get(item.id) || 0) > now()) continue;
      checked++; passiveChecks.set(item.id, now() + 15 * 60_000);
      try {
        if (await reconciliationEvidence(item)) await withItemLock(item.id, async () => {
          const current = items.get(item.id);
          if (current?.revision === item.revision && current.status === item.status) await save('items', {
            ...current, reconcileAttempts: 0, nextReconcileAt: '', message: '发现晚到结果，已恢复自动核验。' });
        });
      } catch { /* Preserve unknown state and evidence on any failed check. */ }
    }
  }
  async function recoverClassification(item, source, saved, remainingBytes = 200 * 1024) {
    await checkCurrent(item, source);
    if (host.eventRecovery === false || !cleanup.recoveryEnabled() || !source.automatic || !host.automaticAllowed(item.studentId)
      || !saved.workKey || !item.automationEligible) {
      return save('items', { ...item, status: 'review', suggestion: saved.result,
        proposedTarget: saved.result?.candidates?.[0] || null, revision: item.revision + 1,
        nextReconcileAt: '', message: '已找回分类结果，等待确认或历史批次重新核验。' });
    }
    const recovered = await save('items', { ...item, status: 'pending', recoveredDecision: saved,
      execution: { ...item.execution, stage: 'host_committed' }, blockReason: null, nextReconcileAt: '', revision: item.revision + 1 });
    return analyze(recovered, source, remainingBytes);
  }
  async function processSource(id, manual = false) {
    const source = sources.get(id); if (!source || source.detached || (!manual && !source.enabled)) return;
    const resumeIds=Array.isArray(source.resumeItemIds)&&source.resumeItemIds.length?new Set(source.resumeItemIds):null;
    const inScope=item=>item.sourceId===id&&(!resumeIds||resumeIds.has(item.id))
      && (!item.automationBatchId || batches.get(item.automationBatchId)?.status !== 'paused');
    let release, batchId, changed = false;
    try {
      if (!resumeIds&&(source.pendingManual || (!source.manualWork && (!source.nextRunAt || Date.parse(source.nextRunAt) <= now())))) {
        changed = (await discover(source)) > 0;
        await save('sources', { ...sources.get(id), lastScanAt: iso(), nextRunAt: P.nextRun(source.schedule || defaults.schedule, now()), error: '', pendingManual: false, manualWork: manual });
      }
      const due = (value) => !value.nextRetryAt || Date.parse(value.nextRetryAt) <= now();
      const reconcileDue = value => ['execution_unknown', 'delivery_reconcile', 'archive_pending'].includes(value.status)
        && cleanup.recoveryEnabled()
        && Number(value.reconcileAttempts || 0) < 3
        && (!value.nextReconcileAt || Date.parse(value.nextReconcileAt) <= now());
      let pendingAvailable = [...items.values()].some(i => inScope(i) && ['pending', 'retry'].includes(i.status) && due(i));
      // This lane cannot call analyze or an executor. Preview and commit both
      // revalidate the original and current authorization under the item lock.
      if (pendingAvailable && source.automatic && host.acquireLocal) {
        const candidates = [...items.values()].filter(i => inScope(i) && due(i)
          && ['pending', 'retry'].includes(i.status) && i.automationEligible && !i.manualLocked && !i.receipt
          && i.execution?.stage === 'host_committed' && i.analysisWork?.stages);
        const cursor = (localProbeCursors.get(id) || 0) % (candidates.length || 1);
        const started = performance.now(); let checked = 0, delivered = 0;
        for (; checked < Math.min(20, candidates.length) && !closed; checked++) {
          if (performance.now() - started >= 2000 || delivered >= 5) break;
          const value = candidates[(cursor + checked) % candidates.length];
          const permit = await host.acquireLocal(source, manual);
          if (!permit) break;
          try {
            await withItemLock(value.id, async () => {
              const item = items.get(value.id);
              if (!item || !inScope(item) || !['pending', 'retry'].includes(item.status)
                || item.receipt || item.manualLocked || sources.get(id)?.revision !== source.revision) return;
              const preview = await previewOne({ ...item, status: 'review' });
              if (!preview.eligible || preview.suggestedAction !== 'deliver'
                || preview.target?.type !== 'project' || preview.target.studentId !== item.studentId) return;
              await deliverItem(item, source, preview.target, true);
              delivered++; changed = true;
            });
          } catch (error) {
            await withItemLock(value.id, async () => {
              const item = items.get(value.id);
              if (!item || !['pending', 'retry'].includes(item.status)) return;
              await save('items', { ...item, status: 'retry', nextRetryAt: new Date(now() + 60_000).toISOString(),
                message: `本地投递等待恢复：${error.message}` });
            });
          } finally { permit(); }
          await yieldTurn();
        }
        if (candidates.length) localProbeCursors.set(id, (cursor + checked) % candidates.length);
        if (delivered) await host.settleItems?.([...items.values()].filter(i => i.sourceId === id));
        pendingAvailable = [...items.values()].some(i => inScope(i) && ['pending', 'retry'].includes(i.status) && due(i));
      }
      const reconcileAvailable = [...items.values()].some(i => inScope(i) && reconcileDue(i));
      if (!pendingAvailable && !reconcileAvailable) {
        if(resumeIds&&![...items.values()].some(item=>inScope(item)&&['pending','retry'].includes(item.status)))await save('sources',{...sources.get(id),resumeItemIds:[],pendingManual:false,manualWork:false});
        return;
      }
      let reconciled = 0, reconciliationBytes = 0;
      for (const value of items.values()) {
        if (reconciled >= 5 || !inScope(value)
          || !['execution_unknown', 'delivery_reconcile'].includes(value.status)
          || !reconcileDue(value)) continue;
        await withItemLock(value.id, async () => {
          let current = items.get(value.id);
          if (!current) return;
          try {
            if (current.status === 'execution_unknown') {
              const evidence = await reconciliationEvidence(current), saved = evidence?.decision;
              if (saved && saved.itemId === current.id
                && (!saved.studentId || saved.studentId === current.studentId)
                && (!saved.sha256 || saved.sha256 === current.fingerprint?.sha256)) {
                const recovered = await recoverClassification(current, source, saved, 200 * 1024 - reconciliationBytes);
                reconciliationBytes += recovered?.textBytes || 0;
                reconciled++; changed = true;
                return;
              }
              // Reconciliation is control-plane work. Give the host a chance to
              // inspect executor receipts/process state even while heavy work is
              // blocked, but never treat an arbitrary delivery receipt as a
              // classification decision here.
              if (evidence?.rejected) {
                await resumeRejectedResult(current); reconciled++; changed = true; return;
              }
              await host.reconcile?.(current);
              const attempts = Math.max(0, Number(current.reconcileAttempts || 0)) + 1;
              await save('items', { ...current, reconcileAttempts: attempts,
                nextReconcileAt: attempts >= 3 ? '' : new Date(now() + Math.min(15 * 60_000, 30_000 * 2 ** (attempts - 1))).toISOString(),
                message: attempts >= 3 ? '等待可验证的执行结果；后台每15分钟检查晚到证据，不重新发送。' : '尚未找到执行结果，将自动再次核对。' });
              return;
            }
            const evidence = await reconciliationEvidence(current);
            if (evidence?.notDelivered) {
              const permit = await (host.acquireLocal || host.acquire).call(host, source, false); if (!permit) return;
              try { await resumeVerifiedDelivery(current, source); } finally { permit(); }
              reconciled++; changed = true; return;
            }
            const receipt = evidence?.receipt;
            if (!receipt) {
              const attempts = Math.max(0, Number(current.reconcileAttempts || 0)) + 1;
              await save('items', { ...current, reconcileAttempts: attempts,
                nextReconcileAt: attempts >= 3 ? '' : new Date(now() + Math.min(15 * 60_000, 30_000 * 2 ** (attempts - 1))).toISOString(),
                message: attempts >= 3 ? '等待可验证的投递回执；后台每15分钟检查登记，不重复复制。' : '尚未找到投递回执，将自动再次核对。' });
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
              message: attempts >= 3 ? `${error.message}；保留执行证据，后台低频自动核验。` : error.message });
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
                message: attempts >= 3 ? `${error.message}；保留执行证据，后台低频自动核验。` : error.message });
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
      const workQueue = [...items.values()]
        .filter(i => inScope(i) && ['pending', 'retry'].includes(i.status) && due(i));
      // Finished, durable classifier results can often be committed locally.
      // Do not put them behind a whole source's slow remote calls. This only
      // changes priority: analyze still rechecks scope, bytes and permissions.
      const probes = source.automatic ? workQueue.filter(i => i.automationEligible && !i.manualLocked && !i.receipt
        && i.execution?.stage === 'host_committed' && i.analysisWork?.stages) : [];
      const ready = new Set(), probeStart = performance.now();
      const cursor = (localProbeCursors.get(id) || 0) % (probes.length || 1);
      let checked = 0;
      for (; checked < Math.min(20, probes.length) && !closed; checked++) {
        if (checked && performance.now() - probeStart >= 500) break;
        const item = probes[(cursor + checked) % probes.length];
        try {
          const preview = await previewOne({ ...item, status: 'review' });
          if (preview.eligible && preview.suggestedAction === 'deliver') ready.add(item.id);
        } catch { /* A priority probe cannot bypass normal recovery checks. */ }
      }
      if (probes.length) localProbeCursors.set(id, (cursor + checked) % probes.length);
      workQueue.sort((a, b) => Number(ready.has(b.id)) - Number(ready.has(a.id)));
      const batchItems = workQueue
        .slice(0, 20)
        .map(i => ({ id: i.id, revision: i.revision || '', studentId: i.studentId || '',
          target: i.target || i.proposedTarget || null, sha256: i.fingerprint?.sha256 || '', attempts: Number(i.attempts || 0) }));
      batchId = await host.beginBatch?.(source, manual, { sourceRevision: source.revision, items: batchItems });
      if (sources.get(id)?.error || sources.get(id)?.waitingReason || sources.get(id)?.waitingSince) {
        await save('sources', { ...sources.get(id), error: '', waitingReason: '', waitingSince: '' });
      }
      const analysisBatch = batchId || crypto.randomUUID();
      const turnStart = performance.now(), turnBudgetMs = Math.min(5000, Math.max(10, Number(host.processingTurnBudgetMs) || 2000));
      let count = 0, budget = reconciliationBytes;
      for (const value of workQueue) {
        if (count >= 20 || budget >= 200 * 1024 || closed || (!manual && !host.automaticAllowed())) break;
        // Cooperative deadline: never interrupt an in-flight operation. Yield
        // after its verified result so batches and other sources can progress.
        if (count && performance.now() - turnStart >= turnBudgetMs) break;
        if (!inScope(value) || !['pending', 'retry'].includes(value.status) || (value.nextRetryAt && Date.parse(value.nextRetryAt) > now())) continue;
        if (sources.get(id)?.revision !== source.revision || (!manual && !sources.get(id)?.enabled)) break;
        count++; changed = true;
        try {
          const result = await withItemLock(value.id, async () => analyze(await save('items', { ...(items.get(value.id) || value), analysisBatch }), source, 200 * 1024 - budget));
          if (result?.deferred) continue;
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
            const validationFailure = !unknown && /^ROUTING_[A-Z_]+$/.test(e.code || '');
            await save('items', { ...current, status: unknown ? 'execution_unknown' : mayRetry ? 'retry' : 'review',
              ...(validationFailure ? { reasonCode: 'classification_invalid', lastValidationError: { code: e.code, message: e.message, at: iso() } } : {}),
              blockReason: e.blockReason || null, nextRetryAt: mayRetry ? retry.nextRetryAt || new Date(now() + 60000).toISOString() : '',
              message: validationFailure ? `分类核验待恢复：${e.message}；资料和已核验结果保留，无需人工分类。` : e.message });
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
  function batchMayRun(item) {
    return !item.automationBatchId || batches.get(item.automationBatchId)?.status !== 'paused';
  }
  async function wakeRelevant() {
    if (host.eventRecovery === false || !host.automaticAllowed()) return;
    const contexts = new Map();
    for (const source of sources.values()) {
      if (!source.enabled || !source.automatic || source.detached || !host.automaticAllowed(source.studentId) || !cleanup.recoveryEnabled()) continue;
      try {
        const id = source.studentId || '';
        if (!contexts.has(id)) contexts.set(id, await host.context(id, { mode: 'light' }));
        const context = contexts.get(id);
        const contextHash = P.digest(context);
        const configHash = P.digest([source.studentId, source.target, source.confidenceThreshold, source.autoAttributeShared, userRuleVersion(),
          [...rules.values()].filter(rule => rule.sourceId === source.id).map(rule => [rule.id, rule.active, rule.suspended, rule.target])]);
        const scopeChanged = Boolean(source.projectContextHash && source.projectContextHash !== contextHash
          || source.routingConfigHash && source.routingConfigHash !== configHash);
      const needsRuntime = [...items.values()].some(row => row.sourceId === source.id && row.status === 'review'
        && (P.isTechnicalWait(row) || row.blockReason?.category === 'agent'));
      const runtimeIdentity = needsRuntime ? await host.recoveryIdentity?.(id) || '' : source.runtimeIdentity || '';
      const hash = P.digest([contextHash, source.revision, userRuleVersion(), P.ROUTING_POLICY_VERSION, runtimeIdentity, host.extractorVersion || 'v1',
          [...rules.values()].filter(rule => rule.sourceId === source.id).map(rule => [rule.id, rule.active, rule.suspended, rule.target]).sort((a, b) => a[0].localeCompare(b[0]))]);
        const changed = source.wakeHash && source.wakeHash !== hash;
        if (source.wakeHash !== hash) await save('sources', { ...sources.get(source.id), wakeHash: hash, projectContextHash: contextHash, runtimeIdentity, routingConfigHash: configHash });
        for (const row of items.values()) {
          if (row.sourceId !== source.id || !row.automationEligible || row.manualLocked || row.originalMissing || !batchMayRun(row)) continue;
          const recoverable = row.blockReason?.recoverable === true && row.blockReason.category !== 'unknown';
          const localUpgrade = row.status === 'review' && row.reasonCode === 'classification_review'
            && row.execution?.stage === 'host_committed' && row.routingEvidence?.policyVersion !== P.ROUTING_POLICY_VERSION;
          const relevant = (localUpgrade || changed && (scopeChanged || P.isTechnicalWait(row)))
            && ['review', 'retry'].includes(row.status) && (!row.receipt || row.reassociation);
          const reassociate = source.projectContextHash && source.projectContextHash !== contextHash
            && row.status === 'delivered' && row.awaitingProject && row.target?.type === 'student';
          if (!recoverable && !relevant && !reassociate) continue;
          if (!['review', 'retry', 'delivered'].includes(row.status)) continue;
          if (recoverable && !changed && row.nextRecoveryAt && Date.parse(row.nextRecoveryAt) > now()) continue;
          await withItemLock(row.id, async () => {
            const current = items.get(row.id);
            if (!current || current.revision !== row.revision) return;
            await save('items', { ...current, status: 'pending', nextRetryAt: '', blockReason: null,
              reassociation: Boolean(reassociate || current.reassociation), wakeHash: hash,
              nextRecoveryAt: new Date(now() + 5 * 60_000).toISOString(),
              message: reassociate ? '项目上下文已更新，自动核对原始库资料关联。' : '相关上下文或服务已恢复，自动继续。' });
          });
        }
      } catch (error) { host.onError?.(error); }
    }
  }
  async function tick() {
    await init(); if (closed || blocked || active) return active;
    let progress = false;
    const work = (async () => {
      await cleanup.sweep();
      await cleanup.recheck();
      await wakeRelevant();
      progress = await batchRuntime.process() || progress;
      await refreshLateEvidence();
      const ordered = [...sources.values()]; if (ordered.length) turn %= ordered.length;
      const round = [...ordered.slice(turn), ...ordered.slice(0, turn)].sort((a, b) => Number(Boolean(b.pendingManual || b.manualWork)) - Number(Boolean(a.pendingManual || a.manualWork)));
      for (let n = 0; n < ordered.length; n++) {
        const s = sources.get(round[n].id);
        const pending = [...items.values()].some(i => i.sourceId === s.id && batchMayRun(i) && ['pending', 'retry'].includes(i.status) && (!i.nextRetryAt || Date.parse(i.nextRetryAt) <= now()));
        const reconciling = [...items.values()].some(i => i.sourceId === s.id
          && ['execution_unknown', 'delivery_reconcile', 'archive_pending'].includes(i.status)
          && (!i.nextReconcileAt || Date.parse(i.nextReconcileAt) <= now()) && Number(i.reconcileAttempts || 0) < 3);
        if (!s.detached && (s.pendingManual || s.manualWork && (pending || reconciling)
          || (host.automaticAllowed() && s.enabled && (pending || reconciling || s.nextRunAt && Date.parse(s.nextRunAt) <= now())))) {
          progress = Boolean(await processSource(s.id, Boolean(s.pendingManual || s.manualWork))) || progress;
        }
      }
      turn++;
      progress = await batchRuntime.process() || progress;
    })();
    active = work;
    try { await work; } finally {
      active = null;
      if (!closed && !blocked && progress && [...items.values()].some(i => { const s = sources.get(i.sourceId); return s && !s.detached && batchMayRun(i) && (s.manualWork || s.enabled && host.automaticAllowed(s.studentId)) && (
        ['pending', 'retry'].includes(i.status) && (!i.nextRetryAt || Date.parse(i.nextRetryAt) <= now())
        || ['execution_unknown', 'delivery_reconcile', 'archive_pending'].includes(i.status)
          && (!i.nextReconcileAt || Date.parse(i.nextReconcileAt) <= now()) && Number(i.reconcileAttempts || 0) < 3); })) setImmediate(() => tick().catch(e => host.onError?.(e)));
    }
  }
  function independentSample(item) {
    return item.conversationSessionId || item.analysisBatch || item.id;
  }
  async function feedback(item, before, selected, action, onlyThis = false) {
    if (host.learnedRulesEnabled === false || onlyThis) return;
    const source = sources.get(item.sourceId);
    if (!source || !item.studentId) return;
    const directory = ['folder', 'download'].includes(source.type) ? path.dirname(item.locator).replace(/\\/g, '/') : '';
    const matcher = item.identifier ? { identifier: item.identifier } : directory && directory !== '.' && !directory.startsWith('..')
      ? { directory } : null;
    for (const rule of rules.values()) {
      if (rule.sourceId !== source.id || rule.studentId !== item.studentId) continue;
      const applies = rule.identifier ? rule.identifier === item.identifier : rule.directory && directory.startsWith(rule.directory);
      if (applies && !P.sameTarget(rule.target, selected)) {
        await save('rules', { ...rule, active: false, suspended: true, state: 'suspended',
          observations: [], confirmations: [], count: 0, version: rule.version + 1, updatedAt: iso(),
          counterexamples: [...(rule.counterexamples || []), { itemId: item.id, target: selected, at: iso() }].slice(-30) });
        for (const affected of items.values()) {
          if (affected.ruleId !== rule.id || affected.manualLocked) continue;
          setImmediate(() => {
            if (closed) return;
            void withItemLock(affected.id, async () => {
              const current = items.get(affected.id);
              if (!current || current.manualLocked || current.ruleId !== rule.id) return;
              if (current.status === 'delivered') await save('items', { ...current, learningReview: true });
              else if (['review', 'retry'].includes(current.status)) await save('items', { ...current, status: 'pending',
                analysisWork: null, message: '命中的学习规则已纠正，自动重新判断。' });
              host.changed?.();
            }).catch(error => host.onError?.(error));
          });
        }
      }
    }
    if (!matcher) return;
    const key = P.digest([source.id, item.studentId, matcher]), prior = rules.get(key);
    if (prior?.manualDisabled) return;
    const scopeHash = P.digest([source.id, source.studentId, source.target, source.folder]);
    const same = prior && P.sameTarget(prior.target, selected) && prior.scopeHash === scopeHash;
    const confirmations = (same ? prior.confirmations || [] : []).filter(sample => sample && typeof sample === 'object' && sample.sha256 !== item.fingerprint?.sha256
      && sample.group !== independentSample(item));
    confirmations.push({ sha256: item.fingerprint?.sha256 || item.id, group: independentSample(item), itemId: item.id });
    const record = { ...prior, ...matcher, id: key, sourceId: source.id, sourceRevision: source.revision, scopeHash,
      studentId: item.studentId, target: selected, confirmations: confirmations.slice(-30), count: confirmations.length,
      observations: same ? prior.observations || [] : [], active: false, suspended: false,
      state: confirmations.length >= 3 ? 'observing' : 'collecting', version: (prior?.version || 0) + 1, updatedAt: iso() };
    // Historical counterexamples prevent a broad directory rule from activating.
    for (const old of items.values()) {
      if (old.sourceId === source.id && old.studentId === item.studentId && old.lastDecision?.action
        && !old.lastDecision.onlyThis && old.target && P.learnedRuleMatches(record, old, old.identifier || '') && !P.sameTarget(old.target, selected)) {
        record.suspended = true; record.state = 'suspended'; break;
      }
    }
    await save('rules', record);
    const audit = { id: crypto.randomUUID(), at: iso(), event: 'learning_feedback', ruleId: key, ruleVersion: record.version, itemId: item.id, action, state: record.state };
    await writeJsonAtomic(fileFor('rule-audit', audit.id), audit);
  }
  async function observeLearnedRules(item, source, suggestion, text) {
    if (host.learnedRulesEnabled === false || !suggestion.candidates.length) return;
    const [first, second] = suggestion.candidates;
    for (const rule of rules.values()) {
      if (rule.sourceId !== source.id || rule.studentId !== item.studentId || rule.active || rule.suspended || rule.manualDisabled
        || rule.state !== 'observing' || !P.learnedRuleMatches(rule, item, text)) continue;
      if (rule.scopeHash !== P.digest([source.id, source.studentId, source.target, source.folder])) {
        await save('rules', { ...rule, active: false, state: 'collecting', observations: [], confirmations: [], count: 0, version: rule.version + 1 }); continue;
      }
      if (rule.confirmations.some(sample => sample.sha256 === item.fingerprint.sha256 || sample.group === independentSample(item))) continue;
      if (suggestion.conflict || first.score < .85 || second && first.score - second.score < .10) continue;
      if (!P.sameTarget(first, rule.target)) {
        await save('rules', { ...rule, state: 'suspended', suspended: true, observations: [], version: rule.version + 1 }); continue;
      }
      if ((rule.observations || []).some(sample => sample.sha256 === item.fingerprint.sha256)) continue;
      const observations = [...(rule.observations || []), { sha256: item.fingerprint.sha256, group: independentSample(item) }].slice(-30);
      const active = observations.length >= 5 && new Set(observations.map(sample => sample.group)).size >= 2;
      if (active) await host.validateTarget(rule.target);
      await save('rules', { ...rule, observations, active, state: active ? 'active' : 'observing', version: rule.version + 1, updatedAt: iso() });
    }
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
          if (item?.lastDecision?.requestId === id && item.lastDecision.action === request.action) {
            results.push({ id: selected.id, ok: true, status: item.status, recovered: true }); return;
          }
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
            item = await save('items', { ...item, studentId, status: 'pending', automationEligible: true, revision: item.revision + 1,
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
            item = await save('items', { ...item, status: 'review', revision: item.revision + 1,
              ...(item.cleanup ? { manualLocked: true, cleanup: { ...item.cleanup, stage: 'restored', restoredAt: iso() } } : {}) });
          } else if (request.action === 'retry') {
            if (!['review', 'retry'].includes(item.status) || item.receipt) throw Error('未知执行或已投递资料不能重新分析');
            if (item.manualLocked) throw Error('人工锁定的资料请手动指定位置，不自动覆盖');
            if (item.blockReason?.recoverable === false) throw Error('此记录需要核对上次执行或安全原因，不能重新派发');
            if (!source || source.detached || !source.enabled) throw Error('请先开启资料来源');
            await checkCurrent(item, source);
            await save('sources', { ...sources.get(source.id), manualWork: true });
            item = await save('items', { ...item, originalMissing: false, status: 'pending', automationEligible: true, nextRetryAt: '', revision: item.revision + 1,
              suggestion: null, proposedTarget: null, blockReason: null,
              execution: item.execution?.stage === 'host_committed' ? item.execution : null,
              message: '已加入分析队列；完成后请在本学生的待处理／已投递查看。' });
          } else if (request.action === 'reconcile') {
            if (item.status === 'execution_unknown') {
              const evidence = await reconciliationEvidence(item), saved = evidence?.decision;
              if (evidence?.rejected) { item = await resumeRejectedResult(item); }
              else {
              if (!saved || saved.itemId !== item.id || (saved.studentId && saved.studentId !== item.studentId)
                || (saved.sha256 && saved.sha256 !== item.fingerprint?.sha256)) throw Error('尚无可验证分类回执，保持待核对');
              item = await recoverClassification(item, source, saved);
              }
            } else {
              if (!['delivery_reconcile', 'archive_pending', 'delivering'].includes(item.status)) throw Error('此资料无需核对投递');
              const evidence = await reconciliationEvidence(item);
              if (evidence?.notDelivered) item = await resumeVerifiedDelivery(item, source);
              else {
              const receipt = item.receipt || await host.reconcile?.(item);
              await verifyReceipt(item, receipt);
              item = await save('items', { ...item, receipt, status: 'archive_pending' });
              item = await deliverItem(item, source, item.target, false);
              }
            }
          } else {
            const destination = P.target(selected.target || item.proposedTarget);
            if (request.action === 'accept' && item.suggestion?.conflict) throw Error('多个项目存在冲突，请手动指定投递位置');
            if (request.action === 'accept' && !P.sameTarget(destination, item.proposedTarget)) throw Error('目标已改变，请使用纠正投递');
            if (source.detached) throw Error('来源已解除关联');
            await host.validateTarget(destination);
            if (request.action === 'correct' && destination.studentId !== item.studentId) {
              if (item.studentId && selected.confirmedStudentChange !== true) throw Error('请明确确认将所选资料更正为目标学生');
              item = await reassign(item, source, destination.studentId, id, selected.revision, false);
            }
            item = await deliverItem(item, source, destination);
            await feedback(item, before, destination, request.action, request.onlyThis === true);
            item = await save('items', { ...item, manualLocked: true, learningReview: false, revision: item.revision + 1,
              lastDecision: { action: request.action, requestId: id, before, after: destination, onlyThis: request.onlyThis === true, at: iso() } });
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
  async function saveUserRule(input) {
    await init();
    return serial(async () => {
      const previous = input.id ? userRules.get(String(input.id)) : null;
      if (input.id && !previous) throw Error('规则不存在');
      if (previous && Number(input.expectedVersion) !== Number(previous.version)) throw Error('规则已变化，请刷新后重试');
      const validated = P.validateUserRule(input, previous);
      const source = validated.sourceId ? sources.get(validated.sourceId) : null;
      if (validated.sourceId && (!source || source.detached)) throw Error('规则来源不存在或已解除关联');
      if (source?.studentId && source.studentId !== validated.studentId) throw Error('规则来源与学生范围不一致');
      await host.context(validated.studentId, { mode: 'light' });
      if (validated.target) await host.validateTarget(validated.target);
      const record = { ...validated, id: previous?.id || crypto.randomUUID(), version: (previous?.version || 0) + 1,
        createdAt: previous?.createdAt || iso(), updatedAt: iso() };
      await save('user-rules', record);
      const auditId = crypto.randomUUID();
      await writeJsonAtomic(fileFor('rule-audit', auditId), { id: auditId, event: previous ? 'updated' : 'created',
        at: iso(), ruleId: record.id, ruleVersion: record.version, before: previous, after: record });
      host.changed?.(); return clone(record);
    });
  }
  async function listUserRules(query = {}) {
    await init(); const studentId = String(query.studentId || ''), sourceId = String(query.sourceId || '');
    return [...userRules.values()].filter(rule => (!studentId || rule.studentId === studentId) && (!sourceId || rule.sourceId === sourceId))
      .sort((a, b) => b.priority - a.priority || b.updatedAt.localeCompare(a.updatedAt)).map(clone);
  }
  async function listRuleSuggestions(query = {}) {
    await init();
    const studentId = String(query.studentId || ''), grouped = new Map();
    for (const item of items.values()) {
      if (!item.studentId || studentId && item.studentId !== studentId || !item.sourceId) continue;
      const action = item.lastDecision?.action;
      if (item.lastDecision?.onlyThis) continue;
      const isDelivery = item.status === 'delivered' && ['accept', 'correct'].includes(action) && item.target && item.identifier;
      const isIgnore = item.status === 'ignored' && action === 'ignore' && item.conversationKind === 'internal_task';
      if (!isDelivery && !isIgnore) continue;
      const draft = { name: isIgnore ? '建议：忽略系统内部任务' : '建议：已确认项目标识', studentId: item.studentId,
        sourceId: item.sourceId, sourceAgent: item.conversationSourceAgent || '',
        conversationKind: isIgnore ? 'internal_task' : '', action: isIgnore ? 'ignore' : 'deliver',
        target: isIgnore ? null : item.target, enabled: false, priority: 0,
        includeWords: [], excludeWords: [], pathIncludes: [], extensions: [],
        projectAliases: isDelivery ? [item.identifier] : [] };
      const id = P.digest(draft), value = grouped.get(id) || { id, draft, examples: [], count: 0, feedback: { accept: 0, correct: 0, ignore: 0 } };
      const fingerprint = item.fingerprint?.sha256 || item.id;
      if (!value.examples.includes(fingerprint)) { value.examples.push(fingerprint); value.count++; value.feedback[action]++; }
      grouped.set(id, value);
    }
    return [...grouped.values()].map(({ id, draft, count, feedback }) => ({ id, draft, count, feedback,
      basis: draft.action === 'ignore' ? '人工忽略且结构化内容确认为内部任务' : '人工确认或纠正的目标与明确标识' }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  }
  async function previewText(item, source) {
    const resolved = await resolveSourceFile(source, item.locator);
    const fingerprint = await hashStableFile(resolved.path);
    if (identity(resolved.stat) !== item.identity && !item.fingerprint?.sha256) throw Error('原件版本已变化');
    if (item.fingerprint?.sha256 && fingerprint.sha256 !== item.fingerprint.sha256) throw Error('原件指纹已变化');
    if (item.snapshotPath && item.fingerprint?.sha256) {
      if ((await hashStableFile(item.snapshotPath)).sha256 !== item.fingerprint.sha256) throw Error('快照校验失败');
    }
    const key = P.digest([item.studentId || item.sourceId, fingerprint.sha256, path.extname(item.name).toLowerCase(), host.extractorVersion || 'v1']);
    const cached = await read(path.join(root, 'extractions', `${key}.json`), null);
    if (cached?.schema === 3 && cached.sha256 === fingerprint.sha256 && typeof cached.result?.text === 'string') {
      return { text: cached.result.text, fingerprint, source: 'existing_extraction_cache', truncated: Boolean(cached.result.truncated || cached.result.blocked) };
    }
    const extension = path.extname(item.name).toLowerCase();
    if (!['.md', '.txt', '.csv'].includes(extension)) return { text: '', fingerprint, source: 'not_extracted', truncated: false };
    const file = item.snapshotPath || resolved.path, buffer = await fs.readFile(file);
    if (buffer.length > 200 * 1024) return { text: '', fingerprint, source: 'text_over_limit', truncated: true };
    return { text: buffer.toString('utf8'), fingerprint, source: 'read_only_text', truncated: false };
  }
  async function previewOne(item, extraRule = null) {
    const source = sources.get(item.sourceId);
    const base = { id: item.id, revision: item.revision, sourceId: item.sourceId, sourceRevision: source?.revision || 0,
      studentId: item.studentId, name: item.name, status: item.status, eligible: false, suggestedAction: 'confirm', reason: '' };
    if (!source || source.detached) return { ...base, reason: '来源不存在或已解除关联' };
    if (item.manualLocked) return { ...base, reason: '人工锁定的资料保持原处理结果' };
    if (['execution_unknown', 'delivery_reconcile', 'archive_pending'].includes(item.status)) {
      try {
        const evidence = await reconciliationEvidence(item);
        return { ...base, eligible: Boolean(evidence), suggestedAction: evidence ? 'reconcile' : 'wait',
          reason: evidence ? '已找到可核验结果；正式处理仅核验并续接，不重复投递。' : '等待可验证执行结果或投递登记；保留原执行，系统继续检查晚到结果。' };
      } catch (error) { return { ...base, suggestedAction: 'wait', reason: `核验未通过，保留原执行：${error.message}` }; }
    }
    if (item.studentId && !P.studentScopeMatches(item, source)) return { ...base, reason: '来源学生已变化，请人工核对历史资料' };
    if (!item.studentId || item.receipt || item.manualLocked || !['review', 'retry'].includes(item.status)
      || ['execution_unknown', 'delivery_reconcile', 'delivering', 'analyzing'].includes(item.status)) return { ...base, reason: '记录状态、人工锁定或既有回执不允许重新处理' };
    let data;
    try { data = await previewText(item, source); } catch (error) { return { ...base, reason: error.message }; }
    const disposition = Content.assessContent({ ...data, name: item.name, size: data.fingerprint?.size, sourceType: source.type });
    if (cleanup.enabled() && source.automatic && host.automaticTriage !== false && disposition.action === 'recycle') return {
      ...base, eligible: true, fingerprint: data.fingerprint, suggestedAction: 'ignore', reason: `确定性自动回收：${disposition.reason}；保留原件。` };
    if (!data.text || data.truncated) return { ...base, eligible: data.source === 'not_extracted',
      suggestedAction: data.source === 'not_extracted' ? 'classify' : 'confirm', fingerprint: data.fingerprint,
      reason: data.source === 'not_extracted' ? '此格式需正式提取和分析后决定去向' : '正文为空或超出试算限制' };
    const subject = automaticSubject(item, source, data.text);
    const routingItem = subject ? { ...item, studentId: subject.studentId, ownershipBasis: 'verified_subject' } : item;
    const routingSource = { ...source, studentId: routingItem.studentId };
    const context = await host.context(routingItem.studentId, { mode: 'light' });
    if (context.studentId !== routingItem.studentId) return { ...base, reason: '学生授权范围不匹配' };
    const conversation = inspectConversation(data.text, host.studentHints?.() || [], routingItem.studentId);
    if (cleanup.enabled() && conversation.kind === 'internal_task' && source.automatic && host.automaticTriage !== false
      && (source.type === 'session' || !conversation.studentConflict && !P.identifiers(data.text, context.projects).length)) return { ...base, eligible: true,
        fingerprint: data.fingerprint, suggestedAction: 'ignore', reason: '纯系统内部会话，可恢复忽略；保留原件，不调用Agent。' };
    if (conversation.studentConflict) return { ...base, eligible: host.automaticTriage !== false, suggestedAction: 'classify',
      fingerprint: data.fingerprint, reason: '正文提到多个学生，正式分析将核对主体、参与者和引用对象。' };
    const activeRules = extraRule ? [...userRules.values()].filter(rule => !extraRule.id || rule.id !== extraRule.id).concat({ ...extraRule, id: extraRule.id || 'preview-rule', version: Number(extraRule.version || 1) }) : [...userRules.values()];
    const match = P.matchUserRules({ rules: activeRules, source: routingSource, item: { ...routingItem, conversationKind: conversation.kind,
      conversationSourceAgent: conversation.sourceAgent || '' }, text: data.text, context });
    if (match.status === 'conflict') return { ...base, eligible: true, fingerprint: data.fingerprint, ruleStatus: match.status, reason: match.reason };
    if (match.status === 'matched') return { ...base, eligible: true, fingerprint: data.fingerprint, suggestedAction: match.action,
      target: match.target || null, ruleId: match.hit.rule.id, ruleVersion: match.hit.rule.version, ruleStatus: match.status, reason: match.reason };
    const local = P.automaticTarget({ source: routingSource, item: { ...routingItem, fingerprint: data.fingerprint }, context, text: data.text,
      suggestion: { candidates: [], sensitive: false, conflict: false, reason: '' }, rules: [...rules.values()],
      routingV2Enabled: host.routingV2Enabled !== false, classificationAttempted: false });
    if (local) return { ...base, eligible: true, fingerprint: data.fingerprint, suggestedAction: 'deliver', target: local.target,
      reason: `本机确定性依据：${local.basis}` };
    const stored = host.automaticTriage !== false && routingItem.automationEligible
      ? await storedRouting(routingItem, source, context, data.text, data.fingerprint) : null;
    if (stored?.decision) return { ...base, eligible: true, fingerprint: data.fingerprint, suggestedAction: 'deliver', target: stored.decision.target,
      reusedStages: stored.reusedStages, identityEvidence: stored.identityEvidence, candidateComplete: stored.coverage,
      reason: `复用已核验结果，项目归属明确${stored.decision.target.provisional ? '，细分类别暂存项目收件箱' : ''}；无需新增模型调用。` };
    if (Number(item.analysisWork?.calls || 0) >= 3 && (P.isTechnicalWait(item) || stored && !stored.decision && !stored.suggestion.conflict))
      return { ...base, suggestedAction: 'wait', fingerprint: data.fingerprint,
        reason: '现有预算已用满且核验证据未完整，等待服务、上下文或晚到结果变化后自动恢复；不转人工分类。' };
    const candidates = P.selectRoutingCandidates({ context, text: data.text, item, ruleMatch: match });
    const canRecallAll = Buffer.byteLength(JSON.stringify(context)) <= 100 * 1024;
    const mayClassify = candidates.candidateIds.length || !context.projects.length || canRecallAll;
    return { ...base, eligible: true, fingerprint: data.fingerprint, suggestedAction: mayClassify ? 'classify' : 'confirm',
      subjectStudentId: subject?.studentId || '', subjectEvidence: subject?.evidence || '', ruleBypasses: match.bypassed || [],
      candidateIds: candidates.candidateIds, candidates: candidates.candidates, candidateComplete: candidates.complete,
      reason: !candidates.strong && context.projects.length > 5 && canRecallAll ? '将先检查全部授权项目并生成候选；试算不会调用Agent。'
        : candidates.reason || (mayClassify ? '将仅加载受限上下文后调用分类器。' : '没有可靠候选项目。') };
  }
  async function previewBacklog(input = {}) {
    await init();
    let extraRule = null;
    if (input.rule) extraRule = P.validateUserRule(input.rule, input.rule);
    const requested = new Set((input.itemIds || []).map(String));
    const trialStudentId = String(input.studentId || '');
    const candidates = [...items.values()].filter(item => (!trialStudentId || item.studentId === trialStudentId) && (requested.size ? requested.has(item.id)
      : item.status === 'review' && (P.isTechnicalWait(item) || ['classification_review', 'no_candidate', 'candidate_scope_too_large'].includes(item.reasonCode) || /项目上下文过多|候选项目过多|无法可靠缩小|没有足够的本机证据|包含敏感资料线索/.test(item.message || ''))));
    const pageSize = 100, page = Math.max(1, Math.floor(Number(input.page) || 1));
    const results = [];
    for (const item of candidates.slice((page - 1) * pageSize, page * pageSize)) { results.push(await previewOne(item, extraRule)); await yieldTurn(); }
    const previewId = crypto.randomUUID(), expiresAt = new Date(now() + 15 * 60_000).toISOString();
    previews.set(previewId, { previewId, expiresAt, results, draftRule: Boolean(extraRule), ruleSetVersion: userRuleVersion() });
    for (const [id, preview] of previews) if (Date.parse(preview.expiresAt) <= now()) previews.delete(id);
    const counts = results.reduce((value, result) => { const key = result.suggestedAction === 'wait' ? 'wait' : result.eligible ? result.suggestedAction : 'ineligible'; value[key] = (value[key] || 0) + 1; return value; }, {});
    return { previewId, expiresAt, ruleSetVersion: userRuleVersion(), total: candidates.length, page, pageSize, counts, results };
  }
  async function applyPreview(input = {}) {
    await init();
    if (input.confirmed !== true) throw Error('必须明确确认后才能重新处理试算项');
    const preview = previews.get(String(input.previewId || ''));
    if (!preview || Date.parse(preview.expiresAt) <= now()) throw Error('试算已过期，请重新试算');
    if (preview.draftRule) throw Error('规则草稿仅供试算，请先保存规则后重新试算');
    if (preview.ruleSetVersion !== userRuleVersion()) throw Error('规则版本已变化，请重新试算');
    const requested = new Set((input.itemIds || []).map(String));
    if (!requested.size || requested.size > 100) throw Error('确认处理范围无效');
    const results = [];
    for (const entry of preview.results.filter(result => requested.has(result.id))) {
      await withItemLock(entry.id, async () => {
        try {
          const item = items.get(entry.id), source = item && sources.get(item.sourceId);
          if (!entry.eligible || !item || !source || item.revision !== entry.revision || source.revision !== entry.sourceRevision
            || item.receipt || item.manualLocked || !['review', 'retry'].includes(item.status)) throw Error('记录已变化或不再满足安全处理条件');
          await checkCurrent(item, source);
          const original = await resolveSourceFile(source, item.locator);
          const currentFingerprint = await hashStableFile(original.path);
          if (!entry.fingerprint?.sha256 || currentFingerprint.sha256 !== entry.fingerprint.sha256
            || item.fingerprint?.sha256 && item.fingerprint.sha256 !== entry.fingerprint.sha256) throw Error('原件指纹已变化');
          await save('sources', { ...source, manualWork: true });
          const saved = await save('items', { ...item, status: 'pending', revision: item.revision + 1, nextRetryAt: '',
            suggestion: null, proposedTarget: null, blockReason: null,
            execution: item.execution?.stage === 'host_committed' ? item.execution : null,
            trialConfirmation: { previewId: preview.previewId, ruleSetVersion: preview.ruleSetVersion, at: iso() },
            message: '已按只读试算确认重新处理；正式处理仍会再次核对原件、范围、回执和规则版本。' });
          results.push({ id: entry.id, ok: true, revision: saved.revision });
        } catch (error) { results.push({ id: entry.id, ok: false, message: error.message }); }
      });
    }
    if (results.some(result => result.ok)) setImmediate(() => tick().catch(error => host.onError?.(error)));
    host.changed?.(); return { results };
  }
  return {
    init, bootstrap, syncConversationRouting, updateSource, tick, decide, saveUserRule, listUserRules, listRuleSuggestions, previewBacklog, applyPreview,
    async cleanupPolicy() { await init(); return cleanup.policy(); },
    async updateCleanupPolicy(input) { await init(); return cleanup.update(input); },
    async previewCleanup(input) { await init(); return cleanup.preview(input); },
    async cleanupDetail(input) { await init(); return cleanup.detail(input.id); },
    async restoreCleanup(input) { await init(); return cleanup.restore(input); },
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
    hasPendingWork() { return !closed && !blocked && [...items.values()].some(i => { const s = sources.get(i.sourceId); return s && !s.detached && batchMayRun(i) && (s.manualWork || s.pendingManual || s.enabled && host.automaticAllowed(s.studentId)) && (
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
    groups: batchRuntime.groups,
    previewBatch: batchRuntime.preview,
    batchDetail: batchRuntime.detail,
    controlBatch: batchRuntime.control,
    async learnedRules(query = {}) { await init(); return [...rules.values()].filter(rule => !query.studentId || rule.studentId === query.studentId).map(clone); },
    async pauseLearnedRule(input) {
      await init(); return serial(async () => {
        const rule = rules.get(String(input.id));
        if (!rule || rule.version !== input.expectedVersion) throw Error('学习规则已变化，请刷新');
        await host.context(rule.studentId, { mode: 'light' });
        const value = await save('rules', { ...rule, active: false, suspended: true, manualDisabled: true,
          state: 'suspended', version: rule.version + 1, updatedAt: iso() });
        host.changed?.(); return value;
      });
    },
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
      const requestedGroup = String(query.reasonGroup || ''), reasonCounts = {};
      let indexed = null;
      // Group counts must cover the entire filtered scope, not just an indexed page.
      try { if (!query.includeReasonCounts && !requestedGroup && !['processing', 'questions'].includes(query.status)) indexed = readIndex?.list({ studentId: scope, sourceId, status: query.status, page, size }) || null; }
      catch { try { readIndex?.close(); } catch {} readIndex = null; }
      for (const i of indexed ? indexed.ids.map(id => items.get(id)).filter(Boolean) : items.values()) {
        if (sourceId && i.sourceId !== sourceId || scope && i.studentId && i.studentId !== scope) continue;
        if (query.status === 'delivered' ? i.status !== 'delivered' : query.status === 'ignored' ? i.status !== 'ignored' : ['delivered', 'ignored'].includes(i.status)) continue;
        if (query.status === 'processing' && require('./smart-inbox-batches.cjs').needsHuman(i)) continue;
        if (query.status === 'questions' && !require('./smart-inbox-batches.cjs').needsHuman(i)) continue;
        const group = reasonGroup(i); reasonCounts[group] = (reasonCounts[group] || 0) + 1;
        if (requestedGroup && group !== requestedGroup) continue;
        rows.push(i);
      }
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { total: indexed ? indexed.total : rows.length, page, pageSize: size, reasonCounts, rows: (indexed ? rows : rows.slice((page - 1) * size, page * size)).map(i => ({
        id: i.id, sourceId: i.sourceId, sourceName: sources.get(i.sourceId)?.name, sourceType: i.sourceType, studentId: i.studentId, name: i.name, size: i.size, status: i.status, reasonCode: i.reasonCode || '', reasonGroup: reasonGroup(i), revision: i.revision, automationDisposition: i.automationDisposition || '', originalMissing: Boolean(i.originalMissing), suggestedTags: i.suggestedTags || [],
        blockReason: i.blockReason || null, execution: i.execution ? { stage: i.execution.stage, providerId: i.execution.providerId,
          switched: Boolean(i.execution.switched || i.execution.attempts?.some(a => a.providerId && a.providerId !== i.execution.providerId)) } : null,
        message: i.status === 'pending' && sources.get(i.sourceId)?.waitingReason || i.message, proposedTarget: i.proposedTarget, target: i.target,
        suggestionConflict: Boolean(i.suggestion?.conflict), candidateTargets: i.suggestion?.conflict ? (i.suggestion.candidates || []).map(({ studentId, type, id, categoryId }) => ({ studentId, type, id, categoryId })) : [],
        reason: i.status === 'pending' ? sources.get(i.sourceId)?.waitingReason || i.message : P.isTechnicalWait(i) || i.originalMissing || i.extractionPartial || i.associationChange?.retained ? i.message : i.suggestion?.conflict ? i.suggestion.reason || i.message : i.suggestion?.candidates[0]?.reason || i.message, manualLocked: i.manualLocked,
        reconcileAttempts: Number(i.reconcileAttempts || 0), reconcileExhausted: ['execution_unknown', 'delivery_reconcile'].includes(i.status) && Number(i.reconcileAttempts || 0) >= 3, createdAt: i.createdAt,
      })) };
    },
    async detail(id) { await init(); const i = items.get(id); if (!i) throw Error('资料不存在'); return clone(i); },
    async openOriginal(id) { await init(); const i = items.get(id); if (!i) throw Error('资料不存在');
      const source = sources.get(i.sourceId);
      if (i.receipt) { await verifyReceipt(i, i.receipt); return i.receipt.path; }
      const file = i.archivePath || (await resolveItemFile(i, source)).path;
      if (i.archivePath && (await hashStableFile(file)).sha256 !== i.fingerprint.sha256) throw Error('归档原件已变化'); return file; },
    async close() { closed = true; await active?.catch(() => {}); await commands.catch(() => {}); try { readIndex?.close(); } catch {} readIndex = null; },
  };
}
module.exports = { createSmartInbox, identity, within, reasonGroup };
