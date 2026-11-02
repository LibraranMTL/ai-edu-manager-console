'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const SWITCH = 'practice-print-helper';
const TOKEN_ENV = 'EDU_PRACTICE_PRINT_HELPER_TOKEN';
const JOB_PREFIX = 'edu-practice-print-helper-';
const SOURCE_PREFIX = 'edu-card-export-';

function boundedPrintOptions(input = {}) {
  const copies = Number(input.copies || 1);
  if (!Number.isInteger(copies) || copies < 1 || copies > 99) throw new Error('invalid_print_copies');
  const result = {
    silent: input.silent !== false,
    printBackground: true,
    landscape: Boolean(input.landscape),
    copies,
  };
  if (input.windowsGdi === true) result.windowsGdi = true;
  if (result.silent) {
    const deviceName = String(input.deviceName || '').trim();
    if (!deviceName || deviceName.length > 300) throw new Error('invalid_printer_name');
    result.deviceName = deviceName;
    if (input.usePrinterDefaultPageSize) result.usePrinterDefaultPageSize = true;
    else if (input.pageSize === 'A4' || input.pageSize === 'Letter') result.pageSize = input.pageSize;
    else throw new Error('invalid_print_page_size');
  }
  return result;
}

function inside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function readOwnedFile(file, parent, maximumBytes) {
  if (!path.isAbsolute(file) || !inside(parent, file)) throw new Error('print_helper_path_out_of_scope');
  const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) throw new Error('print_helper_file_invalid');
  return fsp.readFile(file, 'utf8');
}

async function writeResult(file, result) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
  await fsp.rename(temporary, file);
}

async function runPracticePrintHelper({ app, BrowserWindow, jobPath }) {
  const temporaryRoot = path.resolve(app.getPath('temp'));
  const jobDir = path.dirname(path.resolve(jobPath));
  if (!path.basename(jobDir).startsWith(JOB_PREFIX) || !inside(temporaryRoot, jobDir)) throw new Error('print_helper_job_out_of_scope');
  const job = JSON.parse(await readOwnedFile(path.resolve(jobPath), jobDir, 64 * 1024));
  const actualToken = Buffer.from(String(process.env[TOKEN_ENV] || ''));
  const expectedToken = Buffer.from(String(job.token || ''));
  if (actualToken.length < 32 || actualToken.length !== expectedToken.length || !crypto.timingSafeEqual(actualToken, expectedToken)) {
    throw new Error('print_helper_token_invalid');
  }
  const sourceDir = path.dirname(path.resolve(job.sourcePath || ''));
  if (!path.basename(sourceDir).startsWith(SOURCE_PREFIX) || !inside(temporaryRoot, sourceDir)) throw new Error('print_helper_source_out_of_scope');
  await readOwnedFile(path.resolve(job.sourcePath), sourceDir, 16 * 1024 * 1024);
  const options = boundedPrintOptions(job.options);
  let window;
  try {
    window = new BrowserWindow({ show: false, width: 900, height: 700,
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    window.setMenuBarVisibility(false);
    await window.loadFile(path.resolve(job.sourcePath));
    await window.webContents.executeJavaScript('Promise.all([document.fonts.ready,...Array.from(document.images,image=>image.decode())])');
    if (!options.silent) window.show();
    let outcome;
    if (options.windowsGdi) {
      const width = 1240;
      window.setContentSize(width, 1754);
      const height = await window.webContents.executeJavaScript('Math.ceil(Math.max(document.documentElement.scrollHeight,document.body.scrollHeight))');
      if (!Number.isFinite(height) || height < 1 || height > 30_000) throw new Error('print_helper_page_too_long');
      window.setContentSize(width, Math.ceil(height));
      await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const imagePath = path.join(jobDir, 'card.png');
      const image = await window.webContents.capturePage({ x: 0, y: 0, width, height: Math.ceil(height) });
      await fsp.writeFile(imagePath, image.toPNG(), { flag: 'wx', mode: 0o600 });
      let scriptPath = path.join(__dirname, 'practice-print-gdi.ps1');
      if (scriptPath.includes(`${path.sep}app.asar${path.sep}`)) scriptPath = scriptPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
      outcome = await new Promise(resolve => childProcess.execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
        '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-ImagePath', imagePath, '-PrinterName', options.deviceName,
        '-Copies', String(options.copies), '-Orientation', options.landscape ? 'landscape' : 'portrait'],
      { windowsHide: true, timeout: 35_000 }, error => resolve(error
        ? { success: false, reason: error.killed ? 'windows_gdi_timeout' : 'windows_gdi_print_failed', unknown: Boolean(error.killed) }
        : { success: true, reason: '' })));
    } else {
      outcome = await new Promise(resolve => window.webContents.print(options,
        (success, reason) => resolve({ success: Boolean(success), reason: String(reason || '') })));
    }
    await writeResult(path.resolve(job.resultPath), outcome);
    return outcome;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
  }
}

function createIsolatedPrintSubmitter({ app, sourcePath, tempRoot = app.getPath('temp'), timeoutMs = 45_000,
  spawn = childProcess.spawn }) {
  return async function submitPrint(options) {
    const dir = await fsp.mkdtemp(path.join(path.resolve(tempRoot), JOB_PREFIX));
    const jobPath = path.join(dir, 'job.json');
    const resultPath = path.join(dir, 'result.json');
    const userData = path.join(dir, 'profile');
    const token = crypto.randomBytes(32).toString('hex');
    const job = { version: 1, token, sourcePath: path.resolve(sourcePath), resultPath, options: boundedPrintOptions(options) };
    await fsp.mkdir(userData, { recursive: true });
    await fsp.writeFile(jobPath, JSON.stringify(job), { flag: 'wx', mode: 0o600 });
    const development = !app.isPackaged;
    const args = [...(development ? [app.getAppPath()] : []), `--${SWITCH}=${jobPath}`, `--user-data-dir=${userData}`];
    const child = spawn(process.execPath, args, { windowsHide: true, stdio: 'ignore', env: { ...process.env, [TOKEN_ENV]: token } });
    return new Promise(resolve => {
      let finished = false;
      const finish = async result => {
        if (finished) return;
        finished = true;
        clearTimeout(timer); clearInterval(poll);
        try { if (!child.killed) child.kill(); } catch { /* child may already be gone */ }
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
        resolve(result);
      };
      const readResult = async () => {
        try {
          const stat = await fsp.lstat(resultPath);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) throw new Error('print_helper_result_invalid');
          const result = JSON.parse(await fsp.readFile(resultPath, 'utf8'));
          await finish({ success: Boolean(result.success), reason: String(result.reason || ''), ...(result.unknown ? { unknown: true } : {}) });
        } catch (error) {
          if (error.code !== 'ENOENT') await finish({ success: false, reason: error.message || 'print_helper_result_invalid' });
        }
      };
      const poll = setInterval(() => { void readResult(); }, 100);
      const timer = setTimeout(() => { void finish({ success: false, reason: 'printer_response_timeout', unknown: true }); }, timeoutMs);
      child.once('error', error => { void finish({ success: false, reason: error.message || 'print_helper_start_failed' }); });
      child.once('exit', () => { setTimeout(() => { if (!finished) void readResult().then(() => {
        if (!finished) void finish({ success: false, reason: 'print_helper_exited_without_result' });
      }); }, 50); });
    });
  };
}

module.exports = { SWITCH, TOKEN_ENV, boundedPrintOptions, createIsolatedPrintSubmitter, runPracticePrintHelper };
