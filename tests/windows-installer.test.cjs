const test = require('node:test');
const assert = require('node:assert/strict');
const { installerConfig } = require('../scripts/build-windows-installer.cjs');

test('installer retains host identity, uses a wizard and preserves user data', () => {
  const config = installerConfig('0.18.3', 'out', 'icon.ico');
  assert.equal(config.appId, 'com.qxmatrix.edumanager.desktop');
  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.nsis.runAfterFinish, false);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowToChangeInstallationDirectory, false);
  assert.equal(config.nsis.createDesktopShortcut, true);
  assert.equal(config.nsis.createStartMenuShortcut, true);
  assert.equal(config.publish, null);
  assert.equal(config.win.artifactName, 'AI-edu-manager-console-Windows-0.18.3-Setup.${ext}');
});
