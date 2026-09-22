const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { readJson, writeProcessingJob } = require('./capture-timeline-semantic.cjs');
const { writeReportRepairJob } = require('./capture-timeline-reports.cjs');

const FAST_RETRY_DELAYS = [60_000, 5 * 60_000, 15 * 60_000];
const RECOVERY_DELAY = 30 * 60_000;

function adaptiveConcurrency(snapshot = {}) {
  if (snapshot.captureActive || snapshot.externalHeavyWorkActive || snapshot.frontendLatencyHigh || snapshot.diskPressure || snapshot.cpuPressure || Number(snapshot.availableMemoryRatio || 1) < 0.15) return 0;
  if (snapshot.onBattery || Number(snapshot.idleSeconds || 0) < 60 || Number(snapshot.availableMemoryRatio || 1) < 0.3 || Number(snapshot.cpuPercent || 0) >= 45) return 1;
  return 2;
}

class CaptureTimelineScheduler {
  constructor(options = {}) {
    this.rootPath = String(options.rootPath || '');
    this.workerPath = String(options.workerPath || path.join(__dirname, 'capture-timeline-worker.cjs'));
    this.getResourceSnapshot = typeof options.getResourceSnapshot === 'function' ? options.getResourceSnapshot : () => ({});
    this.acquirePermit = typeof options.acquirePermit === 'function' ? options.acquirePermit : () => () => {};
    this.loadSession = typeof options.loadSession === 'function' ? options.loadSession : () => null;
    this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    this.onComplete = typeof options.onComplete === 'function' ? options.onComplete : () => {};
    this.queue = new Map();
    this.running = new Map();
    this.reportQueue = new Map();
    this.reportRunning = new Map();
    this.timer = null;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.restorePendingJobs();
    this.timer = setInterval(() => this.tick(), 2_000);
    this.timer.unref?.();
    this.tick();
  }

