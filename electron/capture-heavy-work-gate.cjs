const { adaptiveConcurrency } = require('./capture-timeline-scheduler.cjs');

class CaptureHeavyWorkGate {
  constructor() {
    this.active = new Map();
    this.waiting = new Map();
  }

  tryAcquire({ kind, studentId, sessionId, snapshot }) {
    const scopedStudent = String(studentId || '');
    const requestKey = `${String(kind || 'background')}|${scopedStudent}|${String(sessionId || '')}`;
    const now = Date.now();
    for (const [key, entry] of this.waiting) if (now - entry.lastSeenAt > 60_000) this.waiting.delete(key);
    const wait = () => {
      const previous = this.waiting.get(requestKey);
      this.waiting.set(requestKey, { studentId: scopedStudent,
        enqueuedAt: previous?.enqueuedAt || now, lastSeenAt: now });
      return null;
    };
    const capacity = adaptiveConcurrency(snapshot || {});
    if (capacity <= this.active.size) return wait();
    if (scopedStudent && [...this.active.values()].some((entry) => entry.studentId === scopedStudent)) return wait();
    const oldestEligible = [...this.waiting.entries()].find(([, entry]) => !entry.studentId
      || ![...this.active.values()].some((active) => active.studentId === entry.studentId));
    if (oldestEligible && oldestEligible[0] !== requestKey) return wait();
    this.waiting.delete(requestKey);
    const token = Symbol(`${kind || 'background'}:${sessionId || ''}`);
    this.active.set(token, { kind: String(kind || 'background'), studentId: scopedStudent, sessionId: String(sessionId || '') });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active.delete(token);
    };
  }

  state() {
    return [...this.active.values()].map((entry) => ({ ...entry }));
  }

  waitingState() {
    return [...this.waiting.entries()].map(([key, entry]) => ({ key, ...entry }));
  }
}

module.exports = { CaptureHeavyWorkGate };
