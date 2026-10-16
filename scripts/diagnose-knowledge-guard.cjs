'use strict';
// Test-only preload: preserve the helper's failure details hidden by higher
// layers. Run with synthetic test fixtures only; never production archives.
const api = require('../electron/project-knowledge-guard.cjs');
const original = api.openKnowledgeGuard;
api.openKnowledgeGuard = function diagnosticGuard(request, options) {
  const guard = original(request, options);
  for (const phase of ['ready', 'write', 'finalize']) {
    const call = guard[phase].bind(guard);
    guard[phase] = async (...args) => {
      try { return await call(...args); }
      catch (error) {
        console.error('GUARD_DIAGNOSTIC ' + JSON.stringify({ pid: process.pid, phase,
          code: error.code, details: error.details, message: error.message }));
        throw error;
      }
    };
  }
  return guard;
};
