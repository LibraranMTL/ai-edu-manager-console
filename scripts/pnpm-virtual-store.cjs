'use strict';

const fs = require('node:fs');
const path = require('node:path');

function resolvePnpmVirtualStore(repoRoot) {
  const root = path.resolve(repoRoot);
  const fallback = path.join(root, 'node_modules', '.pnpm');
  const modulesFile = path.join(root, 'node_modules', '.modules.yaml');
  if (!fs.existsSync(modulesFile)) return fallback;
  const source = fs.readFileSync(modulesFile, 'utf8');
  let parsed;
  try { parsed = JSON.parse(source); } catch { /* pnpm normally writes YAML; newer releases may emit JSON. */ }
  if (parsed?.virtualStoreDir) return path.normalize(path.resolve(root, String(parsed.virtualStoreDir)));
  const match = /^\s*virtualStoreDir:\s*(.+?)\s*$/m.exec(source);
  if (!match) return fallback;
  let configured = match[1].trim();
  if (configured.startsWith('"')) configured = JSON.parse(configured);
  else if (configured.startsWith("'")) configured = configured.slice(1, -1).replaceAll("''", "'");
  return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(root, 'node_modules', configured);
}

module.exports = { resolvePnpmVirtualStore };
