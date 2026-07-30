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
  mergeOpenAiToolInstall,
  normalizeOpenAiDesktopPackage,
};
