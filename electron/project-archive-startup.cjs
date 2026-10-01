const fs = require('node:fs/promises');
const path = require('node:path');
const { invariant, identifier } = require('./project-material-contract.cjs');
const { writeJsonAtomic, withCommitLock } = require('./project-materials.cjs');
const { SCHEMA } = require('./project-archive-transaction.cjs');

const CATALOG_SCHEMA = 'edu-manager.archive-recovery-catalog.v1';
const ID = /^archive-tx-[a-f0-9-]{36}$/;
const LIMIT = 2000;
async function checkPath(file) {
  invariant(path.isAbsolute(file || ''), 'invalid_path', '恢复路径必须是绝对路径。');
  let current = path.resolve(file);
  for (;;) {
    try { invariant(!(await fs.lstat(current)).isSymbolicLink(), 'linked_path', '恢复路径包含链接。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
async function readJson(file, missing) {
  await checkPath(file);
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const before = await handle.stat();
    invariant(before.isFile() && before.size <= 64 * 1024 * 1024, 'recovery_limit', '恢复登记超出读取范围。');
    const bytes = Buffer.alloc(before.size + 1); let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break; offset += bytesRead;
    }
    const after = await handle.stat(), named = await fs.stat(file);
    invariant(offset === before.size && ['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].every((field) => before[field] === after[field] && after[field] === named[field]),
      'recovery_conflict', '恢复登记在读取期间变化。');
    return JSON.parse(bytes.subarray(0, offset).toString('utf8'));
  } catch (error) { if (error.code === 'ENOENT' && missing !== undefined) return missing; throw error; }
  finally { await handle?.close(); }
}
function validateEntry(entry) {
  identifier(entry?.projectId, '项目ID');
  invariant(ID.test(entry.id || '') && path.isAbsolute(entry.directory || '')
    && path.basename(entry.directory) === 'archive-transactions'
    && path.basename(path.dirname(entry.directory)) === 'project-materials', 'invalid_transaction', '恢复登记位置无效。');
  return entry;
}
function createProjectArchiveStartup({ catalogPath, projectsPath, diagnosticPath, recover, abandon, reconcile = async () => {} }) {
  invariant(typeof recover === 'function', 'invalid_recovery', '启动恢复缺少执行适配器。');
  let state = { ready: false, phase: 'unchecked', recovered: [], abandoned: [], issues: [] };
  async function catalog() {
    const value = await readJson(catalogPath, { schema: CATALOG_SCHEMA, entries: [] });
    invariant(value.schema === CATALOG_SCHEMA && Array.isArray(value.entries) && value.entries.length <= LIMIT,
      'invalid_catalog', '恢复登记结构损坏，不能当作空登记继续启动。');
    const seen = new Set();
    for (const entry of value.entries) {
      validateEntry(entry); invariant(!seen.has(entry.id), 'invalid_catalog', '恢复事务重复。'); seen.add(entry.id);
    }
    return value;
  }
  async function saveCatalog(value) {
    await checkPath(catalogPath); await fs.mkdir(path.dirname(catalogPath), { recursive: true });
    await checkPath(catalogPath); await writeJsonAtomic(catalogPath, value);
  }
  async function register(entry) {
    validateEntry(entry);
    return withCommitLock(`archive-catalog:${path.resolve(catalogPath)}`, async () => {
      const value = await catalog(); const old = value.entries.find((item) => item.id === entry.id);
      invariant(!old || old.directory === entry.directory && old.projectId === entry.projectId, 'invalid_catalog', '恢复事务身份冲突。');
      if (!old) {
        invariant(value.entries.length < LIMIT, 'recovery_limit', '未结算恢复登记过多，停止新归档。');
        value.entries.push({ id: entry.id, directory: entry.directory, projectId: entry.projectId });
        await saveCatalog(value);
      }
    });
  }
  async function complete(id) {
    return withCommitLock(`archive-catalog:${path.resolve(catalogPath)}`, async () => {
      const value = await catalog(); const remaining = value.entries.filter((entry) => entry.id !== id);
      if (remaining.length !== value.entries.length) await saveCatalog({ ...value, entries: remaining });
    });
  }
  async function inspect(entry) {
    validateEntry(entry);
    const journal = await readJson(path.join(entry.directory, entry.id, 'journal.json'));
    invariant(journal.schema === SCHEMA && journal.id === entry.id && journal.projectId === entry.projectId
      && ['staging', 'prepared', 'preparing', 'writing', 'files_written', 'interrupted', 'committed', 'abandoned'].includes(journal.state),
    'invalid_transaction', '已登记事务缺失或结构损坏，必须核对恢复现场。');
    return journal;
  }
  async function initialize({ abandonUnwritten = false } = {}) {
    state = { ready: false, phase: 'checking', recovered: [], abandoned: [], issues: [] };
    const issue = (error, entry) => state.issues.push({ code: error.code || 'archive_recovery_failed', message: error.message,
      ...(entry ? { transactionId: entry.id, projectId: entry.projectId, journalPath: path.join(entry.directory, entry.id, 'journal.json') } : {}) });
    try {
      const value = await catalog();
      // Compatibility discovery reads only known new-mode project transaction
      // directories. It does not recursively scan workspaces or source bytes.
      // A broken project index is NOT treated as an empty list.
      let projectsError;
      try {
        const stored = await readJson(projectsPath, []);
        const projects = Array.isArray(stored) ? stored : stored.projects;
        invariant(Array.isArray(projects), 'invalid_projects', '项目索引结构损坏。');
        for (const project of projects.filter((item) => item.materialStorageMode === 'workspace-v1')) {
          invariant(path.isAbsolute(project.managerPath || ''), 'invalid_path', '项目缺少有效管理目录。');
          const directory = path.join(project.managerPath, 'project-materials', 'archive-transactions');
          await checkPath(directory);
          let names; try { names = await fs.readdir(directory); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
          invariant(names.length <= 10000, 'recovery_limit', '事务目录数量超限，请先核对保留策略。');
          for (const id of names.filter((name) => ID.test(name))) {
            if (value.entries.some((entry) => entry.id === id)) continue;
            const entry = { id, directory, projectId: project.id };
            let journal;
            try { journal = await inspect(entry); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
            if (['committed', 'staging', 'abandoned'].includes(journal.state)) continue;
            await register(entry); value.entries.push(entry);
          }
        }
      } catch (error) { projectsError = error; }
      for (const entry of value.entries) {
        try {
          let journal = await inspect(entry);
          invariant(journal.state !== 'staging', 'invalid_transaction', '登记事务尚未完成准备，不能启动写入。');
          if (!['committed', 'abandoned'].includes(journal.state)) {
            invariant(!abandonUnwritten || typeof abandon === 'function', 'invalid_recovery', '当前主机未提供受控取消操作。');
            const result = await (abandonUnwritten ? abandon(entry, journal) : recover(entry, journal));
            invariant(result?.ok, result?.code || 'archive_recovery_failed', result?.message || '事务未恢复。');
            journal = await inspect(entry);
            invariant(journal.state === (abandonUnwritten ? 'abandoned' : 'committed'), 'archive_recovery_failed', '恢复没有产生对应持久回执。');
          }
          await reconcile(entry, journal);
          await complete(entry.id);
          (journal.state === 'abandoned' ? state.abandoned : state.recovered).push(entry.id);
        } catch (error) { issue(error, entry); }
      }
      // Recovery can repair a known index only through the authorized adapter.
      // Re-read it before exposing the application, even if no journal existed.
      try {
        const stored = await readJson(projectsPath, []);
        invariant(Array.isArray(stored) || Array.isArray(stored.projects), 'invalid_projects', '项目索引结构损坏。');
      } catch (error) { issue(error); }
      if (projectsError) issue(projectsError);
    } catch (error) { issue(error); }
    state.ready = state.issues.length === 0; state.phase = state.ready ? 'ready' : 'blocked';
    if (!state.ready) {
      try { await checkPath(diagnosticPath); await fs.mkdir(path.dirname(diagnosticPath), { recursive: true }); await writeJsonAtomic(diagnosticPath, state); }
      catch (error) { state.issues.push({ code: 'diagnostic_write_failed', message: error.message }); }
    }
    return structuredClone(state);
  }
  return { register, complete, initialize, status: () => structuredClone(state), diagnosticPath };
}
module.exports = { createProjectArchiveStartup, CATALOG_SCHEMA };
