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

const APP_VERSION = '0.1.0';

let mainWindow = null;

function recordsPath() {
  return path.join(app.getPath('userData'), 'license-records.json');
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
    const record = issueLicense(recordsPath(), input || {});
    clipboard.writeText(record.code);
    event.returnValue = ok({ record, records: filteredRecords(''), message: '已生成授权码，并复制到剪贴板。' });
  } catch (error) {
    event.returnValue = fail(error);
  }
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
