'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeProjectMaterialRegistry } = require('../scripts/lib/agent-0228-business-result.cjs');

test('does not count succeeded no_work task when the material failed terminally', () => {
  const result = summarizeProjectMaterialRegistry({
    materials: [{
      materialId: 'm1',
      processing: { state: 'failed_terminal', error: { code: 'AGENT_POLICY_CHANGED' } },
    }],
    receipts: [],
    commits: [],
  });
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.businessCompleted, false);
});

test('counts a material only when processing or an immutable commit proves completion', () => {
  const result = summarizeProjectMaterialRegistry({
    materials: [
      { materialId: 'm1', processing: { state: 'completed' } },
      { materialId: 'm2', processing: { state: 'submitted' } },
    ],
    receipts: [{ materialId: 'm2', status: 'accepted' }],
    commits: [{ materialId: 'm2', version: 1 }],
  });
  assert.equal(result.completed, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.businessCompleted, true);
});

test('does not count no_work or ignored materials as business output', () => {
  const result = summarizeProjectMaterialRegistry({
    materials: [
      { materialId: 'm1', processing: { state: 'no_work' } },
      { materialId: 'm2', processing: { state: 'ignored' } },
    ],
    receipts: [],
    commits: [],
  });
  assert.equal(result.completed, 0);
  assert.equal(result.businessCompleted, false);
});
