'use strict';
const { performance } = require('node:perf_hooks');
// evaluate is the harness CDP Runtime.evaluate adapter. Start the clock BEFORE
// posting input, so renderer command-queue delay cannot disappear from the metric.
async function measureInteraction({ evaluate, actionExpression, readyExpression, timeoutMs = 10000,
  requireDocumentVisibility = true }) {
  const startedAt = new Date().toISOString(), start = performance.now();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('interaction_timeout')), timeoutMs); });
  try {
    const operation = (async () => {
      await evaluate(`(async()=>await (${actionExpression}))()`);
      const end = performance.now() + Number(timeoutMs);
      while (true) {
        const observed = await evaluate(`({ready:!!(${readyExpression}),visibility:document.visibilityState,focus:document.hasFocus(),readyState:document.readyState})`);
        if (observed?.ready) return observed;
        if (performance.now() > end) throw Error('ui_not_ready');
        await new Promise(resolve => setTimeout(resolve,10));
      }
    })();
    const observed = await Promise.race([operation, timeout]);
    if (requireDocumentVisibility && observed?.visibility !== 'visible') throw Error('window_not_visible');
    return { startedAt, durationMs: performance.now() - start, observedStatus: 'pass', observed };
  } catch (error) { return { startedAt, durationMs: performance.now() - start, observedStatus: 'fail', error: error.message }; }
  finally { clearTimeout(timer); }
}
module.exports = { measureInteraction };
