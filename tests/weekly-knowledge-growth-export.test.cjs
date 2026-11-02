'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const { createWeeklyKnowledgeGrowthImageCache } = require('../electron/weekly-knowledge-growth.cjs');

const snapshot = {
  ok: true,
  schema: 'edu.weekly-knowledge-growth.v1',
  studentId: 'private-student-id',
  asOf: '2026-11-04T04:00:00.000Z',
  timezone: 'Asia/Shanghai',
  weekStart: '2026-11-02',
  weekEnd: '2026-11-08',
  assetTotal: 128,
  registeredKnowledgePointTotal: 15,
  weeklyNewKnowledgePoints: 3,
  unknownFirstSeenCount: 1,
  days: [
    { date: '2026-11-02', label: '周一', count: 2 },
    { date: '2026-11-03', label: '周二', count: 0 },
    { date: '2026-11-04', label: '周三', count: 1 },
    { date: '2026-11-05', label: '周四', count: null },
    { date: '2026-11-06', label: '周五', count: null },
    { date: '2026-11-07', label: '周六', count: null },
    { date: '2026-11-08', label: '周日', count: null },
  ],
};

test('weekly PNG is 1080x1920, deidentified, and preview/save reuse the same bytes', () => {
  const cache = createWeeklyKnowledgeGrowthImageCache({ maxEntries: 2 });
  const image = cache.create(snapshot);
  assert.equal(image.width, 1080);
  assert.equal(image.height, 1920);
  assert.equal(image.bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(image.bytes.readUInt32BE(16), 1080);
  assert.equal(image.bytes.readUInt32BE(20), 1920);
  assert.equal(image.previewBase64, image.bytes.toString('base64'));
  assert.equal(cache.get(image.snapshotId).bytes, image.bytes);
  assert.equal(
    crypto.createHash('sha256').update(Buffer.from(image.previewBase64, 'base64')).digest('hex'),
    crypto.createHash('sha256').update(cache.get(image.snapshotId).bytes).digest('hex'),
  );
  const pngText = image.bytes.toString('latin1');
  assert.equal(pngText.includes(snapshot.studentId), false);
  assert.equal(pngText.includes('D:\\private'), false);
  assert.match(image.fileName, /^每周知识增长_2026-11-02_2026-11-08\.png$/);
  assert.equal(cache.get('missing'), null);
});

test('Windows bridge and asset card expose scoped load, stale invalidation, and explicit save only', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'WeeklyKnowledgeGrowthCard.tsx'), 'utf8');
  assert.match(main, /bridge:getWeeklyKnowledgeGrowth/);
  assert.match(main, /bridge:saveWeeklyKnowledgeGrowthPng/);
  assert.match(main, /weekly_growth_scope_changed/);
  assert.match(preload, /invalidateWeeklyKnowledgeGrowth/);
  assert.match(ui, /请选择一名学生查看周图/);
  assert.match(ui, /不代表掌握度、能力或学习效果变化/);
  assert.match(ui, /保存 1080×1920 PNG/);
  assert.match(ui, /文件资产/);
  assert.match(ui, /weekly-knowledge-growth-report-actions/);
  assert.doesNotMatch(ui, /weekly-knowledge-growth-summary/);
  assert.doesNotMatch(ui, /自动发送|朋友圈接口|调用 Agent/);
});

test('weekly statistics and PNG encoding complete in a background worker', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-weekly-worker-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const worker = new Worker(path.join(__dirname, '..', 'electron', 'weekly-knowledge-growth-worker.cjs'), { workerData: {
    studentId: 'student-worker', studentRootPath: root,
    assetSnapshot: { generation: 4, changedAt: '2026-11-04T02:00:00.000Z', total: 12 },
    asOf: '2026-11-04T04:00:00.000Z', timezone: 'Asia/Shanghai', authorizationVersion: 'test-v1',
  } });
  const result = await new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.assetTotal, 12);
  assert.equal(Buffer.from(result.pngBase64, 'base64').readUInt32BE(16), 1080);
});
