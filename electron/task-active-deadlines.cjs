'use strict';
// Shared OS sleep-aware deadlines, not a scheduler and not Agent heartbeats.
function createActiveDeadlines({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const entries = new Set(); let paused = false;
  function arm(entry) {
    if (paused || entry.closed) return;
    entry.started = now();
    entry.timer = setTimer(() => {
      entry.timer = null;
      entry.remaining = Math.max(0, entry.remaining - Math.max(0, now() - entry.started));
      if (entry.remaining > 0) { arm(entry); return; }
      entries.delete(entry); entry.closed = true; entry.callback();
    }, Math.min(2147483647, Math.max(0, entry.remaining)));
    entry.timer.unref?.();
  }
  return {
    schedule(callback, delay) {
      const entry = { callback, remaining: Math.max(0, delay), closed: false, timer: null, started: now() };
      entries.add(entry); arm(entry);
      return { cancel() { if (entry.timer) clearTimer(entry.timer); entry.closed = true; entries.delete(entry); }, unref() {} };
    },
    pause() {
      if (paused) return; paused = true;
      for (const entry of entries) {
        if (entry.timer) { clearTimer(entry.timer); entry.timer = null; entry.remaining = Math.max(0, entry.remaining - Math.max(0, now() - entry.started)); }
      }
    },
    resume() { if (!paused) return; paused = false; for (const entry of entries) arm(entry); },
    get size() { return entries.size; },
  };
}
const taskActiveDeadlines = createActiveDeadlines();
module.exports = { createActiveDeadlines, taskActiveDeadlines };
