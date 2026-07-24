const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  TAILSCALE_WINDOWS_DOWNLOAD_URL,
  findWindowsTailscaleInstall,
  parseUninstallRegistry,
} = require('../electron/windows-tailscale.cjs');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Windows student terminal exposes Tailscale detection, open and official download actions', () => {
  const main = read('electron', 'terminal-main.cjs');
  const preload = read('electron', 'terminal-preload.cjs');
  const ui = read('src', 'terminal-main.tsx');
  const styles = read('src', 'terminal-styles.css');

  assert.match(main, /terminal:get-tailscale-status/);
  assert.match(main, /terminal:open-tailscale/);
  assert.match(main, /terminal:download-tailscale/);
  assert.match(main, /shell\.openPath\(status\.launchPath\)/);
  assert.match(main, /function publicTailscaleStatus/);
  assert.match(main, /status: publicTailscaleStatus\(status\)/);
  assert.match(preload, /getTailscaleStatus/);
  assert.match(preload, /openTailscale/);
  assert.match(preload, /downloadTailscale/);
  assert.match(ui, /Tailscale 远程连接/);
  assert.match(ui, /局域网连接/);
  assert.match(ui, /选择连接方式/);
  assert.match(ui, /connectionMethod="tailscale"/);
  assert.match(ui, /connectionMethod="lan"/);
  assert.match(ui, /重新检测/);
  assert.match(ui, /打开 Tailscale/);
  assert.match(ui, /下载 Tailscale/);
  assert.match(styles, /\.terminal-tailscale-card/);
  assert.match(styles, /\.connection-method-card\.active/);
});

test('Tailscale registry parsing and Windows launch detection retain version and GUI path', () => {
  const entries = parseUninstallRegistry(`
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Tailscale
    DisplayName    REG_SZ    Tailscale
    DisplayVersion    REG_SZ    1.88.1
    DisplayIcon    REG_SZ    "C:\\Program Files\\Tailscale\\tailscale-ipn.exe",0
    InstallLocation    REG_SZ    C:\\Program Files\\Tailscale
`);
  assert.equal(entries.length, 1);
  const status = findWindowsTailscaleInstall({
    registryEntries: entries,
    existsSync: (candidate) => candidate === 'C:\\Program Files\\Tailscale\\tailscale-ipn.exe',
    homeDir: 'C:\\Users\\Student',
    env: { Path: '' },
  });
  assert.equal(status.installed, true);
  assert.equal(status.canOpen, true);
  assert.equal(status.version, '1.88.1');
  assert.equal(status.launchPath, 'C:\\Program Files\\Tailscale\\tailscale-ipn.exe');
});

test('missing Tailscale remains a simple optional state with the official Windows download page', () => {
  const status = findWindowsTailscaleInstall({
    registryEntries: [],
    existsSync: () => false,
    homeDir: 'C:\\Users\\Student',
    env: { Path: '' },
  });
  assert.equal(status.installed, false);
  assert.equal(status.canOpen, false);
  assert.equal(status.downloadUrl, TAILSCALE_WINDOWS_DOWNLOAD_URL);
  assert.equal(status.downloadUrl, 'https://tailscale.com/download/windows');
});
