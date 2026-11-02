const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { invariant, identifier } = require('./project-material-contract.cjs');
const { safePath, writeJsonAtomic, withCommitLock } = require('./project-materials.cjs');
const { openKnowledgeGuard } = require('./project-knowledge-guard.cjs');

const SCHEMA = 'edu-manager.project-archive-transaction.v1';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const key = (file) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const FILE_LIMIT = 64 * 1024 * 1024;
const TOTAL_LIMIT = 256 * 1024 * 1024;

function assertLinkFree(file) {
  let current = path.resolve(file);
  while (true) {
    try { invariant(!fs.lstatSync(current).isSymbolicLink(), 'linked_path', '归档路径包含链接，不能提交。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === path.parse(current).root) break;
    current = path.dirname(current);
  }
}

function createProjectArchiveTransactions({ directory, projectId, roots, files = [], authorize, authorizeLocked = async () => true,
  sourceGuards = async () => [], guardFactory = openKnowledgeGuard, hooks = {}, registerPrepared = async () => {}, runExclusive = (work) => work() }) {
  identifier(projectId, '项目ID');
  invariant(path.isAbsolute(directory || '') && typeof authorize === 'function', 'invalid_transaction', '事务必须配置授权目录和检查。');
  assertLinkFree(directory);
  invariant((roots || []).every((root) => path.isAbsolute(root)) && files.every((file) => path.isAbsolute(file)), 'invalid_root', '事务授权范围必须使用绝对路径。');
  const allowedRoots = [...new Set((roots || []).map((root) => path.resolve(root)))];
  const allowedFiles = new Set(files.map(key));
  invariant(allowedRoots.length > 0 && allowedRoots.every((root) => root !== path.parse(root).root), 'invalid_root', '归档不能以磁盘根作为授权范围。');
  function targetRoot(file) {
    invariant(path.isAbsolute(file), 'invalid_path', '归档目标必须是绝对路径。');
    const root = allowedFiles.has(key(file)) ? path.dirname(path.resolve(file))
      : allowedRoots.filter((item) => key(file).startsWith(`${key(item)}${path.sep}`)).sort((a, b) => b.length - a.length)[0];
    invariant(root, 'invalid_path', '归档目标不在已批准范围。');
    // Every existing ancestor, including the grant root, must be link-free.
    assertLinkFree(file);
    return root;
  }
  function readBytes(file) {
    assertLinkFree(file);
    const handle = fs.openSync(file, 'r');
    try {
      const before = fs.fstatSync(handle);
      invariant(before.isFile() && before.size <= FILE_LIMIT, 'archive_limit', '归档目标不是普通文件或超过64MiB。');
      const buffer = Buffer.alloc(before.size + 1); let offset = 0;
      while (offset < buffer.length) {
        const count = fs.readSync(handle, buffer, offset, buffer.length - offset, offset);
        if (!count) break;
        offset += count;
      }
      const after = fs.fstatSync(handle), named = fs.statSync(file);
      invariant(offset === before.size && ['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].every((field) => before[field] === after[field] && after[field] === named[field]),
        'source_changed', '归档文件在读取期间发生变化，请重试。');
      return buffer.subarray(0, offset);
    } finally { fs.closeSync(handle); }
  }
  async function journalFile(id, create = false) {
    invariant(/^archive-tx-[a-f0-9-]{36}$/.test(id), 'invalid_transaction', '归档事务ID无效。');
    assertLinkFree(directory);
    if (create) await fsp.mkdir(directory, { recursive: true });
    assertLinkFree(directory);
    const folder = await safePath(directory, id, { allowMissing: create });
    if (create) await fsp.mkdir(folder);
    return { folder, file: await safePath(folder, 'journal.json', { allowMissing: create }) };
  }
  async function assertAuthorized(journal) {
    invariant(await authorize(journal.metadata), 'forbidden', '归档事务的当前项目、学生或任务授权已失效。');
  }
  async function save(paths, journal, state) {
    assertLinkFree(directory); assertLinkFree(paths.file);
    journal.state = state; journal.updatedAt = new Date().toISOString();
    await writeJsonAtomic(paths.file, journal);
  }
  async function apply(paths, journal) {
    invariant(journal.schema === SCHEMA && journal.projectId === projectId && journal.id === path.basename(paths.folder)
      && Array.isArray(journal.entries) && journal.entries.length > 0 && journal.entries.length <= 2000,
    'invalid_transaction', '归档事务日志的范围或结构无效。');
    await assertAuthorized(journal);
    const targets = []; let total = 0; const seen = new Set();
    for (const [i, entry] of journal.entries.entries()) {
      const root = targetRoot(entry.path);
      invariant(!seen.has(key(entry.path)), 'invalid_transaction', '归档事务目标重复。'); seen.add(key(entry.path));
      invariant(entry.after === `${i}.after` && entry.before === `${i}.before`, 'invalid_transaction', '归档暂存文件名不符合合同。');
      const bytes = readBytes(await safePath(paths.folder, entry.after));
      total += bytes.length;
      invariant(sha(bytes) === entry.afterHash && total <= TOTAL_LIMIT, 'transaction_corrupt', '归档暂存内容损坏或超限。');
      if (entry.beforeHash !== null) invariant(sha(readBytes(await safePath(paths.folder, entry.before))) === entry.beforeHash,
        'transaction_corrupt', '归档前像备份损坏。');
      let currentHash = null;
      try { currentHash = sha(readBytes(entry.path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      invariant(currentHash === entry.beforeHash || currentHash === entry.afterHash,
        'recovery_conflict', '归档目标在准备或中断后被外部修改，已保留事务现场和备份。');
      fs.mkdirSync(path.dirname(entry.path), { recursive: true }); targetRoot(entry.path);
      targets.push({ path: entry.path, root, baselineHash: currentHash, sha256: entry.afterHash, contentBase64: bytes.toString('base64') });
    }
    const attempt = `attempt-${crypto.randomUUID()}`;
    const backupRoot = await safePath(paths.folder, attempt, { allowMissing: true }); await fsp.mkdir(backupRoot);
    targets.forEach((target, i) => { target.backupPath = path.join(backupRoot, `${i}.bin`); });
    await save(paths, journal, 'preparing');
    const sources = await sourceGuards(journal.metadata);
    const guard = guardFactory({ profile: 'project-archive-v1', allowedTargetRoots: [...new Set(targets.map((target) => target.root))], backupRoot, sources, targets });
    let finalized = false;
    try {
      await guard.ready();
      // Project/index files can now be FileShare.None locked. The ordinary
      // authorizer ran before locking; this callback checks only non-target
      // task/permission state. Target hashes themselves are guarded natively.
      invariant(await authorizeLocked(journal.metadata), 'forbidden', '归档锁定后的执行授权已失效。');
      await hooks.afterLocked?.({ journal, guard });
      await save(paths, journal, 'writing'); await guard.write();
      await save(paths, journal, 'files_written');
      await hooks.afterFilesWritten?.({ journal, guard });
      await guard.finalize(); finalized = true;
      await hooks.afterFinalized?.({ journal, guard });
      await save(paths, journal, 'committed');
      return { ok: true, transactionId: journal.id, operation: journal.metadata?.operation || '', state: 'committed',
        committedAt: journal.updatedAt, metadata: journal.metadata, result: journal.result };
    } catch (error) {
      if (!finalized) {
        const result = await guard.abort().catch(() => ({ interrupted: true }));
        journal.rollbackUncertain = Boolean(result.interrupted || result.rollbackFailures?.length);
      }
      journal.lastError = { code: error.code || 'archive_failed', message: error.message };
      // Always retain durable input. A crash after finalization but before the
      // receipt is equivalent to lost acknowledgement, not a new operation.
      await save(paths, journal, finalized ? 'files_written' : 'interrupted').catch(() => {});
      throw error;
    }
  }
  async function pending() {
    assertLinkFree(directory);
    if (!fs.existsSync(directory)) return [];
    const result = [];
    for (const name of await fsp.readdir(directory)) {
      if (!/^archive-tx-[a-f0-9-]{36}$/.test(name)) continue;
      let paths, journal;
      try { paths = await journalFile(name); journal = JSON.parse(readBytes(paths.file)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      invariant(journal.schema === SCHEMA && journal.projectId === projectId, 'invalid_transaction', '归档日志不属于此项目。');
      if (!['committed', 'staging', 'abandoned'].includes(journal.state)) result.push({ id: name, state: journal.state, metadata: journal.metadata });
    }
    return result;
  }
  async function resume(id) {
    return withCommitLock('project-archive-global-commit', () => runExclusive(async () => {
      const paths = await journalFile(id); const journal = JSON.parse(readBytes(paths.file));
      invariant(journal.state !== 'abandoned', 'archive_abandoned', '该归档已取消，不能恢复旧提交。');
      await registerPrepared({ id: journal.id, projectId, directory }, journal.entries);
      if (journal.state === 'committed') {
        invariant(journal.schema === SCHEMA && journal.projectId === projectId, 'invalid_transaction', '归档日志范围无效。');
        await assertAuthorized(journal);
        return { ok: true, transactionId: id, operation: journal.metadata?.operation || '', state: 'committed',
          committedAt: journal.updatedAt, metadata: journal.metadata, result: journal.result, replay: true };
      }
      return { ...await apply(paths, journal), recovered: true };
    }));
  }
  function begin(metadata = {}) {
    const entries = new Map(); let sealed = false; let beforeBytes = 0; let afterBytes = 0;
    function entry(file) {
      invariant(!sealed, 'transaction_sealed', '归档计划已经封存。');
      targetRoot(file); const canonical = path.resolve(file), id = key(canonical);
      if (!entries.has(id)) {
        let before = null;
        try { before = readBytes(canonical); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        invariant(entries.size < 2000 && beforeBytes + (before?.length || 0) <= TOTAL_LIMIT
          && afterBytes + (before?.length || 0) <= TOTAL_LIMIT, 'archive_limit', '归档暂存总量超过256MiB或2000个目标。');
        beforeBytes += before?.length || 0; afterBytes += before?.length || 0;
        entries.set(id, { path: canonical, before, after: before });
      }
      return entries.get(id);
    }
    const io = {
      existsSync(file) { return entry(file).after !== null; },
      readFileSync(file, options) {
        const bytes = entry(file).after;
        invariant(bytes !== null, 'ENOENT', '归档暂存文件尚不存在。');
        const encoding = typeof options === 'string' ? options : options?.encoding;
        return encoding ? bytes.toString(encoding) : Buffer.from(bytes);
      },
      writeFileSync(file, content, options) {
        const target = entry(file), flag = typeof options === 'object' ? options.flag : '';
        invariant(flag !== 'wx' || target.after === null, 'EEXIST', '归档目标已存在，不覆盖。');
        const encoding = typeof options === 'string' ? options : options?.encoding || 'utf8';
        const size = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(String(content), encoding);
        invariant(size <= FILE_LIMIT && afterBytes - (target.after?.length || 0) + size <= TOTAL_LIMIT, 'archive_limit', '归档暂存超过单文件64MiB或总量256MiB。');
        afterBytes += size - (target.after?.length || 0);
        target.after = Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(String(content), encoding);
      },
      appendFileSync(file, content, options) {
        const target = entry(file);
        invariant((target.after?.length || 0) + Buffer.byteLength(String(content)) <= FILE_LIMIT, 'archive_limit', '追加后的归档文件超过64MiB。');
        io.writeFileSync(file, Buffer.concat([target.after || Buffer.alloc(0), Buffer.from(String(content), typeof options === 'string' ? options : 'utf8')]));
      },
      mkdirSync(file) { targetRoot(path.join(path.resolve(file), '.edu-directory-check')); fs.mkdirSync(file, { recursive: true }); },
    };
    async function commit(result) {
      invariant(!sealed, 'transaction_sealed', '归档计划已经提交。'); sealed = true;
      return withCommitLock('project-archive-global-commit', () => runExclusive(async () => {
        invariant((await pending()).length === 0, 'archive_recovery_required', '此项目存在未完成归档事务，请先恢复。');
        const writes = [...entries.values()].filter((item) => item.after !== null && (item.before === null || !item.before.equals(item.after)));
        invariant(writes.length > 0 && writes.length <= 2000 && writes.reduce((sum, item) => sum + item.after.length, 0) <= TOTAL_LIMIT,
          'archive_limit', '归档事务无写入或超过2000个目标/256MiB，请分批处理。');
        await assertAuthorized({ metadata });
        const id = `archive-tx-${crypto.randomUUID()}`; const paths = await journalFile(id, true);
        const journal = { schema: SCHEMA, id, projectId, state: 'staging', metadata, result, entries: [] };
        await save(paths, journal, 'staging');
        // No official file is modified until every before/after image and the
        // complete journal is durable. Orphan staging folders are identifiable.
        for (const [i, item] of writes.entries()) {
          for (const [suffix, bytes] of [['before', item.before], ['after', item.after]]) {
            if (bytes === null) continue;
            const handle = await fsp.open(path.join(paths.folder, `${i}.${suffix}`), 'wx');
            try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
          }
          journal.entries.push({ path: item.path, before: `${i}.before`, after: `${i}.after`, beforeHash: item.before === null ? null : sha(item.before), afterHash: sha(item.after) });
        }
        await save(paths, journal, 'prepared');
        await registerPrepared({ id: journal.id, projectId, directory }, journal.entries);
        await hooks.afterPrepared?.({ journal });
        return apply(paths, journal);
      }));
    }
    function stageCopy(source, target, expectedHash) {
      // The host supplies an authorized fixed snapshot, never a client path.
      // Bounded FD reads also detect growth/replacement during the read.
      invariant(/^[a-f0-9]{64}$/.test(expectedHash || ''), 'invalid_hash', '归档复制必须提供固定来源校验值。');
      targetRoot(target);
      const bytes = readBytes(source);
      invariant(sha(bytes) === expectedHash, 'source_changed', '归档副本与固定来源版本不符，已停止归档。');
      io.writeFileSync(target, bytes, { flag: 'wx' });
    }
    return { io, commit, stageCopy };
  }
  async function abandon(id) {
    return withCommitLock('project-archive-global-commit', () => runExclusive(async () => {
      const paths = await journalFile(id); const journal = JSON.parse(readBytes(paths.file));
      invariant(journal.schema === SCHEMA && journal.id === id && journal.projectId === projectId
        && ['prepared', 'preparing', 'writing', 'files_written', 'interrupted', 'abandoned'].includes(journal.state)
        && Array.isArray(journal.entries) && journal.entries.length > 0 && journal.entries.length <= 2000,
      'invalid_transaction', '不能取消已提交或无效的归档事务。');
      await assertAuthorized(journal);
      if (journal.state === 'abandoned') return { ok: true, transactionId: id, abandoned: true };
      // Only an entirely unwritten/rolled-back operation can be abandoned.
      // No target is deleted or rewritten, even if its current bytes conflict.
      const seen = new Set(); let total = 0;
      for (const [i, entry] of journal.entries.entries()) {
        targetRoot(entry.path); invariant(!seen.has(key(entry.path)), 'invalid_transaction', '归档目标重复。'); seen.add(key(entry.path));
        invariant(entry.before === `${i}.before`, 'invalid_transaction', '归档前像位置无效。');
        if (entry.beforeHash !== null) {
          const bytes = readBytes(await safePath(paths.folder, entry.before)); total += bytes.length;
          invariant(total <= TOTAL_LIMIT && sha(bytes) === entry.beforeHash, 'transaction_corrupt', '归档前像损坏。');
        }
        let current = null;
        try { current = sha(readBytes(entry.path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        invariant(current === entry.beforeHash, 'recovery_conflict', '已有目标发生变化或写入尚未回滚，不能取消；保留全部文件。');
      }
      journal.abandonedAt = new Date().toISOString();
      await save(paths, journal, 'abandoned');
      return { ok: true, transactionId: id, abandoned: true };
    }));
  }
  return { begin, pending, resume, abandon };
}

module.exports = { createProjectArchiveTransactions, SCHEMA };
