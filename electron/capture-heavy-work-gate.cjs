const { adaptiveConcurrency } = require('./capture-timeline-scheduler.cjs');

class CaptureHeavyWorkGate {
  constructor({ coordinator = null, minStudentGapMs = 0, now = Date.now } = {}) {
    this.active = new Map();
    this.waiting = new Map();
    this.coordinator = coordinator;
    this.minStudentGapMs = Math.max(0, Number(minStudentGapMs) || 0);
    this.now = now;
    this.lastStudentHeavy = new Map();
  }

  tryAcquire({ kind, studentId, sessionId, snapshot, resourceClass = 'heavy' }) {
    const scopedStudent = String(studentId || '');
    const normalizedResourceClass = resourceClass === 'network' ? 'network' : 'heavy';
    const requestKey = `${normalizedResourceClass}|${String(kind || 'background')}|${scopedStudent}|${String(sessionId || '')}`;
    const now = this.now();
    for (const [key, entry] of this.waiting) if (now - entry.lastSeenAt > 60_000) this.waiting.delete(key);
    const wait = () => {
      const previous = this.waiting.get(requestKey);
      this.waiting.set(requestKey, { studentId: scopedStudent, resourceClass: normalizedResourceClass,
        enqueuedAt: previous?.enqueuedAt || now, lastSeenAt: now });
      return null;
    };
    const capacity = adaptiveConcurrency(snapshot || {});
    if (capacity <= this.active.size) return wait();
    const classCapacity = normalizedResourceClass === 'network' ? 2 : 1;
    if ([...this.active.values()].filter((entry) => entry.resourceClass === normalizedResourceClass).length >= classCapacity) return wait();
    if (scopedStudent && [...this.active.values()].some((entry) => entry.studentId === scopedStudent)) return wait();
    const previousHeavy = this.lastStudentHeavy.get(scopedStudent);
    if (normalizedResourceClass === 'heavy' && scopedStudent && previousHeavy
      && previousHeavy.sessionId !== String(sessionId || '') && now - previousHeavy.at < this.minStudentGapMs) return wait();
    const oldestEligible = [...this.waiting.entries()].find(([, entry]) => !entry.studentId
      || ![...this.active.values()].some((active) => active.studentId === entry.studentId));
    if (oldestEligible && oldestEligible[0] !== requestKey) return wait();
    this.coordinator?.updatePressure(snapshot || {});
    const releaseCoordinated = this.coordinator?.acquireExternal(
      normalizedResourceClass === 'network' ? ['network'] : ['localAgent'],
      { studentId: scopedStudent, background: true });
    if (this.coordinator && !releaseCoordinated) return wait();
    this.waiting.delete(requestKey);
    const token = Symbol(`${kind || 'background'}:${sessionId || ''}`);
    this.active.set(token, { kind: String(kind || 'background'), studentId: scopedStudent, sessionId: String(sessionId || ''), resourceClass: normalizedResourceClass });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active.delete(token);
      if (normalizedResourceClass === 'heavy' && scopedStudent) this.lastStudentHeavy.set(scopedStudent, {
        at: this.now(), sessionId: String(sessionId || ''),
      });
      releaseCoordinated?.();
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
