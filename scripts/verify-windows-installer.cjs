const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(item => {
    const file = path.join(root, item.name);
    return item.isDirectory() ? files(file) : [file];
  });
}
function verify(auditPath) {
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  if (sha(audit.installer.path) !== audit.installer.sha256) throw new Error('Installer checksum mismatch');
  if (sha(audit.sourcePortable.path) !== audit.sourcePortable.sha256) throw new Error('Accepted portable checksum mismatch');
  const cache = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', '7zip@1.0.0');
  const sevenZip = fs.readdirSync(cache).map(name => path.join(cache, name, 'bin', '7za.exe')).find(file => fs.existsSync(file));
  if (!sevenZip) throw new Error('7za.exe not found');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-installer-verify-'));
  function extract(archive, name) {
    const dir = path.join(temporary, name);
    const result = spawnSync(sevenZip, ['x', archive, `-o${dir}`, '-y'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(`Cannot extract ${archive}: ${result.stderr}`);
    return dir;
  }
  const original = extract(audit.sourcePortable.path, 'accepted');
  const wrapper = extract(audit.installer.path, 'setup');
  let installed = wrapper;
  // Current 7za can directly recognize the embedded application archive.
  if (!fs.existsSync(path.join(wrapper, 'resources', 'app.asar'))) {
    const payloads = files(wrapper).filter(file => file.endsWith('.7z'));
    if (payloads.length !== 1) throw new Error(`Expected one x64 payload, found ${payloads.length}`);
    installed = extract(payloads[0], 'installed-payload');
  }
  const acceptedFiles = files(original);
  for (const file of acceptedFiles) {
    const relative = path.relative(original, file);
    const target = path.join(installed, relative);
    if (!fs.existsSync(target) || sha(file) !== sha(target)) throw new Error(`Payload mismatch: ${relative}`);
  }
  if (sha(path.join(installed, 'resources', 'app.asar')) !== audit.runtimeAsarSha256) throw new Error('ASAR mismatch');
  const result = { version: audit.version, installerSha256: audit.installer.sha256,
    verifiedAt: new Date().toISOString(), identicalAcceptedRuntimeFiles: acceptedFiles.length,
    exactRuntimePayloadMatch: true, method: 'extract-and-compare-every-accepted-file',
    installerWizardExecuted: false, temporary };
  fs.writeFileSync(path.join(path.dirname(auditPath), 'payload-verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
try {
  if (!process.argv[2]) throw new Error('Pass installer-audit.json');
  verify(path.resolve(process.argv[2]));
} catch (error) { console.error(error); process.exitCode = 1; }
