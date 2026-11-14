'use strict';

const path = require('node:path');

const profileRunQueues = new Map();
const profileAuthFailures = new Map();
const PROFILE_AUTH_FAILURE_COOLDOWN_MS = 5 * 60_000;

function workBuddyProfileKey(runtime) {
  return path.resolve(String(runtime?.authRoot || runtime?.configDir || runtime?.cliPath || 'workbuddy-default'));
}

function workBuddyAuthVersion(runtime) {
  return String(runtime?.authVersion || '');
}

// All background WorkBuddy lanes in this process share one mutable official
// authentication profile. They must not launch competing CLI processes.
async function withExclusiveWorkBuddyProfile(runtime, signal, task) {
  const key = workBuddyProfileKey(runtime);
  const previous = profileRunQueues.get(key) || Promise.resolve();
  let releaseGate;
  const gate = new Promise(resolve => { releaseGate = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  profileRunQueues.set(key, tail);
  try {
    await previous.catch(() => {});
    if (signal?.aborted) throw Object.assign(new Error('任务已取消'), {
      code: 'cancelled', stage: 'not_sent', stopConfirmed: true,
    });
    return await task();
  } finally {
    releaseGate();
    if (profileRunQueues.get(key) === tail) profileRunQueues.delete(key);
  }
}

function workBuddyProfileAuthFailure(runtime, now = Date.now()) {
  const blocked = profileAuthFailures.get(workBuddyProfileKey(runtime));
  if (!blocked || blocked.authVersion !== workBuddyAuthVersion(runtime) || blocked.until <= now) return null;
  return Object.assign(new Error('WorkBuddy 授权配置刚刚在真实进程中失效；本次任务未发送，请重新授权后再处理'), {
    code: 'AUTHENTICATION_REQUIRED', stage: 'not_sent', stopConfirmed: true,
    diagnosticOrigin: 'profile_circuit',
  });
}

function recordWorkBuddyProfileAuthFailure(runtime, now = Date.now()) {
  profileAuthFailures.set(workBuddyProfileKey(runtime), {
    authVersion: workBuddyAuthVersion(runtime),
    until: now + PROFILE_AUTH_FAILURE_COOLDOWN_MS,
  });
}

function clearWorkBuddyProfileAuthFailure(runtime) {
  profileAuthFailures.delete(workBuddyProfileKey(runtime));
}

module.exports = {
  PROFILE_AUTH_FAILURE_COOLDOWN_MS,
  workBuddyProfileKey,
  withExclusiveWorkBuddyProfile,
  workBuddyProfileAuthFailure,
  recordWorkBuddyProfileAuthFailure,
  clearWorkBuddyProfileAuthFailure,
};
