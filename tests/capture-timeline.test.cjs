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

test('T0 keeps time provenance, explicit task identity and unknown actor separate from student scope', () => {
  const session = { id: 'session-time', studentId: 'student-time', startedAt: '2026-09-10T03:00:00.000Z', taskId: 'exercise-7' };
  const item = { id: 'frame-time', capturedAt: 'not-a-time', uploadedAt: '2026-09-10T03:05:00.000Z',
    actorType: 'student', contentHash: 'same-picture', taskVersion: '2' };
  const event = captureEventFromSessionItem(session, item);
  assert.equal(event.occurredAt, item.uploadedAt);
  assert.equal(event.reportedCapturedAt, 'not-a-time', '无效原始时间也应留作溯源，但不得充当发生时间');
  assert.equal(event.timeSource, 'uploaded_at');
  assert.equal(event.timePrecision, 'event_time_unknown');
  assert.equal(event.temporalSchema, 'edu-manager.temporal-event.v1');
  assert.equal(event.actorType, 'unknown', '学生档案归属不等于实际操作人为学生');
  assert.equal(event.claimedActorType, 'student');
  assert.equal(event.taskId, 'exercise-7');
  assert.equal(event.taskVersion, '2');
  const supported = captureEventFromSessionItem(session, {
    ...item, capturedAt: '2026-09-10T03:04:00.123Z', actorEvidence: '已验证的任务提交账号', conceptIds: ['algebra-equations'],
  });
  assert.equal(supported.timeSource, 'captured_at');
  assert.equal(supported.timePrecision, 'subsecond');
  assert.equal(supported.actorType, 'student');
  assert.deepEqual(supported.conceptIds, ['algebra-equations']);
  const remoteUnknown = captureEventFromSessionItem({ ...session, deviceId: 'paired-device' }, {
    id: 'remote-unknown-time', capturedAt: '', reportedCapturedAtRaw: '2026-09-10 03:04:00',
    captureTimeStatus: 'timezone_unspecified', uploadedAt: item.uploadedAt, receivedAtSource: 'host_received',
  });
  assert.equal(remoteUnknown.deviceId, 'paired-device');
  assert.equal(remoteUnknown.reportedCapturedAt, '2026-09-10 03:04:00');
  assert.equal(remoteUnknown.occurredAt, item.uploadedAt);
  assert.equal(remoteUnknown.timeSource, 'uploaded_at');
  assert.equal(remoteUnknown.captureTimeStatus, 'timezone_unspecified');
  assert.equal(remoteUnknown.receivedAtSource, 'host_received');
  const repeated = captureEventFromSessionItem({ id: 's' }, { contentHash: 'abc', path: 'one.png', uploadedAt: item.uploadedAt });
  const repeatedAgain = captureEventFromSessionItem({ id: 's' }, { contentHash: 'abc', path: 'one.png', uploadedAt: item.uploadedAt });
  assert.equal(repeated.id, repeatedAgain.id, '缺少上游 ID 时不应依赖处理时间生成不同事件 ID');
  assert.equal(repeated.id, `s-${item.uploadedAt}`, '旧版有时间戳的回退 ID 必须保持兼容');
  const untimed = captureEventFromSessionItem({ id: 's' }, { contentHash: 'abc', path: 'one.png' });
  const untimedAgain = captureEventFromSessionItem({ id: 's' }, { contentHash: 'abc', path: 'one.png' });
  assert.equal(untimed.id, untimedAgain.id, '完全缺少时间戳时使用稳定来源键');
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
