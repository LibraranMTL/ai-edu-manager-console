'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 20 * 1024 * 1024;
const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.wav', '.mp3', '.m4a', '.ogg', '.webm', '.mp4', '.pdf', '.docx', '.txt', '.md']);
function createCaptureInbox({ resolveStudentDir, deliver }) {
  const queues = new Map();
  const scanStatus = new Map();
  async function scope(id) {
    const root = path.join(await resolveStudentDir(id), 'capture-inbox');
    await fs.mkdir(root, { recursive: true });
    if ((await fs.lstat(root)).isSymbolicLink()) throw Error('收件箱目录不能使用符号链接');
    for (const name of ['objects', 'incoming', 'received']) {
      const dir = path.join(root, name);
      await fs.mkdir(dir, { recursive: true });
      if ((await fs.lstat(dir)).isSymbolicLink()) throw Error('收件箱目录不能使用符号链接');
    }
    return root;
  }
  async function store(root) {
    try { const file = path.join(root, 'index.json'); if ((await fs.lstat(file)).isSymbolicLink()) throw Error('收件箱索引不能使用符号链接'); return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { schema: 'CaptureInboxItem.v1', items: [] }; throw error; }
  }
  async function save(root, value) {
    const temp = path.join(root, `${crypto.randomUUID()}.tmp`);
    try { await fs.writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await fs.rename(temp, path.join(root, 'index.json')); }
    finally { await fs.rm(temp, { force: true }); }
  }
  function mutate(id, work) {
    const promise = (queues.get(id) || Promise.resolve()).catch(() => {}).then(async () => { const root = await scope(id); return work(root, await store(root)); });
    queues.set(id, promise); promise.finally(() => { if (queues.get(id) === promise) queues.delete(id); }).catch(() => {}); return promise;
  }
  async function receiveInto(id, input, root, value) {
      const name = path.basename(String(input.name || '').replace(/\\/g, '/')).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 120);
      const ext = path.extname(name).toLowerCase();
      if (!name || !allowed.has(ext)) throw Error('收件箱不支持该文件类型');
      if (!['photo', 'audio', 'share', 'student_web', 'auto_folder', 'android_share'].includes(input.sourceChannel)) throw Error('来源渠道无效');
      const bytes = input.bytes;
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw Error('单项资料须为 1 字节至 20 MiB');
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const event = String(input.sourceEventId || '').slice(0, 100), device = String(input.sourceDeviceId || 'windows-host').slice(0, 100);
      const duplicate = value.items.find(item => event && item.sourceEventId === event && item.sourceDeviceId === device && item.sha256 === sha256);
      if (duplicate) return { item: duplicate, duplicate: true };
      const itemId = crypto.randomUUID(), controlledObjectId = itemId + ext;
      await fs.writeFile(path.join(root, 'objects', controlledObjectId), bytes, { flag: 'wx', mode: 0o600 });
      const item = { itemId, studentId: String(id), sourceChannel: input.sourceChannel, sourceEventId: event, sourceDeviceId: device,
        receivedAt: new Date().toISOString(), originalName: name, byteSize: bytes.length, sha256, controlledObjectId, status: 'ready', revision: 1, selectedTarget: null, lastReceiptId: '', lastError: '' };
      value.items.unshift(item); await save(root, value); return { item, duplicate: false };
  }
  async function scanIncoming(id, root, value) {
    const incoming = path.join(root, 'incoming'), skipped = [];
    let received = 0;
    // Only the current student's explicit drop directory, bounded and nonrecursive.
    const entries = (await fs.readdir(incoming, { withFileTypes: true })).slice(0, 100);
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) { skipped.push({ filename: entry.name, reason: '仅接收普通文件，不递归读取目录或链接' }); continue; }
      const file = path.join(incoming, entry.name);
      try {
        if (!allowed.has(path.extname(entry.name).toLowerCase())) throw Error('文件类型不支持');
        const before = await fs.lstat(file);
        if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_BYTES || !before.size) throw Error('文件类型或大小无效');
        const bytes = await fs.readFile(file), after = await fs.lstat(file);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error('资料仍在写入，请稍后刷新');
        const eventId = crypto.createHash('sha256').update(entry.name).update(bytes).digest('hex');
        const result = await receiveInto(id, { name: entry.name, sourceChannel: 'auto_folder', sourceEventId: eventId, bytes }, root, value);
        const latest = await fs.lstat(file);
        if (latest.size !== after.size || latest.mtimeMs !== after.mtimeMs) throw Error('资料在接收期间变化，保留目录中的原件');
        // Move only this validated file; keep a recoverable directory copy as well
        // as the immutable controlled object. Never overwrite a prior receipt.
        const archived = path.join(root, 'received', `${crypto.randomUUID()}${path.extname(entry.name)}`);
        await fs.rename(file, archived);
        if (!result.duplicate) received++;
      } catch (error) { skipped.push({ filename: entry.name, reason: error.message }); }
    }
    scanStatus.set(String(id), { received, skipped, checkedAt: new Date().toISOString() });
  }
  return {
    info: async id => {
      const root = await scope(id);
      return { incomingPath: path.join(root, 'incoming'), registeredPath: path.join(root, 'objects'), receivedPath: path.join(root, 'received'), ...(scanStatus.get(String(id)) || { skipped: [] }) };
    },
    list: id => mutate(id, async (root, value) => {
      await scanIncoming(id, root, value);
      return value.items.filter(item => item.studentId === String(id)).map(({ controlledObjectId, ...item }) => item);
    }),
    receive: (id, input) => mutate(id, (root, value) => receiveInto(id, input, root, value)),
    transcribe: (id, itemId, engine, consent) => mutate(id, async (root, value) => {
      const item = value.items.find(item => item.itemId === itemId && item.studentId === String(id));
      if (!item || item.sourceChannel !== 'audio' || item.status === 'trashed' || !['.webm', '.wav', '.mp3', '.m4a', '.ogg', '.mp4'].includes(path.extname(item.originalName).toLowerCase())) throw Error('请选当前学生未回收的录音原件');
      const sourceEventId = 'transcript:' + crypto.createHash('sha256').update(item.itemId + ':' + item.sha256).digest('hex');
      const existing = value.items.find(item => item.sourceEventId === sourceEventId);
      if (existing) return { itemId: existing.itemId, duplicate: true, message: '此音频已有转写副本，未重复调用引擎；可在录音列表查看并投递。' };
      const object = path.join(root, 'objects', item.controlledObjectId);
      if (path.dirname(object) !== path.join(root, 'objects') || (await fs.lstat(object)).isSymbolicLink()) throw Error('录音原件范围无效');
      const objectStat = await fs.stat(object); if (!objectStat.isFile() || objectStat.size > MAX_BYTES || !objectStat.size) throw Error('录音原件大小无效');
      const bytes = await fs.readFile(object);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw Error('录音原件哈希校验失败');
      const result = await engine.transcribe({ bytes, filename: item.originalName, consent });
      const content = `---\nstudent_id: ${JSON.stringify(String(id))}\nsource_item_id: ${item.itemId}\nsource_sha256: ${item.sha256}\nstatus: pending_review\nevidence_status: machine_observed\nengine: ${JSON.stringify(result.mode)}\nmodel: ${JSON.stringify(result.model)}\n---\n\n# 录音转写（待人工校核）\n\n此文本为机器转写，不代表学生能力或已确认成长证据。\n\n${result.text}\n`;
      const saved = await receiveInto(id, { name: `${path.parse(item.originalName).name.slice(0, 100)}.转写.md`, bytes: Buffer.from(content), sourceChannel: 'audio', sourceEventId }, root, value);
      return { itemId: saved.item.itemId, duplicate: false, message: '已保存待人工校核的转写副本；未自动投递或形成成长结论。' };
    }),
    change: (id, itemIds, action, target) => mutate(id, async (root, value) => {
      if (!Array.isArray(itemIds) || itemIds.length > 100 || !['deliver', 'trash', 'restore'].includes(action)) throw Error('批量操作无效');
      const results = [];
      for (const itemId of [...new Set(itemIds)]) {
        const item = value.items.find(item => item.itemId === itemId && item.studentId === String(id));
        if (!item) { results.push({ itemId, ok: false, message: '资料不存在或不属于当前学生' }); continue; }
        try {
          if (action === 'trash') { if (item.status !== 'trashed') { item.previousStatus = item.status; item.status = 'trashed'; } }
          else if (action === 'restore') { if (item.status === 'trashed') item.status = item.previousStatus === 'delivered' ? 'delivered' : 'ready'; }
          else {
            if (item.status === 'trashed') throw Error('请先恢复资料');
            if (item.status === 'delivered') { results.push({ itemId, ok: true, duplicate: true }); continue; }
            const object = path.join(root, 'objects', item.controlledObjectId);
            if (path.dirname(object) !== path.join(root, 'objects') || (await fs.lstat(object)).isSymbolicLink()) throw Error('原件范围无效');
            const bytes = await fs.readFile(object);
            if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw Error('原件哈希校验失败');
            item.status = 'delivering'; item.selectedTarget = target; await save(root, value);
            // Existing importer deduplicates by bytes and registers raw/project materials.
            const receipt = await deliver(id, object, target, item);
            if (!receipt.ok) throw Error(receipt.message || '投递失败');
            item.status = 'delivered'; item.lastReceiptId = `${item.itemId}:${item.sha256}`; item.receipt = receipt; item.lastError = '';
          }
          item.revision++; results.push({ itemId, ok: true, status: item.status });
        } catch (error) { item.status = 'failed_retryable'; item.lastError = error.message; results.push({ itemId, ok: false, message: error.message }); }
        await save(root, value);
      }
      return { results };
    }),
  };
}
module.exports = { createCaptureInbox, MAX_BYTES };
