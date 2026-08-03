const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  issueLicense,
  listRecords,
  updateRecord,
  recordsToCsv,
  parseLicenseCode,
} = require('./license-core.cjs');
const keyManagerModulePath = app.isPackaged
  ? path.join(process.resourcesPath, 'platform-key-manager.cjs')
  : path.join(__dirname, '..', '..', 'electron', 'platform-key-manager.cjs');
const { createPlatformKeyManager } = require(keyManagerModulePath);

const APP_VERSION = require('./package.json').version;

let mainWindow = null;

function recordsPath() {
  return path.join(app.getPath('userData'), 'license-records.json');
}

function keyManager() {
  return createPlatformKeyManager({ rootDir: path.join(app.getPath('userData'), 'platform-license-keys') });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    title: 'AI教育管家授权管理工具',
    backgroundColor: '#f6f8f7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function ok(payload = {}) {
  return JSON.stringify({ ok: true, ...payload });
}

function fail(error) {
  return JSON.stringify({ ok: false, message: error?.message || String(error || '操作失败') });
}

function filteredRecords(query = '') {
  const keyword = String(query || '').trim().toLowerCase();
  const records = listRecords(recordsPath());
  if (!keyword) return records;
  return records.filter((record) => [
    record.customerName,
    record.contact,
    record.orderNo,
    record.plan,
    record.planLabel,
    record.status,
    record.code,
    record.note,
  ].some((value) => String(value || '').toLowerCase().includes(keyword)));
}

ipcMain.on('license:getAppInfo', (event) => {
  event.returnValue = ok({
    version: APP_VERSION,
    recordsPath: recordsPath(),
  });
});

ipcMain.on('license:listRecords', (event, query) => {
  try {
    event.returnValue = ok({ records: filteredRecords(query) });
  } catch (error) {
    event.returnValue = fail(error);
  }
});

ipcMain.on('license:issue', (event, input) => {
  try {
    const normalized = input || {};
    const options = String(normalized.plan || '').toUpperCase() === 'PLATFORM'
      ? (() => {
        const active = keyManager().readPrivateKey('license_signing');
        return { privateKey: active.privateKey, keyId: active.record.keyId, publicKeyFingerprint: active.record.fingerprint };
      })()
      : {};
    const record = issueLicense(recordsPath(), normalized, options);
    clipboard.writeText(record.code);
    event.returnValue = ok({ record, records: filteredRecords(''), message: '已生成授权码，并复制到剪贴板。' });
  } catch (error) {
    event.returnValue = fail(error);
  }
});

ipcMain.handle('license:keyStatus', async () => {
  try { return ok({ keyStore: keyManager().list() }); } catch (error) { return fail(error); }
});

ipcMain.handle('license:createPlatformKey', async (_event, keyId) => {
  try {
    const record = keyManager().createKey({ purpose: 'license_signing', keyId });
    return ok({ record, keyStore: keyManager().list(), message: '新的平台 License RSA 3072 密钥对已创建并设为当前签发密钥。' });
  } catch (error) { return fail(error); }
});

ipcMain.handle('license:importPlatformKey', async (_event, keyId) => {
  try {
    const selected = dialog.showOpenDialogSync(mainWindow, { title: '选择平台 License PKCS#8 私钥', properties: ['openFile'], filters: [{ name: 'PEM 私钥', extensions: ['pem', 'key'] }] });
    if (!selected?.[0]) return ok({ cancelled: true, message: '已取消导入。' });
    const record = keyManager().importPrivateKey({ purpose: 'license_signing', keyId, filePath: selected[0] });
    return ok({ record, keyStore: keyManager().list(), message: '私钥已完成公私钥匹配和签名挑战，并设为当前签发密钥。' });
  } catch (error) { return fail(error); }
});

ipcMain.handle('license:selectPlatformKey', async (_event, keyId) => {
  try {
    const record = keyManager().selectActive('license_signing', keyId);
    return ok({ record, keyStore: keyManager().list(), message: '当前平台 License 签发密钥已切换。' });
  } catch (error) { return fail(error); }
});

ipcMain.handle('license:exportTrustBundle', async () => {
  try {
    const target = dialog.showSaveDialogSync(mainWindow, { title: '导出可信 License 签发方公钥包', defaultPath: path.join(app.getPath('downloads'), 'AI教育管家-License可信签发方.aie-trust.json'), filters: [{ name: '可信公钥包', extensions: ['json'] }] });
    if (!target) return ok({ cancelled: true, message: '已取消导出。' });
    const bundle = keyManager().exportTrustBundle({ purposes: ['license_signing'], outputPath: target });
    return ok({ path: target, bundle: { ...bundle, keys: bundle.keys.map(({ publicKey: _publicKey, ...item }) => item) }, message: '可信 License 签发方公钥包已导出；其中不包含私钥。' });
  } catch (error) { return fail(error); }
});

