const { adaptiveConcurrency } = require('./capture-timeline-scheduler.cjs');

class CaptureHeavyWorkGate {
  constructor({ coordinator = null, minStudentGapMs = 0, minLocalAgentGapMs = 0, now = Date.now, onAvailable = null } = {}) {
    this.active = new Map();
    this.coordinator = coordinator;
    this.minStudentGapMs = Math.max(0, Number(minStudentGapMs) || 0);
    this.minLocalAgentGapMs = Math.max(0, Number(minLocalAgentGapMs) || 0);
    this.now = now;
    this.lastStudentHeavy = new Map();
    this.lastLocalAgentReleasedAt = 0;
    this.lastBlock = { reason: '', retryAfterMs: 0 };
    this.onAvailable = typeof onAvailable === 'function' ? onAvailable : null;
  }

  tryAcquire({ kind, studentId, sessionId, snapshot, resourceClass = 'heavy', requestOrigin = 'background',
    ignoreForegroundDelay = false }) {
    const scopedStudent = String(studentId || '');
    const normalizedResourceClass = resourceClass === 'network' ? 'network' : 'heavy';
    const normalizedKind = String(kind || 'background');
    const localAgentWork = normalizedKind.startsWith('agent_');
    // Classification is a bounded intake step, not a digest/report workload.
    // It still shares the single local-Agent permit, but must not impose the
    // ten-minute same-student cooldown on the task that consumes its result.
    const studentCooldownEligible = !['agent_classification', 'agent_probe'].includes(normalizedKind);
    const now = this.now();
    const wait = (reason = 'resource_busy', retryAfterMs = 0) => {
      this.lastBlock = { reason, retryAfterMs: Math.max(0, Number(retryAfterMs) || 0),
        waitingSince: new Date(now).toISOString(), queuePosition: 0 };
      return null;
    };
    this.coordinator?.updatePressure(snapshot || {});
    const capacity = adaptiveConcurrency(snapshot || {});
    if (capacity <= 0) {
      const reason = snapshot?.captureActive ? 'capture_active'
        : snapshot?.diskPressure ? 'disk_pressure'
          : snapshot?.frontendLatencyHigh ? 'renderer_latency'
        : snapshot?.cpuPressure ? 'cpu_pressure'
          : Number(snapshot?.availableMemoryRatio || 1) < .15 ? 'memory_pressure'
            : snapshot?.externalHeavyWorkActive ? 'local_agent_busy' : 'system_pressure';
      return wait(reason);
    }
    const classCapacity = normalizedResourceClass === 'network' ? 2 : 1;
    if ([...this.active.values()].filter((entry) => entry.resourceClass === normalizedResourceClass).length >= classCapacity)
      return wait(normalizedResourceClass === 'heavy' ? 'local_agent_busy' : 'network_busy');
    if (scopedStudent && [...this.active.values()].some((entry) => entry.studentId === scopedStudent)) return wait('scope_busy');
    const previousHeavy = this.lastStudentHeavy.get(scopedStudent);
    if (studentCooldownEligible && normalizedResourceClass === 'heavy' && scopedStudent && previousHeavy
      && previousHeavy.sessionId !== String(sessionId || '') && now - previousHeavy.at < this.minStudentGapMs)
      return wait('student_cooldown', this.minStudentGapMs - (now - previousHeavy.at));
    // Desktop Agents are separate processes with sizeable startup peaks. Keep
    // them strictly serial and leave a short recovery window between processes
    // even when they belong to different students.
    if (localAgentWork && normalizedResourceClass === 'heavy' && this.lastLocalAgentReleasedAt
      && now - this.lastLocalAgentReleasedAt < this.minLocalAgentGapMs)
      return wait('local_agent_cooldown', this.minLocalAgentGapMs - (now - this.lastLocalAgentReleasedAt));
    const coordinatedOptions = { studentId: scopedStudent, background: true,
      ignoreForegroundDelay: requestOrigin === 'user' || Boolean(ignoreForegroundDelay) };
    const coordinatedTypes = normalizedResourceClass === 'network' ? ['network'] : localAgentWork ? ['localAgent'] : ['heavy'];
    const releaseCoordinated = this.coordinator?.acquireExternal(
      coordinatedTypes, coordinatedOptions);
    if (this.coordinator && !releaseCoordinated)
      return wait(this.coordinator.externalBlockReason(coordinatedTypes, coordinatedOptions) || 'resource_busy');
    this.lastBlock = { reason: '', retryAfterMs: 0 };
    const token = Symbol(`${kind || 'background'}:${sessionId || ''}`);
    this.active.set(token, { kind: String(kind || 'background'), studentId: scopedStudent, sessionId: String(sessionId || ''),
      resourceClass: normalizedResourceClass, requestOrigin: String(requestOrigin || 'background') });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active.delete(token);
      if (studentCooldownEligible && normalizedResourceClass === 'heavy' && scopedStudent) this.lastStudentHeavy.set(scopedStudent, {
        at: this.now(), sessionId: String(sessionId || ''),
      });
      if (localAgentWork && normalizedKind !== 'agent_probe') this.lastLocalAgentReleasedAt = this.now();
      releaseCoordinated?.();
      if (this.onAvailable) setImmediate(() => {
        try {
          this.onAvailable({ kind: normalizedKind, studentId: scopedStudent });
        } catch {
          // Resource release must never turn an optional wake-up hint into an
          // uncaught exception. The persisted retry queue remains the fallback.
        }
      });
    };
  }

  state() {
    return [...this.active.values()].map((entry) => ({ ...entry }));
  }

  waitingState() {
    // Waiting order is persisted by the task store. Keeping a second in-memory
    // queue here creates stale phantom holders after retries or renderer exits.
    return [];
  }

  blockState() {
    return { ...this.lastBlock };
  }
}

module.exports = { CaptureHeavyWorkGate };
