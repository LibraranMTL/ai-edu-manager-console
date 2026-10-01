const { execFile } = require('node:child_process');

// OS discovery is slow on some Windows installations. Never wait for it in
// sendSync handlers or background timers on Electron's main thread.
function createInstallProbeCache({ run = execFile, onSettled = () => {}, now = Date.now,
  ttlMs = 600_000, timeoutMs = 8_000, concurrency = 2 } = {}) {
  const entries = new Map();
  const queue = [];
  let active = 0;
  function drain() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      let finished = false;
      const done = (error, stdout) => {
        if (finished) return;
        finished = true;
        if (!error) job.entry.value = String(stdout || '');
        // Cache empty and failed results too, so missing apps cannot create a
        // process storm. Keep the previous result if a refresh fails.
        job.entry.at = now();
        job.entry.pending = false;
        active--;
        drain();
        onSettled();
      };
      try {
        run(job.file, job.args, {
          encoding: 'utf8', windowsHide: true, timeout: timeoutMs,
          maxBuffer: 2 * 1024 * 1024,
        }, done);
      } catch (error) { done(error); }
    }
  }
  return {
    get(key, file, args) {
      let entry = entries.get(key);
      if (!entry) {
        entry = { value: '', at: null, pending: false };
        entries.set(key, entry);
      }
      if (!entry.pending && (entry.at === null || now() - entry.at >= ttlMs)) {
        entry.pending = true;
        queue.push({ entry, file, args });
        drain();
      }
      return entry.value;
    },
    get pending() { return active > 0 || queue.length > 0; },
  };
}

module.exports = { createInstallProbeCache };
