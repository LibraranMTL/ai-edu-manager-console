const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const rawTag = String(process.argv[2] || '').trim();
const tag = rawTag.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
if (!tag || tag !== rawTag) throw new Error('请提供仅含字母、数字、点、下划线或连字符的云端候选标识。');

const outputRoot = path.join(repoRoot, 'release', 'cloud', 'candidates', tag);
const packageRoot = path.join(outputRoot, 'package');
if (fs.existsSync(outputRoot)) throw new Error(`云端候选目录已存在，拒绝覆盖：${outputRoot}`);

const productionFiles = [
  'backup-scheduler.cjs',
  'backup.cjs',
  'document-stream.cjs',
  'http.cjs',
  'maintenance.cjs',
  'material-indexer.cjs',
  'material-index-worker.cjs',
  'migration-preview.cjs',
  'model-gateway-pilot.cjs',
  'model-gateway-runtime.cjs',
  'product-license.cjs',
  'public-content.cjs',
  'remote-mcp.cjs',
  'remote-result-contract.cjs',
  'service.cjs',
  'trusted-license-issuers.json',
  'v2-contract.cjs',
];

// The cloud process runs outside the Electron installation and therefore
// cannot rely on the repository node_modules tree. Keep this list limited to
// modules loaded by the isolated material-index worker; transitive production
// dependencies are discovered from each package manifest below.
const runtimeModules = Object.freeze([
  'pdfjs-dist',
  'saxes',
  'yauzl',
]);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}${signal ? ` (${signal})` : ''}`));
    });
  });
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listFiles(root, current = root) {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(current, entry.name);
    return entry.isDirectory() ? listFiles(root, absolute) : [absolute];
  }).sort((a, b) => a.localeCompare(b));
}

function copyCloudWebBundle(sourceRoot, destinationRoot) {
  const indexPath = path.join(sourceRoot, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const files = new Set(['index.html']);
  for (const match of indexHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const reference = String(match[1] || '').replace(/^\.\//, '');
    if (!reference || reference.startsWith('/') || /^[a-z]+:/i.test(reference) || reference.includes('..')) continue;
    files.add(reference.split(/[?#]/, 1)[0]);
  }
  for (const relativePath of files) {
    const sourcePath = path.resolve(sourceRoot, relativePath);
    if (!sourcePath.startsWith(`${path.resolve(sourceRoot)}${path.sep}`) && sourcePath !== path.resolve(sourceRoot, 'index.html')) {
      throw new Error(`云端网页引用越界：${relativePath}`);
    }
    if (!fs.statSync(sourcePath).isFile()) throw new Error(`云端网页引用缺失：${relativePath}`);
    const destinationPath = path.join(destinationRoot, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
  return [...files].sort();
}

function copyDirectory(sourceRoot, destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    const stat = fs.statSync(source);
    if (stat.isDirectory()) copyDirectory(fs.realpathSync(source), destination);
    else if (stat.isFile()) fs.copyFileSync(source, destination);
    else throw new Error(`云端运行依赖包含不支持的文件类型：${source}`);
  }
}

function copyRuntimeModule(name, requesterRoot, copied) {
  if (copied.has(name)) return;
  const manifestPath = require.resolve(`${name}/package.json`, { paths: [requesterRoot, repoRoot] });
  const sourceRoot = fs.realpathSync(path.dirname(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const destinationRoot = path.join(packageRoot, 'node_modules', ...name.split('/'));
  fs.mkdirSync(path.dirname(destinationRoot), { recursive: true });
  copyDirectory(sourceRoot, destinationRoot);
  copied.add(name);
  for (const dependency of Object.keys(manifest.dependencies || {}).sort()) {
    copyRuntimeModule(dependency, sourceRoot, copied);
  }
}

async function main() {
  const webDist = path.join(repoRoot, 'cloud-report-service', 'web-dist');
  if (!fs.existsSync(path.join(webDist, 'index.html'))) {
    throw new Error('云端网页尚未构建；请通过 build:cloud-candidate 脚本生成候选。');
  }

  fs.mkdirSync(packageRoot, { recursive: true });
  for (const filename of productionFiles) {
    const source = path.join(repoRoot, 'cloud-report-service', filename);
    if (!fs.statSync(source).isFile()) throw new Error(`缺少云端生产文件：${source}`);
    fs.copyFileSync(source, path.join(packageRoot, filename));
  }
  const copiedRuntimeModules = new Set();
  for (const name of runtimeModules) copyRuntimeModule(name, repoRoot, copiedRuntimeModules);
  // Copy only the current bundle graph. Vite's external outDir can retain old
  // hashed chunks; packaging those unreachable files needlessly grows releases.
  copyCloudWebBundle(webDist, path.join(packageRoot, 'web-dist'));

  // Refuse to produce a candidate that can only run from inside the source
  // checkout. This catches missing production modules before upload.
  await run(process.execPath, ['-e', `const path=require('node:path');
    const root=process.cwd()+path.sep+'node_modules'+path.sep;
    for(const name of ${JSON.stringify(runtimeModules)}){
      const resolved=require.resolve(name+'/package.json',{paths:[process.cwd()]});
      if(!resolved.startsWith(root)) throw new Error('runtime module escaped package: '+name);
    }
    require('./material-index-worker.cjs');`], {
    cwd: packageRoot,
  });

  const manifest = listFiles(packageRoot).map((filePath) => ({
    path: path.relative(packageRoot, filePath).split(path.sep).join('/'),
    bytes: fs.statSync(filePath).size,
    sha256: sha256(filePath),
  }));
  const manifestPath = path.join(outputRoot, 'release-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    candidateTag: tag,
    version: JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version,
    createdAt: new Date().toISOString(),
    formalRelease: false,
    files: manifest,
  }, null, 2)}\n`, 'utf8');

  const archiveName = `edu-cloud-documents-${tag}.tar.gz`;
  const archivePath = path.join(outputRoot, archiveName);
  await run('tar.exe', ['-czf', archivePath, '-C', packageRoot, '.']);
  const summary = {
    candidateTag: tag,
    packageDirectory: packageRoot,
    archive: archivePath,
    archiveBytes: fs.statSync(archivePath).size,
    archiveSha256: sha256(archivePath),
    manifest: manifestPath,
    manifestSha256: sha256(manifestPath),
    fileCount: manifest.length,
    runtimeModules: [...copiedRuntimeModules].sort(),
    formalRelease: false,
  };
  fs.writeFileSync(path.join(outputRoot, 'candidate-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
