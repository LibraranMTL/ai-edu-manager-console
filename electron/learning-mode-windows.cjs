'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { DEFAULT_RULES, rootPath, readJson, activeSources } = require('./learning-mode-rules.cjs');

const run = promisify(execFile);
const HOST = 'com.qxmatrix.learning_mode';
const REGISTRY_RUN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const BROWSERS = {
  edge: { label: 'Edge', page: 'edge://extensions/', application: 'Microsoft/Edge/Application/msedge.exe',
    registration: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\' + HOST },
  chrome: { label: 'Chrome', page: 'chrome://extensions/', application: 'Google/Chrome/Application/chrome.exe',
    registration: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + HOST },
};

function source(name) {
  const location = path.join(__dirname, name);
  const unpacked = location.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  return fs.existsSync(unpacked) ? unpacked : location;
}
function writeJson(file, value) {
  const pending = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(pending, JSON.stringify(value));
  fs.renameSync(pending, file);
}
async function reg(args) {
  return run('reg.exe', args, { windowsHide: true, timeout: 5000 });
}
const launcherBuilds = new Map();
async function ensureLauncher(root, filename = 'learning-mode-native-host-v2', codeName = 'learning-mode-native-host.cs') {
  const file = path.join(root, filename + '.exe');
  if (fs.existsSync(file)) return file;
  if (launcherBuilds.has(file)) return launcherBuilds.get(file);
  const build = (async () => {
    const code = path.join(root, codeName);
    fs.copyFileSync(source(codeName), code);
    const framework = path.join(process.env.WINDIR, 'Microsoft.NET');
    const compiler = ['Framework64', 'Framework'].map(folder => path.join(framework, folder, 'v4.0.30319', 'csc.exe')).find(candidate => fs.existsSync(candidate));
    if (!compiler) throw Error('未找到 Windows .NET Framework 运行组件。');
    const pending = path.join(root, filename + '-' + process.pid + '.exe');
    try {
      await run(compiler, ['/nologo', '/codepage:65001', '/target:winexe', '/out:' + pending, code], { windowsHide: true, timeout: 20_000 });
      try { fs.renameSync(pending, file); } catch (error) { if (!fs.existsSync(file)) throw error; }
      return file;
    } finally { fs.rmSync(pending, { force: true }); }
  })();
  launcherBuilds.set(file, build);
  try { return await build; } finally { launcherBuilds.delete(file); }
}
async function installWindowsWorker(role, { registerLogin = true } = {}) {
  if (process.platform !== 'win32') throw Error('仅支持在 Windows 设备上安装应用管控组件。');
  if (process.env.PORTABLE_EXECUTABLE_FILE) throw Error('请使用 Windows 安装版开启管控，以便在重新登录后恢复。');
  const root = rootPath();
  const dir = path.join(root, role);
  fs.mkdirSync(dir, { recursive: true });
  const bridge = await ensureLauncher(root);
  const workerScript = path.join(dir, 'learning-mode-worker.cjs');
  for (const name of ['learning-mode-rules.cjs', 'learning-mode-worker.cjs', 'learning-mode-processes.ps1']) {
    fs.copyFileSync(source(name), path.join(dir, name));
  }

  const runtimeExe = process.execPath;
  writeJson(path.join(dir, 'installation.json'), { runtimeExe });
  fs.writeFileSync(path.join(dir, 'runtime.txt'), runtimeExe, 'utf8');
  if (registerLogin) {
    const command = '"' + bridge + '" worker ' + role;
    await reg(['add', REGISTRY_RUN, '/v', 'QXMatrixLearningMode_' + role, '/t', 'REG_SZ', '/d', command, '/f']);
  }

  const child = spawn(runtimeExe, [workerScript, 'worker', role], {
    windowsHide: true, detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  child.on('error', () => {});
  child.unref();
  return bridge;
}

async function installBrowserConnection(role, browser) {
  if (!Object.hasOwn(BROWSERS, browser)) throw Error('请选择 Edge 或 Chrome。');
  const bridge = await installWindowsWorker(role);
  const root = rootPath();
  const extensionPath = path.join(root, 'browser-extension');
  fs.mkdirSync(extensionPath, { recursive: true });
  for (const name of ['manifest.json', 'background.js', 'blocked.html', 'popup.html', 'popup.js']) {
    const data = fs.readFileSync(path.join(__dirname, 'learning-mode-extension', name));
    fs.writeFileSync(path.join(extensionPath, name), data);
  }
  for (const name of ['learning-mode-browser-setup.html', 'learning-mode-browser-setup.js']) {
    fs.copyFileSync(source(name), path.join(root, name));
  }
  const manifest = path.join(root, HOST + '.json');
  const key = readJson(path.join(extensionPath, 'manifest.json')).key;
  const extension = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, hex => String.fromCharCode(97 + parseInt(hex, 16)));
  writeJson(manifest, {
    name: HOST, description: 'AI教育管家专注模式', path: bridge, type: 'stdio',
    allowed_origins: ['chrome-extension://' + extension + '/'],
  });
  await reg(['add', BROWSERS[browser].registration, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f']);
  return extensionPath;
}

async function openBrowserSetupGuide(browser) {
  if (!Object.hasOwn(BROWSERS, browser)) throw Error('请选择 Edge 或 Chrome。');
  const { application } = BROWSERS[browser];
  const executable = [process.env.ProgramW6432, process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => path.join(root, application)).find(file => fs.existsSync(file));
  if (!executable) return { opened: false, assist: false };
  const root = rootPath();
  const guide = pathToFileURL(path.join(root, 'learning-mode-browser-setup.html'));
  guide.searchParams.set('browser', browser);
  const helper = await ensureLauncher(root, 'learning-mode-folder-assist-v1', 'learning-mode-folder-assist.cs').catch(() => '');
  let assist = false;
  if (helper) {
    const marker = randomBytes(8).toString('hex');
    assist = await spawnDetached(helper, [browser, marker], true);
    if (assist) guide.searchParams.set('setup', marker);
  }
  const opened = await spawnDetached(executable, [guide.href]);
  return { opened, assist: opened && assist };
}

function spawnDetached(executable, args, windowsHide = false) {
  return new Promise(resolve => {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide });
    child.once('error', () => resolve(false));
    child.once('spawn', () => { child.unref(); resolve(true); });
  });
}

function windowsStatus(role) {
  const root = rootPath();
  const extensionPath = path.join(root, 'browser-extension');
  const worker = readJson(path.join(root, role, 'status.json'), {});
  const now = Date.now();
  const recently = value => Number(value) > now - 20_000;
  const coverage = Object.keys(BROWSERS).filter(name => recently(readJson(path.join(root, name + '-browser.json'))?.at));
  return {
    worker: recently(worker.at) && worker.ready === true,
    workerOnline: recently(worker.at),
    lastError: recently(worker.at) ? worker.lastError : '',
    coverage,
    browserExtensionPath: fs.existsSync(path.join(extensionPath, 'manifest.json')) ? extensionPath : '',
    apps: (worker.apps || []).slice(0, 50),
    events: (worker.events || []).slice(0, 16),
  };
}
function currentPolicy() {
  return activeSources(rootPath());
}

module.exports = { BROWSERS, DEFAULT_RULES, writeJson, installWindowsWorker, installBrowserConnection, openBrowserSetupGuide, windowsStatus, currentPolicy };
