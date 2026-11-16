'use strict';

function createQaMainPerformance({ isolated, createMonitor }) {
  let monitor = null;
  let recording = false;
  return (action) => {
    if (!isolated) throw Object.assign(new Error('qa_performance_unavailable'), { code: 'QA_ONLY' });
    if (action === 'reset') {
      monitor ||= createMonitor({ resolution: 10 });
      monitor.enable();
      monitor.reset();
      recording = true;
      return { reset: true };
    }
    if (action !== 'read' || !recording) {
      throw Object.assign(new Error('qa_performance_not_recording'), { code: 'QA_NOT_RECORDING' });
    }
    const result = {
      schema: 'edu.qa.main-event-loop.v1',
      maximumMs: Number(monitor.max || 0) / 1e6,
      p95Ms: Number(monitor.percentile(95) || 0) / 1e6,
      meanMs: Number(monitor.mean || 0) / 1e6,
    };
    monitor.disable();
    recording = false;
    return result;
  };
}

module.exports = { createQaMainPerformance };
