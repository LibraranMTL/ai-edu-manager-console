'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function resolveCanvasRuntime(resourcesPath = process.resourcesPath) {
  const root = typeof resourcesPath === 'string' && resourcesPath.trim() ? path.resolve(resourcesPath) : '';
  const packaged = root ? path.join(root, 'material-pdf-runtime', 'canvas') : '';
  if (packaged && fs.existsSync(path.join(packaged, 'package.json'))) return packaged;
  return require.resolve('@napi-rs/canvas');
}

const { createCanvas } = require(resolveCanvasRuntime());
const { createLearningStateStore, learningStatePath } = require('./learning-state-store.cjs');

const WIDTH = 1080;
const HEIGHT = 1920;
const MAX_PNG_BYTES = 12 * 1024 * 1024;

function currentTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}

function readExistingEvents(studentRootPath, studentId) {
  const file = path.join(studentRootPath, '.edu-manager', 'learning-analytics', 'learning-events.json');
  if (!fs.existsSync(file)) return null;
  const document = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (document.schema !== 'edu-manager.learning-event.v1' || String(document.studentId) !== String(studentId)
    || !Array.isArray(document.events) || document.events.some((event) => String(event.studentId) !== String(studentId))) {
    throw Object.assign(new Error('学习事件账本范围或格式无效。'), { code: 'event_ledger_scope_or_schema_invalid' });
  }
  return document.events;
}

function getWeeklyKnowledgeGrowth(options = {}) {
  const studentId = String(options.studentId || '').trim();
  if (!studentId || studentId === 'all') return { ok: false, code: 'student_scope_required', message: '请选择一名学生查看周图。' };
  if (!options.studentRootPath) return { ok: false, code: 'student_root_missing', message: '学生知识库范围不可用。' };
  if (!options.assetStore) return { ok: false, code: 'asset_store_unavailable', message: '资产统计暂不可用。' };
  const asOf = Number.isFinite(Date.parse(options.asOf || '')) ? new Date(options.asOf).toISOString() : new Date().toISOString();
  const timezone = String(options.timezone || currentTimezone());
  const ownsStore = !options.learningStore;
  const learningStore = options.learningStore || createLearningStateStore({ dbPath: learningStatePath(options.studentRootPath), now: options.now || Date.now });
  try {
    const events = readExistingEvents(options.studentRootPath, studentId);
    if (events) learningStore.reconcileEvents(studentId, events);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const assetBefore = options.assetStore.statisticsState();
      const knowledgeBefore = learningStore.state();
      const assetSnapshot = options.assetStore.statisticsSnapshot({ studentId });
      const growth = learningStore.weeklyGrowth({ studentId, asOf, timezone });
      const assetAfter = options.assetStore.statisticsState();
      const knowledgeAfter = learningStore.state();
      const consistent = Number(assetBefore.generation) === Number(assetAfter.generation)
        && Number(assetSnapshot.generation) === Number(assetAfter.generation)
        && Number(knowledgeBefore.generation) === Number(knowledgeAfter.generation)
        && Number(growth.generation) === Number(knowledgeAfter.generation);
      if (!consistent) continue;
      return {
        ok: true,
        schema: 'edu.weekly-knowledge-growth.v1',
        policyVersion: 'weekly-knowledge-growth.v1',
        studentId,
        asOf,
        timezone,
        currentDate: growth.currentDate,
        weekStart: growth.weekStart,
        weekEnd: growth.weekEnd,
        assetGeneration: Number(assetAfter.generation),
        knowledgeGeneration: Number(knowledgeAfter.generation),
        authorizationVersion: String(options.authorizationVersion || 'local-student-index.v1'),
        assetTotal: Number(assetSnapshot.total || 0),
        weeklyNewKnowledgePoints: Number(growth.weeklyNewKnowledgePoints || 0),
        unknownFirstSeenCount: Number(growth.unknownFirstSeenCount || 0),
        days: growth.days,
      };
    }
    return { ok: false, code: 'statistics_generation_changed', message: '统计期间数据发生变化，请重试。' };
  } catch (error) {
    return { ok: false, code: error.code || 'weekly_growth_failed', message: error.message || '每周知识增长统计失败。' };
  } finally {
    if (ownsStore) learningStore.close();
  }
}

