const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  appendCaptureItem,
  captureEventFromSessionItem,
  deleteSessionEvents,
  listDates,
  queryTimeline,
  rebuildSessionTimeline,
  thumbnailPath,
} = require('../electron/capture-timeline.cjs');

test('capture timeline stores immutable facts by student and local date', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-capture-timeline-'));
  const session = {
    id: 'session-1',
    studentId: 'student-1',
    studentName: '赵同学',
    sourceName: '课程窗口',
    sourceType: 'window',
    platform: 'windows',
  };
  const first = { id: 'item-1', path: path.join(root, 'one.png'), filename: 'one.png', capturedAt: '2026-09-10T04:00:00.000Z', reason: 'manual', archiveStatus: 'candidate' };
  const second = { id: 'item-2', path: path.join(root, 'two.png'), filename: 'two.png', capturedAt: '2026-09-10T04:01:00.000Z', reason: 'highlight', isHighlighted: true, archiveStatus: 'candidate' };
  try {
    assert.equal(appendCaptureItem(root, session, first).appended, true);
    assert.equal(appendCaptureItem(root, session, first).appended, false, '同一事件重试不得重复写入');
    assert.deepEqual(rebuildSessionTimeline(root, { ...session, items: [first, second] }), { ok: true, appended: 1, total: 2 });
    const dates = listDates(root, session.studentId);
    assert.equal(dates.length, 1);
    assert.equal(dates[0].eventCount, 2);
    const firstPage = queryTimeline(root, { studentId: session.studentId, date: dates[0].date, limit: 1 });
    assert.equal(firstPage.events.length, 1);
    assert.equal(firstPage.nextCursor, '1');
    assert.equal('originalPath' in firstPage.events[0], false, '前端分页结果不得泄露本机路径');
    const highlighted = queryTimeline(root, { studentId: session.studentId, date: dates[0].date, reason: 'highlight' });
    assert.equal(highlighted.total, 1);
    assert.equal(highlighted.events[0].id, 'item-2');
    assert.equal(deleteSessionEvents(root, session.studentId, session.id).removed, 2);
    assert.equal(listDates(root, session.studentId).length, 0, '删除候选会话后应同步清理其索引和缩略图目录');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('timeline thumbnail location is deterministic and student scoped', () => {
  const event = captureEventFromSessionItem({ id: 's1', studentId: 'student/1' }, { id: 'capture:1', capturedAt: '2026-09-10T12:00:00.000Z' });
  assert.equal(thumbnailPath('D:/root', event), thumbnailPath('D:/root', event));
  assert.match(thumbnailPath('D:/root', event), /timeline[\\/]student-1-/);
  assert.match(thumbnailPath('D:/root', event), /thumbnails/);
});

test('one thousand capture facts are paginated before entering the renderer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-capture-pagination-'));
  const session = { id: 'long-session', studentId: 'student-long', studentName: '长时采集学生' };
  try {
    const startedAt = Date.parse('2026-09-10T01:00:00.000Z');
    for (let index = 0; index < 1000; index += 1) {
      appendCaptureItem(root, session, {
        id: `long-item-${index}`,
        path: path.join(root, `${index}.png`),
        capturedAt: new Date(startedAt + (index * 1000)).toISOString(),
        reason: 'interval',
      });
    }
    const date = listDates(root, session.studentId)[0].date;
    const page = queryTimeline(root, { studentId: session.studentId, date, limit: 30 });
    assert.equal(page.total, 1000);
    assert.equal(page.events.length, 30);
    assert.equal(page.nextCursor, '30');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
