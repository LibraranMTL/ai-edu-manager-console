const assert = require('node:assert/strict');
const test = require('node:test');
const {
  directSecretForBinding,
  mergeBindingDirectOffer,
  promoteCompatibilityDeliveries,
} = require('../electron/collaboration-direct-peer.cjs');

test('legacy bindings can reuse their common token hash for authenticated direct transfer', () => {
  const sharedSecretRef = 'a'.repeat(64);
  assert.equal(
    directSecretForBinding({ bindingId: 'binding-legacy', sharedSecretRef }, {}),
    sharedSecretRef,
  );
  assert.equal(
    directSecretForBinding({ bindingId: 'binding-new', sharedSecretRef }, { 'binding-new': 'stored-secret' }),
    'stored-secret',
  );
  assert.equal(directSecretForBinding({ bindingId: 'binding-unsafe', sharedSecretRef: 'short' }, {}), '');
});

test('discovered peer endpoints upgrade a legacy binding without duplicating offers', () => {
  const legacy = { bindingId: 'binding-legacy', transportOffers: [] };
  const first = mergeBindingDirectOffer(legacy, 'host-peer', {
    endpoints: ['http://192.168.1.20:18777', 'http://100.64.0.20:18777'],
    lastSeenAt: '2026-07-26T10:00:00.000Z',
  });
  assert.equal(first.changed, true);
  assert.deepEqual(first.binding.transportOffers[0].endpoints, [
    'http://192.168.1.20:18777',
    'http://100.64.0.20:18777',
  ]);
  const second = mergeBindingDirectOffer(first.binding, 'host-peer', {
    endpoints: ['http://192.168.1.20:18777', 'http://100.64.0.20:18777'],
  });
  assert.equal(second.changed, false);
});

test('completed compatibility packages are promoted to the native direct queue', () => {
  const result = promoteCompatibilityDeliveries({
    deliveries: {
      'manifest-project': {
        manifestId: 'manifest-project',
        targetNodeId: 'host-peer',
        packageRoot: 'C:\\packages\\manifest-project',
        status: 'compatibility_queue',
        error: 'legacy fallback',
      },
      'manifest-other': {
        manifestId: 'manifest-other',
        targetNodeId: 'host-other',
        packageRoot: 'C:\\packages\\manifest-other',
        status: 'compatibility_queue',
      },
    },
  }, {
    targetNodeId: 'host-peer',
    bindingId: 'binding-current',
    baseUrls: ['http://192.168.1.20:18777'],
    packageExists: (value) => value.endsWith('manifest-project'),
  });
  assert.deepEqual(result.promotedManifestIds, ['manifest-project']);
  assert.equal(result.store.deliveries['manifest-project'].status, 'queued');
  assert.equal(result.store.deliveries['manifest-project'].bindingId, 'binding-current');
  assert.equal(result.store.deliveries['manifest-other'].status, 'compatibility_queue');
});