ipcMain.handle('license:createKeyBackup', async (_event, password) => {
  try {
    const target = dialog.showSaveDialogSync(mainWindow, { title: '创建平台 License 密钥加密备份', defaultPath: path.join(app.getPath('downloads'), `AI教育管家-平台License密钥备份-${new Date().toISOString().slice(0, 10)}.aiekeys`), filters: [{ name: '加密密钥备份', extensions: ['aiekeys'] }] });
    if (!target) return ok({ cancelled: true, message: '已取消备份。' });
    const backup = keyManager().createEncryptedBackup({ outputPath: target, password });
    return ok({ backup, message: '加密备份已创建。请复制到 BitLocker To Go 介质，并把恢复密码分开保管。' });
  } catch (error) { return fail(error); }
});

ipcMain.handle('license:restoreKeyBackup', async (_event, password, drill) => {
  try {
    const selected = dialog.showOpenDialogSync(mainWindow, { title: drill ? '选择密钥备份执行恢复演练' : '选择要恢复的密钥备份', properties: ['openFile'], filters: [{ name: '加密密钥备份', extensions: ['aiekeys'] }] });
    if (!selected?.[0]) return ok({ cancelled: true, message: '已取消恢复。' });
    const result = keyManager().restoreEncryptedBackup({ filePath: selected[0], password, drill: Boolean(drill) });
    return ok({ result, keyStore: keyManager().list(), message: drill ? '恢复演练通过，密钥已完成签名挑战。' : '密钥已恢复并完成签名挑战。' });
  } catch (error) { return fail(error); }
});

ipcMain.handle('license:revokePlatformKey', async (_event, keyId, reason) => {
  try {
    const record = keyManager().revoke(keyId, reason);
    return ok({ record, keyStore: keyManager().list(), message: '密钥已停止用于新 License 签发；请立即发布新的可信公钥包。' });
  } catch (error) { return fail(error); }
});

ipcMain.on('license:updateRecordStatus', (event, id, status) => {
  try {
    const record = updateRecord(recordsPath(), id, { status });
    if (!record) {
      event.returnValue = ok({ message: '未找到记录。', records: filteredRecords('') });
      return;
    }
    event.returnValue = ok({ record, records: filteredRecords(''), message: '记录状态已更新。' });
  } catch (error) {
    event.returnValue = fail(error);
  }
});

ipcMain.on('license:copyText', (event, text) => {
  clipboard.writeText(String(text || ''));
  event.returnValue = ok({ message: '已复制。' });
});

ipcMain.on('license:validateCode', (event, code) => {
  try {
    event.returnValue = JSON.stringify(parseLicenseCode(code));
  } catch (error) {
    event.returnValue = fail(error);
  }
});

ipcMain.on('license:exportCsv', (event, query) => {
  try {
    const records = filteredRecords(query);
    const target = dialog.showSaveDialogSync(mainWindow, {
      title: '导出授权记录 CSV',
      defaultPath: path.join(app.getPath('downloads'), `AI教育管家授权记录-${new Date().toISOString().slice(0, 10)}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!target) {
      event.returnValue = ok({ cancelled: true, message: '已取消导出。' });
      return;
    }
    fs.writeFileSync(target, `\uFEFF${recordsToCsv(records)}`, 'utf8');
    event.returnValue = ok({ path: target, count: records.length, message: `已导出 ${records.length} 条记录。` });
  } catch (error) {
    event.returnValue = fail(error);
  }
});

ipcMain.on('license:exportJson', (event, query) => {
  try {
    const records = filteredRecords(query);
    const target = dialog.showSaveDialogSync(mainWindow, {
      title: '导出授权记录 JSON',
      defaultPath: path.join(app.getPath('downloads'), `AI教育管家授权记录-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!target) {
      event.returnValue = ok({ cancelled: true, message: '已取消导出。' });
      return;
    }
    fs.writeFileSync(target, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2), 'utf8');
    event.returnValue = ok({ path: target, count: records.length, message: `已导出 ${records.length} 条记录。` });
  } catch (error) {
    event.returnValue = fail(error);
  }
});

ipcMain.on('license:openRecordsFolder', (event) => {
  try {
    fs.mkdirSync(path.dirname(recordsPath()), { recursive: true });
    shell.openPath(path.dirname(recordsPath()));
    event.returnValue = ok();
  } catch (error) {
    event.returnValue = fail(error);
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
