const path = require('path');

function windowsVolumeAvailable(candidate, existsSync) {
  const value = String(candidate || '').trim();
  if (!value) return false;
  if (!path.win32.isAbsolute(value)) return true;
  const root = path.win32.parse(value).root;
  return Boolean(root && existsSync(root));
}

function windowsUserProfileMismatch(candidate, homeDir) {
  const value = String(candidate || '').trim();
  const home = String(homeDir || '').trim();
  if (!value || !home || !path.win32.isAbsolute(value) || !path.win32.isAbsolute(home)) return false;
  const resolvedValue = path.win32.resolve(value);
  const resolvedHome = path.win32.resolve(home);
  const profilesRoot = path.win32.dirname(resolvedHome);
  const relativeToProfiles = path.win32.relative(profilesRoot, resolvedValue);
  const relativeToHome = path.win32.relative(resolvedHome, resolvedValue);
  const insideProfilesRoot = relativeToProfiles === ''
    || (!relativeToProfiles.startsWith(`..${path.win32.sep}`) && relativeToProfiles !== '..' && !path.win32.isAbsolute(relativeToProfiles));
  const insideCurrentHome = relativeToHome === ''
    || (!relativeToHome.startsWith(`..${path.win32.sep}`) && relativeToHome !== '..' && !path.win32.isAbsolute(relativeToHome));
  return insideProfilesRoot && !insideCurrentHome;
}

function resolveStudentBaseDir(options = {}) {
  const platform = String(options.platform || process.platform);
  const configured = String(options.configured || '').trim();
  const documentsDir = String(options.documentsDir || '').trim();
  const homeDir = String(options.homeDir || '').trim();
  const existsSync = typeof options.existsSync === 'function' ? options.existsSync : () => false;
  const fallback = path.join(documentsDir || path.join(homeDir, 'Documents'), '学生资料');

  if (configured && (
    platform !== 'win32'
    || (
      windowsVolumeAvailable(configured, existsSync)
      && !windowsUserProfileMismatch(configured, homeDir)
    )
  )) {
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

function storagePathKey(key) {
  const value = String(key || '');
  return value === 'path'
    || value === 'rootPathLabel'
    || /(Path|Dir|Root|Folder)$/.test(value);
}

function rebaseStoragePath(candidate, sourceRoot, targetRoot, options = {}) {
  const value = String(candidate || '').trim();
  const source = String(sourceRoot || '').trim();
  const target = String(targetRoot || '').trim();
  if (!value || !source || !target) return value;
  const platform = String(options.platform || process.platform);
  const pathApi = platform === 'win32' ? path.win32 : path;
  if (!pathApi.isAbsolute(value) || !pathApi.isAbsolute(source) || !pathApi.isAbsolute(target)) return value;
  const relative = pathApi.relative(pathApi.resolve(source), pathApi.resolve(value));
  if (relative && (relative === '..' || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative))) return value;
  return relative ? pathApi.join(pathApi.resolve(target), relative) : pathApi.resolve(target);
}

function remapStorageTree(input, sourceRoot, targetRoot, options = {}) {
  let changed = 0;
  const visit = (value, key = '') => {
    if (typeof value === 'string') {
      if (!storagePathKey(key)) return value;
      const next = rebaseStoragePath(value, sourceRoot, targetRoot, options);
      if (next !== value) changed += 1;
      return next;
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, key));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      visit(childValue, childKey),
    ]));
  };
  return { value: visit(input), changed };
}

function adoptedStorageRootCandidates(student = {}, options = {}) {
  const platform = String(options.platform || process.platform);
  const pathApi = platform === 'win32' ? path.win32 : path;
  const explicitRoots = [student.rootPath, student.rootPathLabel]
    .map((value) => String(value || '').trim())
    .filter((value) => value && pathApi.isAbsolute(value));
  const parentCounts = new Map();
  for (const value of [student.rawPath, student.summaryPath, student.agentPath, student.outputPath]) {
    const candidate = String(value || '').trim();
    if (!candidate || !pathApi.isAbsolute(candidate)) continue;
    const parent = pathApi.dirname(pathApi.resolve(candidate));
    const key = platform === 'win32' ? parent.toLowerCase() : parent;
    const current = parentCounts.get(key) || { path: parent, count: 0 };
    current.count += 1;
    parentCounts.set(key, current);
  }
  const inferredRoots = Array.from(parentCounts.values())
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count)
    .map((item) => item.path);
  const seen = new Set();
  return [...inferredRoots, ...explicitRoots].filter((value) => {
    const resolved = pathApi.resolve(value);
    const key = platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function remapStorageTreeFromRoots(input, sourceRoots, targetRoot, options = {}) {
  let value = input;
  let changed = 0;
  for (const sourceRoot of Array.isArray(sourceRoots) ? sourceRoots : []) {
    const result = remapStorageTree(value, sourceRoot, targetRoot, options);
    value = result.value;
    changed += result.changed;
  }
  return { value, changed };
}

module.exports = {
  adoptedStorageRootCandidates,
  rebaseStoragePath,
  remapStorageTree,
  remapStorageTreeFromRoots,
  resolveConfiguredStoragePath,
  resolveStudentBaseDir,
  storagePathKey,
  windowsVolumeAvailable,
  windowsUserProfileMismatch,
};
