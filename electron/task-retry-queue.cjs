'use strict';

// Shared wake-up for resource waits. This is not a business retry: it neither
// changes execution identity nor consumes an attempt before resources exist.
function createTaskRetryQueue({ run, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  yieldTurn = () => new Promise(resolve => setImmediate(resolve)), onError = () => {}, batchSize = 20,
  minimumDrainIntervalMs = 0 } = {}) {
  const entries = new Map();
  let timer = null, running = false, closed = false, lastDrainAt = Number.NEGATIVE_INFINITY;
  function arm() {
    if (closed || running || timer || !entries.size) return;
    let next = Infinity;
    for (const value of entries.values()) next = Math.min(next, value.dueAt);
    next = Math.max(next, lastDrainAt + Math.max(0, Number(minimumDrainIntervalMs) || 0));
    // Node converts an overflowing delay to 1 ms. Long Retry-After values must
    // wait, not spin or execute earlier than the service permits.
    timer = setTimer(() => { timer = null; return drain(); }, Math.min(2147483647, Math.max(0, next - now())));
    timer.unref?.();
  }
  function schedule(id, adapterId, delay = 15000) {
    if (closed || !id || !Number.isFinite(delay)) return;
    const key = String(id), dueAt = now() + Math.max(0, delay), current = entries.get(key);
    // Coalesce duplicate wakes, but allow a newly discovered earlier wake to
    // replace the old timer. A stale later entry must never hide urgent work.
    if (current && current.dueAt <= dueAt && current.adapterId === adapterId) return;
    entries.set(key, { adapterId, dueAt: current ? Math.min(current.dueAt, dueAt) : dueAt });
    // A new entry may be earlier than the previously scheduled wake-up.
    if (timer) { clearTimer(timer); timer = null; }
    arm();
  }
  async function drain() {
    if (closed || running) return;
    running = true;
    lastDrainAt = now();
    try {
      const due = [...entries].filter(([, item]) => item.dueAt <= now()).slice(0, batchSize);
      for (const [id, item] of due) {
        if (closed) break;
        if (entries.get(id) !== item) continue;
        entries.delete(id);
        try { await run(id, item.adapterId); }
        catch (error) { onError(error, id); }
        await yieldTurn();
      }
    } finally { running = false; arm(); }
  }
  return { schedule, delete: id => entries.delete(String(id)), has: id => entries.has(String(id)), get size() { return entries.size; },
    close() { closed = true; if (timer) clearTimer(timer); timer = null; entries.clear(); } };
}
module.exports = { createTaskRetryQueue };
