'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCaptureInbox } = require('../electron/capture-inbox.cjs');
test('capture reception is student-scoped, event-idempotent, hash-checked and trash never removes original', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-inbox-'));
  let deliveries = 0;
  const create = () => createCaptureInbox({ resolveStudentDir: async id => { if (!['a', 'b'].includes(id)) throw Error('student invalid'); return path.join(root, id); }, deliver: async () => { deliveries++; return { ok: true, assetId: 'accepted' }; } });
  let api = create();
  try {
    const input = { name: '机器人.md', sourceChannel: 'share', sourceEventId: 'event1', bytes: Buffer.from('原始资料') };
    const received = await api.receive('a', input);
    assert.equal((await api.receive('a', input)).duplicate, true); assert.deepEqual(await api.list('b'), []);
    assert.equal((await api.change('b', [received.item.itemId], 'deliver', {})).results[0].ok, false);
    await api.change('a', [received.item.itemId], 'deliver', {}); await api.change('a', [received.item.itemId], 'deliver', {}); assert.equal(deliveries, 1);
    await api.change('a', [received.item.itemId], 'trash'); api = create(); assert.equal((await api.list('a'))[0].status, 'trashed');
    const original = path.join(root, 'a/capture-inbox/objects', received.item.controlledObjectId); assert.equal(await fs.readFile(original, 'utf8'), '原始资料');
    await api.change('a', [received.item.itemId], 'restore'); assert.equal((await api.list('a'))[0].status, 'delivered');
    const second = await api.receive('a', { ...input, sourceEventId: 'event2' }); await fs.writeFile(path.join(root, 'a/capture-inbox/objects', second.item.controlledObjectId), 'tampered');
    assert.equal((await api.change('a', [second.item.itemId], 'deliver', {})).results[0].ok, false); assert.equal(deliveries, 1);
    await assert.rejects(api.receive('../x', input)); await assert.rejects(api.receive('a', { ...input, name: 'evil.exe' }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
