'use strict';
const crypto = require('node:crypto');
// Uses the host task store, transition validator, cancellation map and resource
// admission gate. This module does not own a second queue or scheduler.
function createPracticeTaskHost(host) {
  const taskId = (studentId, attemptId) => `practice-${crypto.createHash('sha256').update(`${studentId}:${attemptId}`).digest('hex').slice(0, 32)}`;
  async function enqueue(studentId, attemptId, retry = false) {
    const student = host.student(studentId); if (!student) throw Error('当前学生不存在');
    const id = taskId(studentId, attemptId), root = host.studentDirectory(student);
    const existing = host.read().tasks.find(task => task.id === id);
    if (!existing) host.upsert([{ id, title: '学习卡片作答评阅', kind: 'practice_attempt_review', sourceType: 'student', sourceId: studentId,
      sourceName: student.name, status: 'pending', executor: 'internal', executionMode: 'internal', trigger: 'practice_submit',
      idempotencyKey: id, input: { attemptId }, permissions: { read: [root], write: [root], operations: ['read', 'review_practice'] },
      timeoutSeconds: 300, heartbeatTimeoutSeconds: 45, autoRetry: false, completionPolicy: 'validated', riskLevel: 'low' }]);
    else if (retry && !['running','waiting_result'].includes(existing.status)) {
      const store = host.read(); host.transition(store, id, 'pending', { error: null }, 'practice_retry_requested'); await host.write(store);
    }
    await host.flush?.();
    setImmediate(drain); return { taskId: id };
  }
  function drain() {
    try {
    if (!host.active() || [...host.running.values()].some(entry => entry.practiceReview)) return;
    const next = host.read().tasks.find(task => task.kind === 'practice_attempt_review' && ['pending','approved','queued'].includes(task.status));
    if (next) Promise.resolve(host.execute(next.id, 'internal')).catch(error => host.onError?.(error));
    } catch (error) { host.onError?.(error); }
  }
  async function submit(task) {
    if ([...host.running.values()].some(entry => entry.practiceReview)) {
      const store = host.read(); host.transition(store, task.id, 'queued', {}, 'practice_serial_wait'); await host.write(store);
      return { ok: true, queued: true, message: '已保存，等待前一份作答处理。' };
    }
    const student = host.student(task.sourceId); if (!student || !host.active()) return { ok: false, message: '学生范围或授权已失效' };
    const permit = host.acquire(task);
    if (!permit) { host.retryLater(task.id, 'internal'); return { ok: true, queued: true, message: '后台资源忙，稍后继续。' }; }
    const store = host.read(), executionId = `practice-${crypto.randomUUID()}`;
    const transition = host.transition(store, task.id, 'running', { executionId, executor: 'internal', adapterId: 'internal', executionMode: 'internal',
      attempt: (task.attempt || 0) + 1, startedAt: new Date().toISOString(), lastHeartbeatAt: new Date().toISOString(), error: null }, 'practice_review_started');
    if (!transition.ok) { permit(); return transition; }
    try { await host.write(store); } catch (error) { permit(); throw error; }
    const controller = new AbortController();
    const checkpoint = async phase => {
      const currentStore = host.read(), current = currentStore.tasks.find(item => item.id === task.id);
      if (!host.active() || !host.student(task.sourceId) || current?.executionId !== executionId || current.status !== 'running' || controller.signal.aborted) throw Object.assign(Error('评阅执行已取消或归属变化'), { code: 'cancelled' });
      current.input = { ...current.input, phase }; current.lastHeartbeatAt = new Date().toISOString(); await host.write(currentStore);
    };
    const heartbeatTimer = setInterval(() => host.heartbeat(task.id, executionId), 5000); heartbeatTimer.unref?.();
    let timedOut=false;
    const timeout = require('./task-active-deadlines.cjs').taskActiveDeadlines.schedule(() => {timedOut=true;controller.abort();}, host.timeoutMs || 300000);
    const running = { practiceReview: true, executionId, adapterId: 'internal', heartbeatTimer,
      child: { killed: false, kill() { this.killed = true; controller.abort(); return true; } } };
    host.running.set(task.id, running);
    running.completion = Promise.resolve().then(async () => {
      await checkpoint('starting');
      return host.runtime().reviewAttempt(task.sourceId, task.input.attemptId, { signal: controller.signal, checkpoint });
    }).then(async output => {
      const current = host.read(); if (current.tasks.find(item => item.id === task.id)?.executionId !== executionId) return;
      if (!host.transition(current, task.id, 'reviewing', {}, 'practice_result_checked').ok) return;
      host.transition(current, task.id, 'succeeded', { result: { summary: output.status === 'needs_attention' ? '识别或判断不足，原件已保留，等待查看。' : '作答处理完成。', structuredOutput: output } }, 'practice_review_finished'); await host.write(current);
    }).catch(async error => {
      const current = host.read(), entry = current.tasks.find(item => item.id === task.id);
      if (entry?.executionId === executionId && entry.status === 'running') {
        host.transition(current, task.id, timedOut?'timed_out':controller.signal.aborted ? 'cancelled' : 'failed', { error: { code: timedOut?'PRACTICE_REVIEW_TIMEOUT':error.code || 'PRACTICE_REVIEW_FAILED', message: timedOut?'评阅超过时限，原件保留，可稍后重试。':error.message }, autoRetry: false }, 'practice_review_failed'); await host.write(current);
      }
    }).finally(() => {
      clearInterval(heartbeatTimer); timeout.cancel(); permit();
      if (host.running.get(task.id) === running) host.running.delete(task.id);
      host.notify(task.sourceId); setImmediate(drain);
    });
    void running.completion.catch(error => host.onError?.(error));
    return { ok: true, task: transition.task, message: '作答已保存，后台正在处理。' };
  }
  async function recover(studentId) {
    for (const attemptId of await host.runtime().recoverable(studentId)) {
      const id = taskId(studentId, attemptId), store = host.read(), existing = store.tasks.find(item => item.id === id);
      if (existing && !host.running.has(id)) {
        if (['running','waiting_result'].includes(existing.status)) host.transition(store, id, 'failed', { error: { code: 'RESTART_RECOVERY', message: '重启后恢复作答处理' } }, 'practice_interrupted');
        if (!['pending','approved','queued'].includes(existing.status)) host.transition(store, id, 'pending', {}, 'practice_recovered');
        await host.write(store);
      }
      await enqueue(studentId, attemptId);
    }
  }
  return { enqueue, submit, recover, taskId };
}
module.exports = { createPracticeTaskHost };
