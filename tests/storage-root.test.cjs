const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const {
  resolveConfiguredStoragePath,
  resolveStudentBaseDir,
  windowsVolumeAvailable,
} = require('../electron/storage-root.cjs');

test('Windows student storage falls back to Documents when D drive is absent', () => {
  const existsSync = (candidate) => String(candidate).toUpperCase() === 'C:\\';
  const result = resolveStudentBaseDir({
    configured: '',
    platform: 'win32',
    documentsDir: 'C:\\Users\\teacher\\Documents',
    homeDir: 'C:\\Users\\teacher',
    existsSync,
  });
  assert.equal(result, path.join('C:\\Users\\teacher\\Documents', '学生资料'));
});

test('legacy D drive default remains compatible when D drive exists', () => {
  const result = resolveStudentBaseDir({
    platform: 'win32',
    documentsDir: 'C:\\Users\\teacher\\Documents',
    existsSync: (candidate) => String(candidate).toUpperCase() === 'D:\\',
  });
  assert.equal(result, 'D:\\学生资料');
});

test('configured C drive takeover directory is preserved', () => {
  const configured = 'C:\\Users\\teacher\\Documents\\New project';
  const result = resolveStudentBaseDir({
    configured,
    platform: 'win32',
    documentsDir: 'C:\\Users\\teacher\\Documents',
    existsSync: (candidate) => String(candidate).toUpperCase() === 'C:\\',
  });
  assert.equal(result, configured);
});

test('stale D drive settings and collaboration roots fall back safely', () => {
  const fallback = 'C:\\Users\\teacher\\Documents\\学生资料\\.edu-manager\\collaboration';
  const existsSync = (candidate) => String(candidate).toUpperCase() === 'C:\\';
  assert.equal(windowsVolumeAvailable('D:\\学生资料', existsSync), false);
  assert.equal(resolveConfiguredStoragePath('D:\\学生资料\\.edu-manager\\collaboration', fallback, {
    platform: 'win32',
    existsSync,
  }), fallback);
});
