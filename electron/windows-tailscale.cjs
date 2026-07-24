const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TAILSCALE_WINDOWS_DOWNLOAD_URL = 'https://tailscale.com/download/windows';

function normalizeRegistryPath(value = '') {
  return String(value)
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/,\s*-?\d+$/, '')
    .replace(/^"(.*)"$/, '$1')
    .trim();
}

function parseUninstallRegistry(text = '') {
  const entries = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*HKEY_/i.test(line)) {
      if (current) entries.push(current);
      current = { registryKey: line.trim() };
      continue;
    }
    const match = line.match(/^\s*(DisplayName|DisplayVersion|DisplayIcon|InstallLocation)\s+REG_\w+\s+(.*)$/i);
    if (!match || !current) continue;
    current[match[1]] = match[2].trim();
  }
  if (current) entries.push(current);
  return entries.filter((entry) => /tailscale/i.test(`${entry.DisplayName || ''} ${entry.DisplayIcon || ''} ${entry.InstallLocation || ''}`));
}

function queryTailscaleRegistry(execFileSync = childProcess.execFileSync) {
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const entries = [];
  for (const key of keys) {
    try {
      const output = execFileSync('reg.exe', ['query', key, '/s'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      entries.push(...parseUninstallRegistry(output));
    } catch {
      // Missing registry hives and locked entries are normal on some Windows editions.
    }
  }
  return entries;
}

function candidateLaunchPaths({ homeDir = os.homedir(), env = process.env, registryEntries = [] } = {}) {
  const roots = [
    'C:\\Program Files\\Tailscale',
    'C:\\Program Files (x86)\\Tailscale',
    path.join(homeDir, 'AppData', 'Local', 'Tailscale'),
    path.join(homeDir, 'AppData', 'Local', 'Programs', 'Tailscale'),
    ...registryEntries.map((entry) => normalizeRegistryPath(entry.InstallLocation)).filter(Boolean),
  ];
  const registryIcons = registryEntries.map((entry) => normalizeRegistryPath(entry.DisplayIcon)).filter(Boolean);
  const pathRoots = String(env.Path || env.PATH || '').split(path.delimiter).filter(Boolean);
  const startMenuPaths = [
    path.join(env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Tailscale.lnk'),
    path.join(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Tailscale.lnk'),
  ];
  const uniqueRoots = [...new Set(roots.concat(pathRoots).filter(Boolean))];
  return [...new Set([
    ...registryIcons,
    ...uniqueRoots.map((root) => path.join(root, 'tailscale-ipn.exe')),
    ...startMenuPaths,
    ...uniqueRoots.map((root) => path.join(root, 'tailscale.exe')),
    ...uniqueRoots.map((root) => path.join(root, 'Tailscale.exe')),
  ])];
}

function findWindowsTailscaleInstall(options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  const registryEntries = options.registryEntries || queryTailscaleRegistry(options.execFileSync);
  const launchPath = candidateLaunchPaths({
    homeDir: options.homeDir,
    env: options.env,
    registryEntries,
  }).find((candidate) => {
    try { return existsSync(candidate); } catch { return false; }
  }) || '';
  const registryEntry = registryEntries[0] || {};
  return {
    installed: Boolean(launchPath || registryEntries.length),
    canOpen: Boolean(launchPath),
    version: String(registryEntry.DisplayVersion || ''),
    launchPath,
    installLocation: normalizeRegistryPath(registryEntry.InstallLocation) || (launchPath ? path.dirname(launchPath) : ''),
    downloadUrl: TAILSCALE_WINDOWS_DOWNLOAD_URL,
  };
}

module.exports = {
  TAILSCALE_WINDOWS_DOWNLOAD_URL,
  candidateLaunchPaths,
  findWindowsTailscaleInstall,
  normalizeRegistryPath,
  parseUninstallRegistry,
  queryTailscaleRegistry,
};
