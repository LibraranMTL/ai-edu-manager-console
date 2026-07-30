const path = require('path');

function windowsVolumeAvailable(candidate, existsSync) {
  const value = String(candidate || '').trim();
  if (!value) return false;
  if (!path.win32.isAbsolute(value)) return true;
  const root = path.win32.parse(value).root;
  return Boolean(root && existsSync(root));
}

function resolveStudentBaseDir(options = {}) {
  const platform = String(options.platform || process.platform);
  const configured = String(options.configured || '').trim();
  const documentsDir = String(options.documentsDir || '').trim();
  const homeDir = String(options.homeDir || '').trim();
  const existsSync = typeof options.existsSync === 'function' ? options.existsSync : () => false;
  const fallback = path.join(documentsDir || path.join(homeDir, 'Documents'), '学生资料');

  if (configured && (platform !== 'win32' || windowsVolumeAvailable(configured, existsSync))) {
    return configured;
  }
  if (platform !== 'win32') return fallback;

  const legacyDefault = 'D:\\学生资料';
  return windowsVolumeAvailable(legacyDefault, existsSync) ? legacyDefault : fallback;
}

function resolveConfiguredStoragePath(configured, fallback, options = {}) {
  const value = String(configured || '').trim();
  if (!value) return fallback;
  if (String(options.platform || process.platform) !== 'win32') return value;
  const existsSync = typeof options.existsSync === 'function' ? options.existsSync : () => false;
  return windowsVolumeAvailable(value, existsSync) ? value : fallback;
}

module.exports = {
  resolveConfiguredStoragePath,
  resolveStudentBaseDir,
  windowsVolumeAvailable,
};
