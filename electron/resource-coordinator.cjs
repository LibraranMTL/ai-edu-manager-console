'use strict';

const DEFAULT_LIMITS = Object.freeze({ heavy: 1, disk: 1, cpu: 1, localAgent: 1, network: 2 });

class ResourceCoordinator {
  constructor({ limits = DEFAULT_LIMITS, now = Date.now, getSnapshot = null } = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.now = now;
    this.active = new Map();
    this.queue = [];
    this.serial = 0;
    this.foregroundUntil = 0;
    this.timer = null;
    this.keyed = new Map();
    this.activeScopes = new Map();
    this.external = new Map();
    this.getSnapshot = typeof getSnapshot === 'function' ? getSnapshot : null;
    this.lastPressureSampleAt = 0;
    this.pressure = { paused: false, highCpuSamples: 0, lowCpuSamples: 0, reason: '' };
  }

  noteForegroundActivity(durationMs = 60_000) {
    this.foregroundUntil = Math.max(this.foregroundUntil, this.now() + Math.max(0, Number(durationMs) || 0));
  }

  normalizedTypes(types) {
    const normalized = [...new Set((Array.isArray(types) ? types : [types]).map(String).filter(Boolean))];
    if (normalized.some(type => ['disk', 'cpu', 'localAgent'].includes(type))) normalized.push('heavy');
    return [...new Set(normalized)];
  }

  updatePressure(snapshot = {}) {
    const cpu = Number(snapshot.cpuPercent || 0);
    if (cpu > 65) { this.pressure.highCpuSamples++; this.pressure.lowCpuSamples = 0; }
    else if (cpu < 45) { this.pressure.lowCpuSamples++; this.pressure.highCpuSamples = 0; }
    else { this.pressure.highCpuSamples = 0; this.pressure.lowCpuSamples = 0; }
    const memoryLow = Number(snapshot.availableMemoryRatio ?? 1) < .2
      || Number(snapshot.availableMemoryBytes ?? Number.MAX_SAFE_INTEGER) < 4 * 1024 ** 3;
    const latencyHigh = Number(snapshot.rendererLatencyMs || 0) > 120 || snapshot.frontendLatencyHigh === true;
    if (memoryLow) { this.pressure.paused = true; this.pressure.reason = 'memory_pressure'; }
    else if (latencyHigh) { this.pressure.paused = true; this.pressure.reason = 'renderer_latency'; }
    else if (this.pressure.highCpuSamples >= 2) { this.pressure.paused = true; this.pressure.reason = 'cpu_pressure'; }
    else if (this.pressure.paused && this.pressure.lowCpuSamples >= 3) { this.pressure.paused = false; this.pressure.reason = ''; }
    return { ...this.pressure };
  }

  refreshPressure() {
    if (!this.getSnapshot || (!this.queue.length && !this.active.size && !this.external.size)) return;
    if (this.now() - this.lastPressureSampleAt < 1_000) return;
    this.lastPressureSampleAt = this.now();
    try { this.updatePressure(this.getSnapshot()); } catch { /* resource snapshot is advisory */ }
  }

  canStart(entry) {
    this.refreshPressure();
    if (entry.background && this.now() < this.foregroundUntil) return false;
    if (entry.background && entry.types.includes('heavy') && this.pressure.paused) return false;
    if (entry.scopeKeys.some(scope => (this.activeScopes.get(scope) || 0) > 0)) return false;
    return entry.types.every((type) => (this.active.get(type) || 0) < (this.limits[type] || 1));
  }

  scheduleDrain() {
    if (this.timer || !this.queue.length) return;
    const wait = Math.max(25, Math.min(1_000, this.foregroundUntil - this.now() || 25));
    this.timer = setTimeout(() => { this.timer = null; this.drain(); }, wait);
    this.timer.unref?.();
  }

