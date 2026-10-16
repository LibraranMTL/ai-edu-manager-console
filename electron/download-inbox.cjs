'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashStableFile, writeJsonAtomic } = require('./project-materials.cjs');
const MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.pdf', '.txt', '.md', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.zip']);
const ARCHIVE = '已投递';
function within(root, file) { const rel = path.relative(root, file); return !rel || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep)); }
async function realDirectory(directory) {
  if (!path.isAbsolute(directory)) throw Error('请选择绝对路径文件夹');
  let current = path.resolve(directory);
  while (true) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('文件夹及其上级不能使用链接或重解析目录');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  return fs.realpath(directory);
}
function identity(stat) { return [String(stat.dev), String(stat.ino), stat.size, stat.mtimeMs, stat.ctimeMs].join(':'); }
function temporary(name) { return /^~\$|^\.~|\.crdownload$|\.part$|\.partial$|\.tmp$|\.download$/i.test(name); }
function policy(name, stat) {
  if (!ALLOWED.has(path.extname(name).toLowerCase())) return '文件类型不支持';
  if (!stat.size || stat.size > MAX_BYTES) return '文件须为 1 字节至 100 MiB';
  return '';
}

function createDownloadInbox({ dataDir, forbiddenRoots = () => [], validateTarget, deliver, trash, hooks = {}, stableAgeMs = 1500 }) {
  const settingsFile = path.join(dataDir, 'settings.json'), ledgerFile = path.join(dataDir, 'operations.json');
  const bindings = new Map(), secret = crypto.randomBytes(32);
  let queue = Promise.resolve();
  const serial = work => { const next = queue.catch(() => {}).then(work); queue = next; return next; };
  async function read(file, fallback) {
    try { if ((await fs.lstat(file)).isSymbolicLink()) throw Error('收件箱配置不能使用链接'); return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  }
  async function persist(file, value) { await fs.mkdir(dataDir, { recursive: true }); await realDirectory(dataDir); await writeJsonAtomic(file, value); }
  async function settings() { return read(settingsFile, { schema: 'DownloadInboxSettings.v1', folder: '' }); }
  async function ledger() {
    const value = await read(ledgerFile, { schema: 'DownloadInboxOperations.v1', operations: [] });
    if (value.schema !== 'DownloadInboxOperations.v1' || !Array.isArray(value.operations)) throw Error('下载收件箱记录损坏，请保留文件并检查');
    return value;
  }
  async function checkFolder(folder) {
    const resolved = await realDirectory(folder);
    if (path.parse(resolved).root === resolved) throw Error('不能选择磁盘根目录');
    for (const item of [dataDir, ...await forbiddenRoots()]) {
      if (!item) continue;
      const root = path.resolve(item);
      if (within(root, resolved) || within(resolved, root)) throw Error('不能选择系统目录或教育管家受管资料目录及其上级');
    }
    return resolved;
  }
  async function activeFolder() {
    const config = await settings(); if (!config.folder) throw Error('请先选择下载文件收件箱');
    const folder = await checkFolder(config.folder); if (folder !== config.folder) throw Error('文件夹身份已变化，请重新选择'); return folder;
  }
  function fileId(key) { return crypto.createHmac('sha256', secret).update(key).digest('hex'); }
  async function resolveFile(binding) {
    const folder = await activeFolder();
    if (!binding || binding.folder !== folder || path.basename(binding.name) !== binding.name || binding.name.includes(':')) throw Error('选择已失效，请刷新列表');
    const file = path.join(folder, binding.name);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || identity(stat) !== binding.identity) throw Error('文件已变化，请刷新后重新选择');
    const reason = policy(binding.name, stat);
    if (reason) throw Error(reason);
    if (stableAgeMs > 0 && Date.now() - stat.mtimeMs < stableAgeMs) throw Error('文件仍在写入，请稍后刷新');
    return { folder, file, stat };
  }
  function publicOperation(entry) {
    return { operationId: entry.operationId, name: entry.name, byteSize: entry.fingerprint?.size || entry.byteSize,
      modifiedAt: entry.modifiedAt, type: path.extname(entry.name).slice(1).toUpperCase(), status: entry.status,
      message: entry.message || '', studentId: entry.target.studentId, targetName: entry.targetName || '',
      archivePath: entry.archivePath || '', deliveredAt: entry.deliveredAt || '' };
  }
  async function list() {
    const config = await settings(); if (!config.folder) return { folder: '', files: [], skipped: 0 };
    const folder = await activeFolder(), records = await ledger();
    const entries = await fs.readdir(folder, { withFileTypes: true }), files = [];
    let skipped = 0;
    // Metadata only: never hash, copy, register, rename or delete on list/refresh.
    for (let index = 0; index < entries.length; index += 32) {
      const chunk = await Promise.all(entries.slice(index, index + 32).map(async entry => {
        if (!entry.isFile() || entry.isSymbolicLink() || temporary(entry.name) || entry.name.includes(':')) { skipped++; return null; }
        try {
          const stat = await fs.lstat(path.join(folder, entry.name));
          if (!stat.isFile() || stat.isSymbolicLink() || (stableAgeMs > 0 && Date.now() - stat.mtimeMs < stableAgeMs)) { skipped++; return null; }
          const key = identity(stat), id = fileId(folder + '\0' + entry.name + '\0' + key);
          bindings.set(id, { folder, name: entry.name, identity: key });
          const operation = records.operations.findLast(item => item.folder === folder && item.name === entry.name && item.identity === key);
          return { fileId: id, identity: key, name: entry.name, byteSize: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString(),
            type: path.extname(entry.name).slice(1).toUpperCase(), status: operation?.status === 'delivering' ? 'interrupted' : operation?.status || 'pending',
            message: policy(entry.name, stat) || operation?.message || '', supported: !policy(entry.name, stat), selectable: true,
            targetName: operation?.targetName || '', operationId: operation?.operationId || '' };
        } catch { skipped++; return null; }
      }));
      files.push(...chunk.filter(Boolean));
    }
    for (const entry of records.operations.filter(item => item.folder === folder)) {
      if (entry.status === 'delivered') files.push({ ...publicOperation(entry), fileId: 'history:' + entry.operationId, supported: false, selectable: false });
      else if (entry.receipt && !files.some(file => file.operationId === entry.operationId)) {
        const id = fileId(entry.operationId);
        bindings.set(id, { folder, name: entry.name, identity: entry.identity });
        files.push({ ...publicOperation(entry), status: 'archive_pending', fileId: id, supported: true, selectable: true });
      }
    }
    return { folder, files, skipped };
  }
  async function archive(entry) {
    const folder = await activeFolder(); if (entry.folder !== folder) throw Error('关联文件夹已变化');
    const archiveDir = path.join(folder, ARCHIVE); await fs.mkdir(archiveDir, { recursive: true }); await realDirectory(archiveDir);
    const source = path.join(folder, entry.name);
    let stat;
    try { stat = await fs.lstat(source); } catch (error) {
      if (error.code === 'ENOENT' && entry.archivePath && path.dirname(entry.archivePath) === archiveDir) {
        const archived = await fs.lstat(entry.archivePath);
        if (archived.isFile() && !archived.isSymbolicLink() && (await hashStableFile(entry.archivePath)).sha256 === entry.fingerprint.sha256) return;
      }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || identity(stat) !== entry.identity) throw Error('原文件已变化，已投递副本保留，原件不归档');
    const fingerprint = await hashStableFile(source);
    if (fingerprint.sha256 !== entry.fingerprint.sha256) throw Error('原件内容已变化，不归档');
    await hooks.beforeArchive?.(entry);
    if (identity(await fs.lstat(source)) !== entry.identity) throw Error('原件在归档前发生变化');
    // Exclusive destination creation: rename() can overwrite on some platforms.
    // A durable name lets retries reconcile a completed copy / lost unlink receipt.
    const destination = entry.archivePath;
    if (!destination || path.dirname(destination) !== archiveDir) throw Error('归档路径无效');
    try { await fs.copyFile(source, destination, require('node:fs').constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const destStat = await fs.lstat(destination);
    if (!destStat.isFile() || destStat.isSymbolicLink() || (await hashStableFile(destination)).sha256 !== entry.fingerprint.sha256) throw Error('归档文件冲突，未删除原件');
    if (identity(await fs.lstat(source)) !== entry.identity || (await hashStableFile(source)).sha256 !== entry.fingerprint.sha256) throw Error('归档期间原件变化，未删除原件');
    await fs.unlink(source);
  }
  async function batch(ids, target) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string')) throw Error('每次请选择 1 至 100 个文件');
    const context = await validateTarget(target), folder = await activeFolder(), value = await ledger(), results = [];
    for (const id of [...new Set(ids)]) {
      let entry;
      try {
        const binding = bindings.get(id);
        if (!binding || binding.folder !== folder) throw Error('选择已失效，请刷新');
        await validateTarget(target);
        const previous = value.operations.findLast(item => item.folder === folder && item.name === binding.name && item.identity === binding.identity);
        if (previous && (previous.target.studentId !== target.studentId || previous.target.type !== target.type || String(previous.target.id || '') !== String(target.id || ''))) throw Error('此文件已有投递任务，请先按原目标完成或使用新资料副本');
        entry = previous;
        const source = !entry?.receipt ? await resolveFile(binding) : null;
        if (!entry) {
          const operationId = crypto.randomUUID();
          let archivePath = path.join(folder, ARCHIVE, binding.name);
          try { await fs.lstat(archivePath); archivePath = path.join(folder, ARCHIVE, `${path.parse(binding.name).name}-${operationId}${path.extname(binding.name)}`); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          entry = { operationId, folder, name: binding.name, identity: binding.identity, byteSize: source.stat.size,
            modifiedAt: new Date(source.stat.mtimeMs).toISOString(), target: structuredClone(target), targetName: context.targetName,
            status: 'preparing', message: '', archivePath };
          value.operations.push(entry); await persist(ledgerFile, value);
        }
        if (!entry.fingerprint) {
          const snapshots = path.join(dataDir, 'snapshots', entry.operationId, crypto.randomUUID());
          await fs.mkdir(snapshots, { recursive: true }); await realDirectory(snapshots);
          const snapshot = path.join(snapshots, entry.name);
          const fingerprint = await hashStableFile(source.file, { copyTo: snapshot });
          if (identity(await fs.lstat(source.file)) !== entry.identity) throw Error('文件在复制期间变化');
          entry.fingerprint = fingerprint; entry.snapshotPath = snapshot; entry.status = 'delivering'; await persist(ledgerFile, value);
        }
        if (!entry.receipt) {
          if (!within(path.join(dataDir, 'snapshots'), entry.snapshotPath) || (await fs.lstat(entry.snapshotPath)).isSymbolicLink()
            || (await hashStableFile(entry.snapshotPath)).sha256 !== entry.fingerprint.sha256) throw Error('受控快照校验失败');
          entry.status = 'delivering'; await persist(ledgerFile, value);
          const receipt = await deliver(entry.snapshotPath, await validateTarget(target), entry, async patch => {
            Object.assign(entry, patch); await persist(ledgerFile, value);
          });
          if (!receipt?.ok || !receipt.path || !receipt.recordId) throw Error(receipt?.message || '未获得可核对的资料登记回执');
          await realDirectory(path.dirname(receipt.path));
          if ((await fs.lstat(receipt.path)).isSymbolicLink() || (await hashStableFile(receipt.path)).sha256 !== entry.fingerprint.sha256) throw Error('目标内容校验未通过');
          entry.receipt = receipt; entry.deliveredAt = new Date().toISOString(); entry.status = 'archive_pending'; await persist(ledgerFile, value);
          await hooks.afterReceipt?.(entry);
        } else {
          await realDirectory(path.dirname(entry.receipt.path));
          if ((await fs.lstat(entry.receipt.path)).isSymbolicLink() || (await hashStableFile(entry.receipt.path)).sha256 !== entry.fingerprint.sha256) throw Error('已投递副本不可用，原件不归档');
        }
        if (entry.status === 'delivered') {
          const archived = await fs.lstat(entry.archivePath);
          if (!archived.isFile() || archived.isSymbolicLink() || (await hashStableFile(entry.archivePath)).sha256 !== entry.fingerprint.sha256) throw Error('已归档原件不可用，请保留目标资料');
          results.push({ fileId: id, ok: true, duplicate: true, ...publicOperation(entry) }); continue;
        }
        await archive(entry); entry.status = 'delivered'; entry.message = ''; await persist(ledgerFile, value);
        results.push({ fileId: id, ok: true, ...publicOperation(entry) });
      } catch (error) {
        if (entry) { entry.status = entry.receipt ? 'archive_pending' : 'failed'; entry.message = error.message; await persist(ledgerFile, value); }
        results.push({ fileId: id, ok: false, status: entry?.status || 'failed', message: error.message });
      }
    }
    return { results };
  }
  return {
    getSettings: settings,
    configure: folder => serial(async () => {
      const resolved = folder ? await checkFolder(folder) : '';
      const config = { schema: 'DownloadInboxSettings.v1', folder: resolved }; await persist(settingsFile, config); bindings.clear(); return config;
    }),
    list,
    selection: id => serial(async () => { const binding = bindings.get(id);
      if (!binding || binding.folder !== await activeFolder()) throw Error('选择已失效，请刷新');
      try { await resolveFile(binding); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return { ...binding, locator: binding.name }; }),
    deliver: (ids, target) => serial(() => batch(ids, target)),
    trash: (ids, confirmed) => serial(async () => {
      if (confirmed !== true || !Array.isArray(ids) || !ids.length || ids.length > 100) throw Error('回收须确认且每批最多 100 项');
      const results = [];
      for (const id of [...new Set(ids)]) {
        try {
          const binding = bindings.get(id), folder = await activeFolder();
          if (!binding || binding.folder !== folder) throw Error('选择已失效，请刷新');
          const file = path.join(folder, binding.name), stat = await fs.lstat(file);
          if (!stat.isFile() || stat.isSymbolicLink() || identity(stat) !== binding.identity || (stableAgeMs > 0 && Date.now() - stat.mtimeMs < stableAgeMs)) throw Error('文件已变化或仍在写入');
          await trash(file); bindings.delete(id); results.push({ fileId: id, ok: true });
        } catch (error) { results.push({ fileId: id, ok: false, message: error.message }); }
      }
      return { results };
    }),
    open: async opener => { const folder = await activeFolder(); await opener(folder); return { folder }; },
  };
}
module.exports = { createDownloadInbox, MAX_BYTES, ALLOWED, realDirectory };
