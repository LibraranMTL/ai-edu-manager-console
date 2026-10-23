'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stableOffsetMinutes, staggeredScheduleTime } = require('../electron/task-schedule-window.cjs');

test('peak task times spread deterministically across two-hour windows', () => {
  const morning = staggeredScheduleTime('student-a', 'weekly_action', '2026-W43', '08:00');
  const evening = staggeredScheduleTime('student-a', 'learning_changes', '2026-W43', '21:30');
  assert.match(morning, /^(08|09):\d{2}$/);
  assert.match(evening, /^(21|22):\d{2}$/);
  assert.equal(staggeredScheduleTime('student-a', 'weekly_action', '2026-W43', '08:00'), morning);
  assert.ok(stableOffsetMinutes('student-a', 'weekly_action', '2026-W43') < 120);
  assert.equal(staggeredScheduleTime('student-a', 'weekly_action', '2026-W43', '14:15'), '14:15');
});