  drain() {
    this.refreshPressure();
    const agedPriority = entry => entry.priority + Math.floor(Math.max(0, this.now() - entry.enqueuedAt) / 300_000);
    this.queue.sort((a, b) => agedPriority(b) - agedPriority(a) || a.serial - b.serial);
    let started = false;
    for (let index = 0; index < this.queue.length;) {
      const entry = this.queue[index];
      if (entry.signal?.aborted) {
        this.queue.splice(index, 1);
        entry.reject(Object.assign(new Error('后台任务已取消。'), { code: 'resource_cancelled' }));
        continue;
      }
      if (!this.canStart(entry)) { index++; continue; }
      this.queue.splice(index, 1);
      entry.types.forEach((type) => this.active.set(type, (this.active.get(type) || 0) + 1));
      entry.scopeKeys.forEach(scope => this.activeScopes.set(scope, (this.activeScopes.get(scope) || 0) + 1));
      started = true;
      Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(() => {
        entry.types.forEach((type) => this.active.set(type, Math.max(0, (this.active.get(type) || 1) - 1)));
        entry.scopeKeys.forEach(scope => this.activeScopes.set(scope, Math.max(0, (this.activeScopes.get(scope) || 1) - 1)));
        if (entry.key) this.keyed.delete(entry.key);
        this.drain();
      });
    }
    if (!started && this.queue.length) this.scheduleDrain();
  }

  run(types, task, { priority = 0, background = false, signal, key = '', studentId = '', projectId = '' } = {}) {
    const normalized = this.normalizedTypes(types);
    if (!normalized.length) return Promise.resolve().then(task);
    if (key && this.keyed.has(key)) return this.keyed.get(key);
    const promise = new Promise((resolve, reject) => {
      this.queue.push({ types: normalized, task, priority: Number(priority) || 0, background: Boolean(background),
        signal, key: String(key || ''), serial: ++this.serial, resolve, reject, enqueuedAt: this.now(),
        scopeKeys: [studentId ? `student:${studentId}` : '', projectId ? `project:${projectId}` : ''].filter(Boolean) });
      this.drain();
    });
    if (key) this.keyed.set(key, promise);
    return promise;
  }

  acquireExternal(types, { studentId = '', projectId = '', background = true } = {}) {
    const entry = { types: this.normalizedTypes(types), background: Boolean(background),
      scopeKeys: [studentId ? `student:${studentId}` : '', projectId ? `project:${projectId}` : ''].filter(Boolean) };
    if (!this.canStart(entry)) return null;
    const token = Symbol('external-resource');
    entry.types.forEach(type => this.active.set(type, (this.active.get(type) || 0) + 1));
    entry.scopeKeys.forEach(scope => this.activeScopes.set(scope, (this.activeScopes.get(scope) || 0) + 1));
    this.external.set(token, entry);
    let released = false;
    return () => {
      if (released) return; released = true;
      this.external.delete(token);
      entry.types.forEach(type => this.active.set(type, Math.max(0, (this.active.get(type) || 1) - 1)));
      entry.scopeKeys.forEach(scope => this.activeScopes.set(scope, Math.max(0, (this.activeScopes.get(scope) || 1) - 1)));
      this.drain();
    };
  }

  status() {
    return { active: Object.fromEntries(this.active), queued: this.queue.length, foregroundUntil: this.foregroundUntil,
      pressure: { ...this.pressure }, external: this.external.size };
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const error = Object.assign(new Error('资源队列已关闭。'), { code: 'resource_queue_closed' });
    for (const entry of this.queue.splice(0)) entry.reject(error);
    this.keyed.clear();
    for (const release of [...this.external.keys()]) {
      const entry = this.external.get(release); this.external.delete(release);
      entry.types.forEach(type => this.active.set(type, Math.max(0, (this.active.get(type) || 1) - 1)));
      entry.scopeKeys.forEach(scope => this.activeScopes.set(scope, Math.max(0, (this.activeScopes.get(scope) || 1) - 1)));
    }
  }
}

module.exports = { DEFAULT_LIMITS, ResourceCoordinator };
