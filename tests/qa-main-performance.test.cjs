'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createQaMainPerformance } = require('../electron/qa-main-performance.cjs');

test('idle isolated runtime does not start the event-loop probe before visible interaction measurement', () => {
  const calls = [];
  const probe = createQaMainPerformance({
    isolated: true,
    createMonitor: options => {
      calls.push(['create', options.resolution]);
      return {
        max: 42_000_000, mean: 2_000_000,
        percentile: value => { assert.equal(value, 95); return 8_000_000; },
        enable: () => calls.push(['enable']),
        reset: () => calls.push(['reset']),
        disable: () => calls.push(['disable']),
      };
    },
  });
  assert.deepEqual(calls, []);
  assert.throws(() => probe('read'), { code: 'QA_NOT_RECORDING' });
  assert.deepEqual(calls, []);
  assert.deepEqual(probe('reset'), { reset: true });
  assert.deepEqual(calls, [['create', 10], ['enable'], ['reset']]);
  assert.deepEqual(probe('read'), {
    schema: 'edu.qa.main-event-loop.v1', maximumMs: 42, p95Ms: 8, meanMs: 2,
  });
  assert.deepEqual(calls.at(-1), ['disable']);
  assert.throws(() => probe('read'), { code: 'QA_NOT_RECORDING' });
  probe('reset');
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
});

test('main event-loop probe remains unavailable in a regular user process', () => {
  const probe = createQaMainPerformance({ isolated: false, createMonitor: () => { throw Error('must not create'); } });
  assert.throws(() => probe('reset'), { code: 'QA_ONLY' });
});
