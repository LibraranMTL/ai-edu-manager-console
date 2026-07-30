const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function manifestImportComplete(manifest, ledger, options = {}) {
  const exists = typeof options.exists === 'function'
    ? options.exists
    : (filePath) => {
      try { return fs.existsSync(filePath) && fs.statSync(filePath).isFile(); } catch { return false; }
    };
  if (!manifest?.manifestId || ledger?.manifests?.[manifest.manifestId]?.status !== 'imported') return false;
  return (Array.isArray(manifest.files) ? manifest.files : []).every((file) => {
    const known = ledger?.objects?.[file.objectId];
    return Boolean(
      known
      && String(known.sha256 || '').toLowerCase() === String(file.sha256 || '').toLowerCase()
      && known.importedPath
      && exists(known.importedPath)
    );
  });
}

function compactPackagePayload(packageRoot, options = {}) {
  const root = path.resolve(String(packageRoot || ''));
  const manifest = options.manifest || {};
  const terminalAt = Date.parse(String(options.terminalAt || ''));
  const now = Number(options.now || Date.now());
  const retentionMs = Math.max(0, Number(options.retentionMs ?? DEFAULT_RETENTION_MS));
  const contentRoot = path.resolve(root, 'content');
  if (
    !root
    || !manifest?.manifestId
    || !Number.isFinite(terminalAt)
    || now - terminalAt < retentionMs
    || path.dirname(contentRoot) !== root
    || !fs.existsSync(contentRoot)
    || !fs.statSync(contentRoot).isDirectory()
  ) return { compacted: false };
  fs.rmSync(contentRoot, { recursive: true, force: true });
  const marker = {
    schema: 'edu-manager.collaboration-payload-compaction.v1',
    manifestId: String(manifest.manifestId),
    fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
    compactedAt: new Date(now).toISOString(),
    reason: String(options.reason || 'verified_terminal_transfer'),
  };
  fs.writeFileSync(path.join(root, 'PAYLOAD-COMPACTED.json'), JSON.stringify(marker, null, 2), 'utf8');
  return { compacted: true, marker };
}

module.exports = {
  DEFAULT_RETENTION_MS,
  compactPackagePayload,
  manifestImportComplete,
};
