const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PAIR_PROTOCOL_VERSION,
  PAIR_REQUEST_TTL_MS,
  createPairRequest,
  machineCode,
  machineCodeConflict,
  nextPairRequestStatus,
  normalizePairRequest,
  verifyRequestToken,
} = require('../electron/pairing-protocol.cjs');

test('fixed machine codes are stable, role-scoped and user readable', () => {
  assert.equal(PAIR_PROTOCOL_VERSION, 2);
  assert.match(machineCode('host', 'host-123'), /^H-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.match(machineCode('tablet', 'tablet-123'), /^T-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(machineCode('host', 'host-123'), machineCode('host', 'host-123'));
  assert.notEqual(machineCode('host', 'same-id'), machineCode('tablet', 'same-id'));
});

test('pair requests use a hidden token and expire after two minutes', () => {
  const now = Date.parse('2026-07-20T10:00:00.000Z');
  const created = createPairRequest({
    initiator: 'tablet',
    hostId: 'host-1',
    tabletId: 'tablet-1',
    requestToken: 'secret-request-token',
  }, now);
  assert.equal(created.record.status, 'pending_host_accept');
  assert.equal(Date.parse(created.record.expiresAt) - now, PAIR_REQUEST_TTL_MS);
  assert.equal(created.record.requestToken, undefined);
  assert.equal(verifyRequestToken(created.record, 'secret-request-token'), true);
  assert.equal(verifyRequestToken(created.record, 'wrong-token'), false);
  assert.equal(normalizePairRequest(created.record, now + PAIR_REQUEST_TTL_MS).status, 'expired');
});

test('pair request transitions reject replay after acceptance or expiry', () => {
  const now = Date.parse('2026-07-20T10:00:00.000Z');
  const { record } = createPairRequest({ initiator: 'host' }, now);
  assert.equal(record.status, 'pending_tablet_accept');
  const accepted = nextPairRequestStatus(record, 'accept', now + 1000);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.request.status, 'accepted');
  assert.equal(nextPairRequestStatus(accepted.request, 'accept', now + 2000).ok, false);
  assert.equal(nextPairRequestStatus(record, 'accept', now + PAIR_REQUEST_TTL_MS).ok, false);
  const cancelled = nextPairRequestStatus(record, 'cancel', now + 2000);
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.request.status, 'cancelled');
  assert.equal(nextPairRequestStatus(cancelled.request, 'accept', now + 3000).ok, false);
});

test('a copied machine code cannot replace a different full device identity', () => {
  const devices = [{ id: 'tablet-a', machineCode: 'T-ABCD-2345' }];
  assert.equal(machineCodeConflict(devices, 'tablet', 'tablet-a', 'T-ABCD-2345'), null);
  assert.equal(machineCodeConflict(devices, 'tablet', 'tablet-b', 'T-ABCD-2345').id, 'tablet-a');
});
