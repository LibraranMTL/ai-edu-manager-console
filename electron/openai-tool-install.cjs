function normalizeOpenAiDesktopPackage(input = {}) {
  const installLocation = String(input.InstallLocation || input.installLocation || '').trim();
  const appPath = String(input.AppPath || input.appPath || '').trim();
  return {
    installed: Boolean(installLocation || appPath),
    version: String(input.Version || input.version || '').trim(),
    appPath,
    installLocation,
  };
}

function parseCodexCliVersion(value) {
  const match = String(value || '').match(/(?:codex-cli\s+)?v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/i);
  if (!match) return null;
  return {
    raw: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: String(match[4] || ''),
  };
}

function compareCodexCliVersions(left, right) {
  const a = typeof left === 'string' ? parseCodexCliVersion(left) : left;
  const b = typeof right === 'string' ? parseCodexCliVersion(right) : right;
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function selectNewestCodexCliCandidate(candidates = []) {
  return candidates
    .filter((candidate) => candidate?.path && parseCodexCliVersion(candidate.version))
    .sort((left, right) => compareCodexCliVersions(right.version, left.version))[0] || null;
}

function mergeOpenAiToolInstall(cliInstall = {}, desktopInstall = {}) {
  const desktop = normalizeOpenAiDesktopPackage(desktopInstall);
  const cliInstalled = Boolean(cliInstall.installed && cliInstall.exePath);
  return {
    installed: Boolean(cliInstall.installed || desktop.installed),
    version: desktop.version || String(cliInstall.version || ''),
    exePath: cliInstalled ? String(cliInstall.exePath || '') : '',
    appPath: desktop.appPath,
    installLocation: desktop.installLocation || String(cliInstall.installLocation || ''),
    cliInstalled,
    desktopInstalled: desktop.installed,
  };
}

module.exports = {
  compareCodexCliVersions,
  mergeOpenAiToolInstall,
  normalizeOpenAiDesktopPackage,
  parseCodexCliVersion,
  selectNewestCodexCliCandidate,
};