  stop() {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const item of this.running.values()) { item.worker.terminate(); item.releasePermit?.(); }
    for (const item of this.reportRunning.values()) { item.worker.terminate(); item.releasePermit?.(); }
    this.running.clear();
    this.reportRunning.clear();
  }

  enqueue(session, options = {}) {
    if (!session?.id || !session?.studentId) return { ok: false, message: 'Timeline job requires session and student identifiers.' };
    const key = String(session.id);
    const previous = this.queue.get(key);
    const dueAt = Number(options.dueAt || Date.now() + Number(options.delayMs || 0));
    const attempt = Math.max(1, Number(options.attempt || previous?.attempt || 1));
    this.queue.set(key, {
      session: { ...session, items: Array.isArray(session.items) ? session.items : [] },
      dueAt,
      attempt,
      enqueuedAt: previous?.enqueuedAt || Date.now(),
    });
    writeProcessingJob(this.rootPath, {
      jobId: `timeline-job-${session.id}`,
      studentId: String(session.studentId),
      sessionId: String(session.id),
      state: options.state || 'pending',
      attempt,
      nextRetryAt: new Date(dueAt).toISOString(),
      recoveryTrigger: options.recoveryTrigger || 'timer_or_resource_available',
      requiresUserAction: false,
      blockingReason: '',
    });
    this.tick();
    return { ok: true, sessionId: key, dueAt: new Date(dueAt).toISOString() };
  }

  restorePendingJobs() {
    const root = path.join(this.rootPath, 'jobs');
    if (!fs.existsSync(root)) {
      this.restoreReportJobs();
      return;
    }
    for (const studentEntry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!studentEntry.isDirectory()) continue;
      const studentRoot = path.join(root, studentEntry.name);
      for (const name of fs.readdirSync(studentRoot)) {
        if (!name.endsWith('.job.json')) continue;
        const job = readJson(path.join(studentRoot, name), null);
        if (!job || !['pending', 'running', 'retry_scheduled', 'recovery_scheduled', 'partial_completed', 'degraded'].includes(String(job.state || ''))) continue;
        const session = this.loadSession(job.sessionId);
        if (!session?.id || !session?.studentId) continue;
        const dueAt = Math.max(Date.now(), Date.parse(job.nextRetryAt || '') || Date.now());
        this.queue.set(String(session.id), { session, dueAt, attempt: Math.max(1, Number(job.attempt || 1)), enqueuedAt: Date.now() });
      }
    }
    this.restoreReportJobs();
  }

  restoreReportJobs() {
    const root = path.join(this.rootPath, 'report-jobs');
    if (!fs.existsSync(root)) return;
    for (const studentEntry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!studentEntry.isDirectory()) continue;
      for (const name of fs.readdirSync(path.join(root, studentEntry.name))) {
        if (!name.endsWith('.json')) continue;
        const job = readJson(path.join(root, studentEntry.name, name), null);
        if (job?.studentId && job?.sessionId && ['retry_scheduled', 'running'].includes(String(job.state || ''))) this.enqueueReportRepair(job, { persist: false });
      }
    }
  }

  enqueueReportRepair(job, options = {}) {
    if (!job?.studentId || !job?.sessionId) return { ok: false };
    const key = `${job.studentId}:${job.sessionId}`;
    const dueAt = Math.max(Date.now(), Date.parse(job.nextRetryAt || '') || Date.now());
    const item = { studentId: String(job.studentId), sessionId: String(job.sessionId), dates: [...new Set(job.dates || [])], attempt: Number(job.attempt || 1), dueAt };
    this.reportQueue.set(key, item);
    if (options.persist !== false) writeReportRepairJob(this.rootPath, { ...item, state: 'retry_scheduled', nextRetryAt: new Date(dueAt).toISOString(), requiresUserAction: false });
    this.tick();
    return { ok: true, dueAt: new Date(dueAt).toISOString() };
  }

  currentConcurrency() {
    return adaptiveConcurrency(this.getResourceSnapshot());
  }

  state() {
    return {
      concurrency: this.currentConcurrency(),
      running: [...this.running.keys(), ...[...this.reportRunning.keys()].map((key) => `report:${key}`)],
      queued: [...this.queue.values()].map((item) => ({ sessionId: item.session.id, dueAt: new Date(item.dueAt).toISOString(), attempt: item.attempt })),
      reportRepairsRunning: [...this.reportRunning.keys()],
      reportRepairsQueued: this.reportQueue.size,
    };
  }

  yieldForCapture() {
    for (const item of this.running.values()) {
      if (item.yieldRequested) continue;
      item.yieldRequested = true;
      item.worker.postMessage({ type: 'yield_for_capture' });
    }
    // Report projections are short and already have a durable repair queue.
    // Let the current projection finish; concurrency zero prevents a new one.
  }

  tick() {
    if (!this.started) return;
    const concurrency = this.currentConcurrency();
    if (concurrency === 0 && (this.running.size || this.reportRunning.size)) {
      this.yieldForCapture();
      return;
    }
    if (this.running.size + this.reportRunning.size >= concurrency) return;
    const now = Date.now();
    const ready = [...this.queue.values()]
      .filter((item) => item.dueAt <= now)
      .sort((left, right) => {
        const leftAge = now - left.enqueuedAt;
        const rightAge = now - right.enqueuedAt;
        return rightAge - leftAge || left.dueAt - right.dueAt;
      });
    while (this.running.size + this.reportRunning.size < concurrency && ready.length) this.run(ready.shift());
    const reportReady = [...this.reportQueue.values()].filter((item) => item.dueAt <= now)
      .sort((left, right) => left.dueAt - right.dueAt);
    while (this.running.size + this.reportRunning.size < concurrency && reportReady.length) this.runReportRepair(reportReady.shift());
  }

  runReportRepair(item) {
    const key = `${item.studentId}:${item.sessionId}`;
    if (this.reportRunning.has(key)) return;
    const releasePermit = this.acquirePermit({ kind: 'report_projection', studentId: item.studentId, sessionId: item.sessionId });
    if (!releasePermit) return;
    this.reportQueue.delete(key);
    writeReportRepairJob(this.rootPath, { ...item, state: 'running', nextRetryAt: '', requiresUserAction: false });
    let worker;
    try { worker = new Worker(this.workerPath, { workerData: { mode: 'report_rebuild', rootPath: this.rootPath, studentId: item.studentId, sessionId: item.sessionId, dates: item.dates } }); }
    catch {
      releasePermit();
      this.enqueueReportRepair({ ...item, attempt: item.attempt + 1, nextRetryAt: new Date(Date.now() + RECOVERY_DELAY).toISOString() });
      return;
    }
    const running = { ...item, worker, settled: false, releasePermit };
    this.reportRunning.set(key, running);
    const settle = (result) => {
      if (running.settled) return;
      running.settled = true;
      this.reportRunning.delete(key);
      running.releasePermit();
      if (result?.ok) writeReportRepairJob(this.rootPath, { ...item, state: 'completed', completedAt: new Date().toISOString(), nextRetryAt: '', requiresUserAction: false });
      else this.enqueueReportRepair({ ...item, attempt: item.attempt + 1, nextRetryAt: new Date(Date.now() + RECOVERY_DELAY).toISOString() });
      this.tick();
    };
    worker.on('message', (message) => {
      if (message?.type === 'completed') settle(message.result);
      if (message?.type === 'failed') settle({ ok: false });
    });
    worker.on('error', () => settle({ ok: false }));
    worker.on('exit', (code) => { if (code !== 0) settle({ ok: false }); });
  }

  run(item) {
    const sessionId = String(item.session.id);
    if (this.running.has(sessionId)) return;
    const releasePermit = this.acquirePermit({ kind: 'timeline', studentId: item.session.studentId, sessionId });
    if (!releasePermit) return;
    this.queue.delete(sessionId);
    let worker;
    try { worker = new Worker(this.workerPath, { workerData: { rootPath: this.rootPath, session: item.session, attempt: item.attempt } }); }
    catch (error) {
      releasePermit();
      this.fail(item, error.message);
      return;
    }
    const running = { ...item, worker, settled: false, releasePermit };
    this.running.set(sessionId, running);
    worker.on('message', async (message) => {
      if (running.settled) return;
      if (message?.type === 'progress') {
        this.onProgress(message);
        return;
      }
      if (message?.type === 'completed') {
        running.settled = true;
        this.running.delete(sessionId);
        if (message.result?.yielded) {
          running.releasePermit();
          this.enqueue(item.session, { delayMs: 30_000, attempt: item.attempt, state: 'retry_scheduled', recoveryTrigger: 'resource_available' });
          return;
        }
        try {
          await this.onComplete(message.result, item.session);
        } catch (error) {
          running.releasePermit();
          this.fail(item, `Timeline bundle publication failed: ${error.message}`);
          return;
        }
        running.releasePermit();
        if (message.result?.state === 'partial_completed' || message.result?.state === 'degraded') {
          this.enqueue(item.session, { dueAt: Date.now() + RECOVERY_DELAY, attempt: item.attempt + 1, state: 'recovery_scheduled', recoveryTrigger: 'timer_or_dependency_available' });
        }
        this.tick();
      }
      if (message?.type === 'failed') this.fail(item, message.error?.message || 'Timeline worker failed.');
    });
    worker.on('error', (error) => { if (!running.settled) this.fail(item, error.message); });
    worker.on('exit', (code) => {
      if (!running.settled && code !== 0 && this.running.has(sessionId)) this.fail(item, `Timeline worker exited with code ${code}.`);
    });
  }

  fail(item, message) {
    const sessionId = String(item.session.id);
    const running = this.running.get(sessionId);
    if (running) running.settled = true;
    this.running.delete(sessionId);
    running?.releasePermit?.();
    const attempt = Math.max(1, Number(item.attempt || 1));
    const fastDelay = FAST_RETRY_DELAYS[attempt - 1];
    const delay = fastDelay || RECOVERY_DELAY;
    const state = fastDelay ? 'retry_scheduled' : 'recovery_scheduled';
    writeProcessingJob(this.rootPath, {
      jobId: `timeline-job-${item.session.id}`,
      studentId: String(item.session.studentId),
      sessionId,
      state,
      attempt: attempt + 1,
      error: String(message || ''),
      nextRetryAt: new Date(Date.now() + delay).toISOString(),
      recoveryTrigger: fastDelay ? 'timer' : 'timer_or_dependency_available',
      requiresUserAction: false,
      blockingReason: '',
    });
    this.queue.set(sessionId, { session: item.session, dueAt: Date.now() + delay, attempt: attempt + 1, enqueuedAt: item.enqueuedAt || Date.now() });
    this.onProgress({ type: 'failed', sessionId, state, message });
    this.tick();
  }
}

module.exports = { CaptureTimelineScheduler, adaptiveConcurrency };
