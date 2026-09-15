const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  deliveryBackoffMs,
  dueDeliveries,
  latestDeliveryForLineages,
  normalizeDeliveryStore,
  reconcileDeliveries,
  recoverInterruptedDeliveries,
  summarizeDeliveries,
} = require('../electron/collaboration-direct-queue.cjs');
const {
  excludeLocalDirectEndpoints,
  selectDirectDeliveryError,
} = require('../electron/collaboration-direct-peer.cjs');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('reliable queue restores interrupted transfers and applies bounded exponential backoff', () => {
  assert.equal(deliveryBackoffMs(1), 15_000);
  assert.equal(deliveryBackoffMs(2), 30_000);
  assert.equal(deliveryBackoffMs(99), 300_000);
  const recovered = recoverInterruptedDeliveries({
    deliveries: {
      a: { manifestId: 'a', status: 'transferring', packageRoot: 'A' },
      b: { manifestId: 'b', status: 'paused', packageRoot: 'B' },
      c: { manifestId: 'c', status: 'delivered', packageRoot: 'C' },
    },
  });
  assert.equal(recovered.deliveries.a.status, 'retry_waiting');
  assert.equal(recovered.deliveries.b.status, 'paused');
  assert.equal(recovered.deliveries.c.status, 'delivered');
});

test('reliable queue only schedules due non-paused deliveries and summarizes state', () => {
  const now = Date.parse('2026-07-25T12:00:00.000Z');
  const store = normalizeDeliveryStore({
    deliveries: {
      due: { manifestId: 'due', status: 'retry_waiting', nextAttemptAt: '2026-07-25T11:59:00.000Z' },
      later: { manifestId: 'later', status: 'retry_waiting', nextAttemptAt: '2026-07-25T12:10:00.000Z' },
      paused: { manifestId: 'paused', status: 'paused' },
      delivered: { manifestId: 'delivered', status: 'delivered' },
    },
  });
  assert.deepEqual(dueDeliveries(store, now).map((item) => item.manifestId), ['due']);
  assert.deepEqual(summarizeDeliveries(store), {
    total: 4,
    queued: 2,
    transferring: 0,
    paused: 1,
    failed: 0,
    delivered: 1,
    cancelled: 0,
    invalid: 0,
    superseded: 0,
  });
});

test('student archive status selects the newest package for the exact lineage', () => {
  const latest = latestDeliveryForLineages({
    deliveries: {
      old: { manifestId: 'old', lineageId: 'student-a', packageKind: '学生知识档案同步', packageCreatedAt: '2026-09-08T01:00:00.000Z', status: 'delivered' },
      current: { manifestId: 'current', lineageId: 'student-a', packageKind: '学生知识档案同步', packageCreatedAt: '2026-09-09T01:00:00.000Z', status: 'retry_waiting', attempt: 3 },
      project: { manifestId: 'project', lineageId: 'student-a', packageKind: '项目发布', packageCreatedAt: '2026-09-10T01:00:00.000Z', status: 'queued' },
      other: { manifestId: 'other', lineageId: 'student-b', packageKind: '学生知识档案同步', packageCreatedAt: '2026-09-11T01:00:00.000Z', status: 'queued' },
    },
  }, ['student-a'], { packageKind: '学生知识档案同步' });
  assert.equal(latest.manifestId, 'current');
  assert.equal(latest.status, 'retry_waiting');
  assert.equal(latest.attempt, 3);
});

test('invalid packages are isolated and older project publications are superseded automatically', () => {
  const reconciled = reconcileDeliveries({
    deliveries: {
      invalid: { manifestId: 'invalid', status: 'queued', targetNodeId: 'peer', packageRoot: '' },
      old: { manifestId: 'old', status: 'queued', targetNodeId: 'peer', packageRoot: 'old' },
      latest: { manifestId: 'latest', status: 'queued', targetNodeId: 'peer', packageRoot: 'latest' },
      other: { manifestId: 'other', status: 'queued', targetNodeId: 'peer', packageRoot: 'other' },
    },
  }, {
    inspectPackage(record) {
      if (record.manifestId === 'invalid') return { valid: false, error: 'missing package' };
      if (record.manifestId === 'other') {
        return { valid: true, displayName: '另一项目', lineageId: 'lineage-other', publicationVersion: 1 };
      }
      return {
        valid: true,
        displayName: '同一项目',
        lineageId: 'lineage-project',
        publicationVersion: record.manifestId === 'latest' ? 2 : 1,
      };
    },
  });
  assert.deepEqual(reconciled.invalidManifestIds, ['invalid']);
  assert.deepEqual(reconciled.supersededManifestIds, ['old']);
  assert.equal(reconciled.store.deliveries.invalid.status, 'invalid');
  assert.equal(reconciled.store.deliveries.old.status, 'superseded');
  assert.equal(reconciled.store.deliveries.old.supersededBy, 'latest');
  assert.equal(reconciled.store.deliveries.latest.status, 'queued');
  assert.equal(reconciled.store.deliveries.latest.displayName, '同一项目');
  assert.deepEqual(
    dueDeliveries(reconciled.store).map((item) => item.manifestId).sort(),
    ['latest', 'other'],
  );
  assert.equal(summarizeDeliveries(reconciled.store).queued, 2);
  assert.equal(summarizeDeliveries(reconciled.store).invalid, 1);
  assert.equal(summarizeDeliveries(reconciled.store).superseded, 1);
});

test('direct delivery excludes local endpoints and preserves the meaningful network failure', () => {
  assert.deepEqual(excludeLocalDirectEndpoints(
    [
      'http://192.168.3.17:18777',
      'http://169.254.83.107:18777',
      'http://26.219.93.130:18777',
    ],
    [
      'http://192.168.3.55:18777',
      'http://169.254.83.107:18777',
    ],
  ), [
    'http://192.168.3.17:18777',
    'http://26.219.93.130:18777',
  ]);
  const selected = selectDirectDeliveryError([
    new Error('直传请求超时。'),
    new Error('协作包发送方或目标主机不匹配。'),
  ]);
  assert.equal(selected.message, '直传请求超时。');
  assert.match(
    selectDirectDeliveryError([new Error('协作包发送方或目标主机不匹配。')]).message,
    /已忽略指向本机或其他主机的旧协作地址/,
  );
});

test('D2 routes expose resumable chunks, persistent monitor and user queue controls', () => {
  assert.match(main, /handleCollaborationDirectChunk/);
  assert.match(main, /supportsResume: true/);
  assert.match(main, /startDirectDeliveryMonitor\(\)/);
  assert.match(main, /updateDirectDeliveryStatus\(manifestId, action\)/);
  assert.match(preload, /updateDirectDeliveryStatus\(manifestId, action\)/);
  assert.match(renderer, /发送队列/);
  assert.match(renderer, /等待网络恢复/);
  assert.match(renderer, /已自动隔离/);
  assert.match(renderer, /已被新版本替代/);
  assert.match(renderer, /delivery\.displayName/);
  assert.doesNotMatch(renderer, /directDeliveries \?\? \[\]\)\.slice\(0, 12\)/);
  assert.match(main, /从接收端断点恢复/);
  assert.match(main, /发送任务自身异常，已隔离并继续处理后续任务/);
  assert.match(main, /excludeLocalDirectEndpoints/);
  assert.match(main, /requestCollaborationPeerDiscovery\(true\)/);
  assert.match(main, /tailscaleOnlinePeerEndpoints/);
  assert.match(main, /refreshCollaborationPeerEndpoints\(record\.targetNodeId\)/);
  assert.match(main, /collaborationNodeId: collaborationState\.node\.nodeId/);
});