function roundedRect(ctx, x, y, width, height, radius, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawCentered(ctx, value, x, y) {
  ctx.textAlign = 'center';
  ctx.fillText(String(value), x, y);
}

function renderWeeklyKnowledgeGrowthPng(snapshot) {
  if (!snapshot?.ok || !Array.isArray(snapshot.days) || snapshot.days.length !== 7) {
    throw Object.assign(new Error('周图快照无效。'), { code: 'weekly_growth_snapshot_invalid' });
  }
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f8f7';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const ink = '#17383f';
  const muted = '#607a7f';
  const green = '#1e8f78';
  const pale = '#e4f2ee';
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.font = '700 64px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  ctx.fillText('每周知识库新增', 76, 132);
  ctx.font = '400 30px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  ctx.fillStyle = muted;
  ctx.fillText(`${snapshot.weekStart} 至 ${snapshot.weekEnd}`, 78, 186);

  roundedRect(ctx, 64, 246, 452, 250, 30, '#ffffff');
  roundedRect(ctx, 540, 246, 476, 250, 30, '#ffffff');
  ctx.font = '500 29px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  ctx.fillStyle = muted;
  ctx.fillText('知识资产总量', 104, 312);
  ctx.fillText('本周新增知识点', 580, 312);
  ctx.fillStyle = ink;
  ctx.font = '700 86px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.fillText(String(snapshot.assetTotal), 104, 420);
  ctx.fillText(String(snapshot.weeklyNewKnowledgePoints), 580, 420);
  ctx.font = '500 28px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = muted;
  ctx.fillText('项', 360, 416);
  ctx.fillText('个', 838, 416);

  roundedRect(ctx, 64, 536, 952, 950, 34, '#ffffff');
  ctx.fillStyle = ink;
  ctx.font = '700 38px "Microsoft YaHei", sans-serif';
  ctx.fillText('本周首次可靠登记', 104, 612);
  const known = snapshot.days.filter((day) => day.count !== null).map((day) => Number(day.count || 0));
  const max = Math.max(1, ...known);
  const chartTop = 704;
  const chartBottom = 1324;
  const chartHeight = chartBottom - chartTop;
  const slot = 118;
  snapshot.days.forEach((day, index) => {
    const x = 118 + index * slot;
    const count = day.count;
    const barHeight = count === null ? 0 : Math.max(count === 0 ? 8 : 32, (Number(count) / max) * chartHeight);
    ctx.fillStyle = count === null ? '#edf1f0' : pale;
    ctx.fillRect(x, chartTop, 68, chartHeight);
    if (count !== null) {
      ctx.fillStyle = green;
      ctx.fillRect(x, chartBottom - barHeight, 68, barHeight);
    }
    ctx.font = '700 30px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = count === null ? '#9aabaa' : ink;
    drawCentered(ctx, count === null ? '—' : count, x + 34, chartBottom - barHeight - 22);
    ctx.font = '500 25px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = ink;
    drawCentered(ctx, day.label, x + 34, 1380);
    ctx.font = '400 21px "Segoe UI", sans-serif';
    ctx.fillStyle = muted;
    drawCentered(ctx, String(day.date).slice(5), x + 34, 1418);
  });

  roundedRect(ctx, 64, 1526, 952, 300, 30, '#e7f1ef');
  ctx.textAlign = 'left';
  ctx.fillStyle = ink;
  ctx.font = '600 31px "Microsoft YaHei", sans-serif';
  ctx.fillText(`截至 ${snapshot.currentDate || snapshot.asOf.slice(0, 10)} · ${snapshot.timezone}`, 104, 1600);
  ctx.font = '400 29px "Microsoft YaHei", sans-serif';
  ctx.fillText('新增按知识点首次可靠登记统计，', 104, 1670);
  ctx.fillText('不代表掌握度、能力或学习效果变化。', 104, 1718);
  if (Number(snapshot.unknownFirstSeenCount) > 0) {
    ctx.font = '400 25px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = muted;
    ctx.fillText(`另有 ${snapshot.unknownFirstSeenCount} 个知识点首次日期不明，未计入趋势。`, 104, 1772);
  }
  const bytes = canvas.toBuffer('image/png');
  ctx.reset();
  canvas.width = 1;
  canvas.height = 1;
  if (!bytes.length || bytes.length > MAX_PNG_BYTES) throw Object.assign(new Error('生成的周图大小异常。'), { code: 'weekly_growth_png_size_invalid' });
  return bytes;
}

function createWeeklyKnowledgeGrowthImageCache({ maxEntries = 8 } = {}) {
  const entries = new Map();
  function put(snapshot, bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length <= 8 || bytes.length > MAX_PNG_BYTES
      || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw Object.assign(new Error('周图 PNG 字节无效。'), { code: 'weekly_growth_png_invalid' });
    }
    const snapshotId = crypto.createHash('sha256').update(bytes).digest('hex');
    const entry = {
      snapshotId,
      studentId: String(snapshot.studentId || ''),
      asOf: String(snapshot.asOf || ''),
      width: WIDTH,
      height: HEIGHT,
      fileName: `每周知识增长_${snapshot.weekStart}_${snapshot.weekEnd}.png`,
      bytes,
      previewBase64: bytes.toString('base64'),
    };
    entries.delete(snapshotId);
    entries.set(snapshotId, entry);
    while (entries.size > Math.max(1, Number(maxEntries) || 1)) entries.delete(entries.keys().next().value);
    return entry;
  }
  function create(snapshot) { return put(snapshot, renderWeeklyKnowledgeGrowthPng(snapshot)); }
  return {
    create,
    put,
    get(snapshotId) { return entries.get(String(snapshotId || '')) || null; },
    delete(snapshotId) { return entries.delete(String(snapshotId || '')); },
    clear() { entries.clear(); },
  };
}

module.exports = {
  HEIGHT, MAX_PNG_BYTES, WIDTH, createWeeklyKnowledgeGrowthImageCache, currentTimezone,
  getWeeklyKnowledgeGrowth, renderWeeklyKnowledgeGrowthPng, resolveCanvasRuntime,
};
