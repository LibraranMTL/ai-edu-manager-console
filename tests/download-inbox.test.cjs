'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createDownloadInbox, MAX_BYTES } = require('../electron/download-inbox.cjs');
const { hashStableFile } = require('../electron/project-materials.cjs');
async function setup(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-download-'));
  const folder = path.join(root, 'downloads'), targets = path.join(root, 'targets'), dataDir = path.join(root, 'host/download-inbox');
  await fs.mkdir(folder); await fs.mkdir(targets);
  let deliveries = 0, recycled = [];
  const deliver = async (snapshot, context, operation, checkpoint) => {
    deliveries++;
    const destination = operation.destinationPath || path.join(targets, `${operation.operationId}-${operation.name}`);
    await checkpoint({ destinationPath: destination });
    try { await fs.copyFile(snapshot, destination, require('node:fs').constants.COPYFILE_EXCL); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    return { ok: true, path: destination, recordId: operation.operationId };
  };
  const validateTarget = async target => {
    if (!['a', 'b'].includes(target?.studentId) || !['student', 'project'].includes(target?.type) || (target.type === 'project' && target.id !== `${target.studentId}-project`)) throw Error('学生或项目无权访问');
    return { targetName: target.studentId + ':' + (target.id || 'raw') };
  };
  const create = overrides => createDownloadInbox({ dataDir, forbiddenRoots: () => [targets, path.join(root, 'system')], stableAgeMs: 0,
    validateTarget, deliver, trash: async file => { recycled.push(file); await fs.rename(file, path.join(targets, 'recycled-' + path.basename(file))); }, ...options, ...overrides });
  const api = create(); await api.configure(folder);
  const put = async (name = '资料.docx', text = 'sample') => { const file = path.join(folder, name); await fs.writeFile(file, text); return file; };
  return { root, folder, targets, dataDir, api, create, put, count: () => deliveries, recycled,
    close: () => fs.rm(root, { recursive: true, force: true }) };
}
const destination = { studentId: 'a', type: 'student' };
test('download folder persists; list is metadata-only; disconnect/change never move originals', async () => {
  const t = await setup(); try {
    const source = await t.put(); const before = await fs.stat(source);
    const list = await t.api.list(); assert.equal(list.files[0].status, 'pending');
    assert.equal((await fs.stat(source)).mtimeMs, before.mtimeMs); assert.equal(await fs.readFile(source, 'utf8'), 'sample'); assert.equal(t.count(), 0);
    assert.equal((await t.create().getSettings()).folder, t.folder);
    await t.api.configure(''); assert.equal((await t.api.list()).files.length, 0); assert.equal(await fs.readFile(source, 'utf8'), 'sample');
    await t.api.configure(t.folder); const alternate = path.join(t.root, 'another'); await fs.mkdir(alternate); await t.api.configure(alternate);
    assert.equal(await fs.readFile(source, 'utf8'), 'sample');
  } finally { await t.close(); }
});
test('ordinary files only; temporary, locked-file names, directories, oversize and unsupported are safe', async () => {
  const t = await setup(); try {
    await t.put('资料.pdf'); await t.put('file.exe'); await t.put('download.pdf.crdownload'); await t.put('~$WPS.docx'); await fs.mkdir(path.join(t.folder, 'nested')); await fs.writeFile(path.join(t.folder, 'empty.txt'), '');
    const big = await fs.open(path.join(t.folder, 'large.pdf'), 'w'); await big.truncate(MAX_BYTES + 1); await big.close();
    const files = (await t.api.list()).files; assert.equal(files.length, 4); assert.equal(files.filter(file => file.supported).length, 1);
    assert.equal((await t.api.deliver([files.find(file => file.name === 'large.pdf').fileId], destination)).results[0].ok, false); assert.equal(t.count(), 0);
  } finally { await t.close(); }
});
test('delivery verifies registered copy, archives original name, and double-clicks do not duplicate', async () => {
  const t = await setup(); try {
    const source = await t.put(); const id = (await t.api.list()).files[0].fileId;
    const results = await Promise.all([t.api.deliver([id], destination), t.api.deliver([id], destination)]);
    assert.ok(results.every(value => value.results[0].ok)); assert.equal(t.count(), 1);
    await assert.rejects(fs.stat(source), { code: 'ENOENT' }); assert.equal(await fs.readFile(path.join(t.folder, '已投递/资料.docx'), 'utf8'), 'sample');
    assert.equal((await t.api.list()).files[0].status, 'delivered');
  } finally { await t.close(); }
});
test('invalid students, cross-student projects, paths and changed selections are rejected', async () => {
  const t = await setup(); try {
    const source = await t.put(), id = (await t.api.list()).files[0].fileId;
    await assert.rejects(t.api.deliver([id], { studentId: 'unknown', type: 'student' }));
    await assert.rejects(t.api.deliver([id], { studentId: 'b', type: 'project', id: 'a-project' }));
    assert.equal((await t.api.deliver(['../outside'], destination)).results[0].ok, false);
    await fs.writeFile(source, 'changed'); assert.equal((await t.api.deliver([id], destination)).results[0].ok, false); assert.equal(t.count(), 0);
  } finally { await t.close(); }
});
test('archive failure preserves original and target; restart retries only archive, not importer', async () => {
  const t = await setup({ hooks: { beforeArchive: () => { throw Error('模拟文件锁'); } } }); try {
    const source = await t.put(), id = (await t.api.list()).files[0].fileId;
    assert.equal((await t.api.deliver([id], destination)).results[0].status, 'archive_pending'); assert.equal(await fs.readFile(source, 'utf8'), 'sample');
    const restarted = t.create({ hooks: {} }); const current = (await restarted.list()).files[0]; assert.equal(current.status, 'archive_pending');
    assert.equal((await restarted.deliver([current.fileId], destination)).results[0].ok, true); assert.equal(t.count(), 1);
  } finally { await t.close(); }
});
test('bad receipts / target corruption never archive source; partial batches report each result', async () => {
  const t = await setup(); try {
    await t.put('a.txt'); await t.put('b.txt'); const bad = t.create({ deliver: async () => ({ ok: true, skipped: 1 }) });
    const files = (await bad.list()).files; const result = await bad.deliver(files.map(file => file.fileId), destination);
    assert.ok(result.results.every(item => !item.ok)); assert.equal((await fs.readdir(t.folder)).filter(name => name.endsWith('.txt')).length, 2);
    const good = t.create(); assert.equal((await good.deliver((await good.list()).files.map(file => file.fileId), destination)).results.filter(item => item.ok).length, 2);
  } finally { await t.close(); }
});
test('project target and name conflict archive without overwriting prior file', async () => {
  const t = await setup(); try {
    await fs.mkdir(path.join(t.folder, '已投递')); await fs.writeFile(path.join(t.folder, '已投递/资料.docx'), 'older'); await t.put();
    const id = (await t.api.list()).files[0].fileId;
    const result = (await t.api.deliver([id], { studentId: 'a', type: 'project', id: 'a-project' })).results[0];
    assert.equal(result.ok, true); assert.equal(await fs.readFile(path.join(t.folder, '已投递/资料.docx'), 'utf8'), 'older'); assert.equal(await fs.readFile(result.archivePath, 'utf8'), 'sample');
  } finally { await t.close(); }
});
test('restart with lost archive receipt reconciles archived file without redelivering', async () => {
  const t = await setup(); try {
    await t.put(); const id = (await t.api.list()).files[0].fileId; await t.api.deliver([id], destination);
    const ledgerFile = path.join(t.dataDir, 'operations.json'), value = JSON.parse(await fs.readFile(ledgerFile, 'utf8'));
    value.operations[0].status = 'archive_pending'; await fs.writeFile(ledgerFile, JSON.stringify(value));
    const restarted = t.create(), recovery = (await restarted.list()).files[0]; assert.equal(recovery.status, 'archive_pending');
    assert.equal((await restarted.deliver([recovery.fileId], destination)).results[0].ok, true); assert.equal(t.count(), 1);
  } finally { await t.close(); }
});
test('trash requires confirmation; uses injected system recycle only, not target deletion', async () => {
  const t = await setup(); try {
    await t.put(); const id = (await t.api.list()).files[0].fileId;
    await assert.rejects(t.api.trash([id], false)); assert.equal(t.recycled.length, 0);
    assert.equal((await t.api.trash([id], true)).results[0].ok, true); assert.equal(t.recycled.length, 1);
    await t.put('unsupported.exe'); const file = (await t.api.list()).files[0]; assert.equal((await t.api.trash([file.fileId], true)).results[0].ok, true);
  } finally { await t.close(); }
});
test('root, managed directories, ancestors and symbolic sources are rejected', async () => {
  const t = await setup(); try {
    await assert.rejects(t.api.configure(path.parse(t.folder).root)); await assert.rejects(t.api.configure(t.targets)); await assert.rejects(t.api.configure(t.root));
    await t.put('safe.txt');
    try { await fs.symlink(t.targets, path.join(t.folder, 'linked'), 'junction'); assert.equal((await t.api.list()).files.length, 1); await assert.rejects(t.api.configure(path.join(t.folder, 'linked'))); }
    catch (error) { if (error.code !== 'EPERM') throw error; }
  } finally { await t.close(); }
});
test('still-writing file and changed-before-archive file keep source', async () => {
  const t = await setup(); try {
    const source = await t.put(); const slow = t.create({ stableAgeMs: 60000 }); assert.equal((await slow.list()).files.length, 0);
    const changing = t.create({ hooks: { beforeArchive: async () => fs.writeFile(source, 'new bytes') } });
    const id = (await changing.list()).files[0].fileId; const result = (await changing.deliver([id], destination)).results[0]; assert.equal(result.status, 'archive_pending');
    assert.equal(await fs.readFile(source, 'utf8'), 'new bytes'); assert.equal(t.count(), 1);
  } finally { await t.close(); }
});
test('changing a pending operation target does not change its journal or duplicate destination', async () => {
  const t = await setup({ hooks: { beforeArchive: () => { throw Error('held'); } } }); try {
    await t.put(); const id = (await t.api.list()).files[0].fileId; await t.api.deliver([id], destination);
    const value = await fs.readFile(path.join(t.dataDir, 'operations.json'), 'utf8');
    assert.equal((await t.api.deliver([id], { studentId: 'b', type: 'student' })).results[0].ok, false);
    assert.equal(await fs.readFile(path.join(t.dataDir, 'operations.json'), 'utf8'), value); assert.equal(t.count(), 1);
  } finally { await t.close(); }
});
test('recovery after importer completion but before receipt write uses stable operation and snapshot', async () => {
  const t = await setup(); try {
    await t.put(); let operationId, targetPath;
    const interrupted = t.create({ deliver: async (snapshot, context, operation, checkpoint) => {
      operationId = operation.operationId; targetPath = path.join(t.targets, 'registered.txt'); await checkpoint({ destinationPath: targetPath });
      await fs.copyFile(snapshot, targetPath); throw Error('simulated lost reply');
    } });
    await interrupted.deliver([(await interrupted.list()).files[0].fileId], destination);
    const recovered = t.create({ deliver: async (snapshot, context, operation) => {
      assert.equal(operation.operationId, operationId); assert.equal(operation.destinationPath, targetPath);
      assert.equal((await hashStableFile(snapshot)).sha256, (await hashStableFile(targetPath)).sha256);
      return { ok: true, recordId: operationId, path: targetPath };
    } });
    assert.equal((await recovered.deliver([(await recovered.list()).files[0].fileId], destination)).results[0].ok, true);
    assert.equal((await fs.readdir(t.targets)).length, 1);
  } finally { await t.close(); }
});
test('partial delivery and wrong content receipts leave only failed sources pending', async () => {
  const t = await setup(); try {
    await t.put('good.txt'); await t.put('bad.txt');
    const api = t.create({ deliver: async (snapshot, context, operation) => {
      const file = path.join(t.targets, operation.name); await fs.copyFile(snapshot, file);
      if (operation.name === 'bad.txt') await fs.writeFile(file, 'corrupt');
      return { ok: true, recordId: operation.operationId, path: file };
    } });
    const value = await api.deliver((await api.list()).files.map(file => file.fileId), destination);
    assert.equal(value.results.filter(item => item.ok).length, 1); assert.equal(await fs.readFile(path.join(t.folder, 'bad.txt'), 'utf8'), 'sample');
  } finally { await t.close(); }
});
test('switching configured folder invalidates file ids and cannot touch old directory', async () => {
  const t = await setup(); try {
    const source = await t.put(), id = (await t.api.list()).files[0].fileId, other = path.join(t.root, 'other'); await fs.mkdir(other); await t.api.configure(other);
    assert.equal((await t.api.deliver([id], destination)).results[0].ok, false); assert.equal((await t.api.trash([id], true)).results[0].ok, false);
    assert.equal(await fs.readFile(source, 'utf8'), 'sample');
  } finally { await t.close(); }
});
test('old completed selection cannot consume a newly saved file with the same name', async () => {
  const t = await setup(); try {
    await t.put(); const id = (await t.api.list()).files[0].fileId; await t.api.deliver([id], destination);
    const source = await t.put('资料.docx', 'new download');
    assert.equal((await t.api.deliver([id], destination)).results[0].duplicate, true);
    assert.equal(await fs.readFile(source, 'utf8'), 'new download'); assert.equal(t.count(), 1);
    assert.equal((await t.api.list()).files.filter(file => file.status === 'pending').length, 1);
  } finally { await t.close(); }
});
