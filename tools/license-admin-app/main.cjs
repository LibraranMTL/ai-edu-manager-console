const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  issueLicense,
  listRecords,
  filterRecords,
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
let onlineAdmin;
function activationAdmin() {
  if (!onlineAdmin) onlineAdmin=require('./activation-admin.cjs').createActivationAdmin({rootDir:app.getPath('userData'),
    protect: value=>{if(!safeStorage.isEncryptionAvailable())throw Error('本机安全存储不可用，不能保存兑换码');return safeStorage.encryptString(value).toString('base64');},
    unprotect:value=>safeStorage.decryptString(Buffer.from(value,'base64'))});
  return onlineAdmin;
}
ipcMain.handle('license:activation',async (_event,action,input={})=>{
  try {
    const admin=activationAdmin();
    if(action==='loginLocal') {
      const file=path.join(process.env.LOCALAPPDATA,'AI-Education-Manager/activation-ops/admin.enc');
      if(!fs.existsSync(file))throw Error('本机未配置运维登录凭据，请使用管理员密码登录');
      const dpapi=require(app.isPackaged?path.join(process.resourcesPath,'windows-protected-data.cjs'):'../../electron/windows-protected-data.cjs');
      return ok(await admin.login(dpapi.unprotectString(fs.readFileSync(file,'utf8'))));
    }
    if(action==='login') return ok(await admin.login(input.password));
    if(action==='local') return ok({rows:admin.listLocal()});
    if(action==='create') return ok(await admin.create(input));
    if(action==='retry') return ok(await admin.register(input.id));
    if(action==='list') return ok(await admin.list());
    if(action==='activations') return ok(await admin.activations());
    if(action==='status') return ok(await admin.status());
    if(action==='reveal') return ok(admin.reveal(input.id));
    if(action==='action') return ok(await admin.action(input.id,input.action));
    if(action==='export') {
      const csv=admin.exportBatch(input.id);
      const target=dialog.showSaveDialogSync(mainWindow,{title:'导出完整兑换码，请保管销售交付文件',defaultPath:path.join(app.getPath('downloads'),`激活码-${input.id}.csv`),filters:[{name:'CSV',extensions:['csv']}]});
      if(!target)return ok({cancelled:true}); fs.writeFileSync(target,csv,'utf8'); return ok({message:'已导出销售交付清单。'});
    }
    throw Error('不支持的兑换码管理操作');
  } catch(error) {return fail(error);}
});

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
  return filterRecords(listRecords(recordsPath()), query);
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
    const normalized = { ...(input || {}), schema: 'edu-manager.license.v3' };
    const active = keyManager().readPrivateKey('license_signing');
    const options = { forceV3: true, privateKey: active.privateKey, keyId: active.record.keyId, publicKeyFingerprint: active.record.fingerprint };
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

ipcMain.on('license:saveQr', (event, dataUrl, suggestedName) => {
  try {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!match) throw new Error('二维码图片格式无效。');
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length < 8 || bytes.length > 5 * 1024 * 1024) throw new Error('二维码图片为空或超过 5 MB。');
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!bytes.subarray(0, 8).equals(pngSignature)) throw new Error('二维码图片不是有效 PNG。');
    const safeName = String(suggestedName || 'AI教育管家-License-v3-二维码')
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
      .replace(/[. ]+$/g, '')
      .slice(0, 100) || 'AI教育管家-License-v3-二维码';
    const target = dialog.showSaveDialogSync(mainWindow, {
      title: '保存 License v3 二维码',
      defaultPath: path.join(app.getPath('downloads'), `${safeName}.png`),
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    if (!target) {
      event.returnValue = ok({ cancelled: true, message: '已取消保存二维码。' });
      return;
    }
    fs.writeFileSync(target, bytes);
    event.returnValue = ok({ path: target, message: 'License v3 二维码已保存。' });
  } catch (error) {
    event.returnValue = fail(error);
  }
});

ipcMain.on('license:validateCode', (event, code) => {
  try {
    const active = keyManager().readPrivateKey('license_signing');
    event.returnValue = JSON.stringify(parseLicenseCode(code, { privateKey: active.privateKey, keyId: active.record.keyId }));
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
