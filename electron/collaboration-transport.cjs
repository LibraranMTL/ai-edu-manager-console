const fs = require('node:fs');
const path = require('node:path');
const { ensureCollaborationLayout } = require('./collaboration-sync.cjs');
const {
  buildCollaborationPackage,
  discoverCollaborationPackages,
  rebuildCollaborationImportLedger,
  scanAndImportCollaborationPackages,
} = require('./collaboration-runtime.cjs');

const COLLABORATION_TRANSPORT_SCHEMA = 'edu-manager.collaboration-transport.v1';
const SYNCTHING_COMPAT_TRANSPORT_ID = 'syncthing_compat';

function resolveRootPath(provider) {
  const value = typeof provider === 'function' ? provider() : provider;
  const rootPath = String(value || '').trim();
  if (!rootPath) throw new Error('知识协作传输目录尚未配置。');
  return path.resolve(rootPath);
}

function normalizeTransportDescriptor(input = {}) {
  return {
    schema: COLLABORATION_TRANSPORT_SCHEMA,
    id: String(input.id || '').trim(),
    label: String(input.label || '').trim(),
    kind: String(input.kind || 'compatibility'),
    defaultTransport: Boolean(input.defaultTransport),
    externalSyncRequired: Boolean(input.externalSyncRequired),
    supportsOfflineQueue: Boolean(input.supportsOfflineQueue),
    supportsResume: Boolean(input.supportsResume),
    available: input.available !== false,
    message: String(input.message || ''),
  };
}

function assertCollaborationTransport(transport) {
  const requiredMethods = [
    'describe',
    'ensureNode',
    'getLayout',
    'sendPackage',
    'receivePackages',
    'discoverPackages',
    'rebuildIndex',
  ];
  if (!transport || !transport.id) throw new Error('知识协作传输适配器缺少 ID。');
  for (const method of requiredMethods) {
    if (typeof transport[method] !== 'function') {
      throw new Error(`知识协作传输适配器缺少 ${method}。`);
    }
  }
  return transport;
}

function createSyncthingCompatTransport(options = {}) {
  const rootPathProvider = options.rootPathProvider || options.rootPath;
  const root = () => resolveRootPath(rootPathProvider);
  const adapter = {
    id: SYNCTHING_COMPAT_TRANSPORT_ID,
    describe(context = {}) {
      const nodeId = String(context.nodeId || '').trim();
      const rootPath = root();
      const layout = nodeId ? ensureCollaborationLayout(rootPath, nodeId) : null;
      return normalizeTransportDescriptor({
        id: SYNCTHING_COMPAT_TRANSPORT_ID,
        label: 'Syncthing 高级兼容',
        kind: 'compatibility',
        defaultTransport: false,
        externalSyncRequired: true,
        supportsOfflineQueue: true,
        supportsResume: false,
        available: fs.existsSync(rootPath),
        message: '当前版本继续兼容受控交换目录；后续局域网直传启用后，本适配器只作为高级回退。',
        ...context.descriptor,
        rootPath,
        layout,
      });
    },
    ensureNode(nodeId) {
      return ensureCollaborationLayout(root(), nodeId);
    },
    getLayout(nodeId) {
      return ensureCollaborationLayout(root(), nodeId);
    },
    sendPackage(input = {}) {
      return buildCollaborationPackage(root(), input);
    },
    receivePackages(options = {}) {
      return scanAndImportCollaborationPackages(root(), options);
    },
    discoverPackages(targetNodeId, options = {}) {
      return discoverCollaborationPackages(root(), targetNodeId, options);
    },
    rebuildIndex(options = {}) {
      return rebuildCollaborationImportLedger(root(), options);
    },
  };
  return assertCollaborationTransport(adapter);
}

function createCollaborationTransport(options = {}) {
  const transportId = String(options.transportId || SYNCTHING_COMPAT_TRANSPORT_ID);
  if (transportId !== SYNCTHING_COMPAT_TRANSPORT_ID) {
    throw new Error(`尚不支持知识协作传输适配器：${transportId}`);
  }
  return createSyncthingCompatTransport(options);
}

module.exports = {
  COLLABORATION_TRANSPORT_SCHEMA,
  SYNCTHING_COMPAT_TRANSPORT_ID,
  assertCollaborationTransport,
  createCollaborationTransport,
  createSyncthingCompatTransport,
  normalizeTransportDescriptor,
};
