'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('./windows-runtime-resource-policy.cjs');

const MEDIA_PATTERN = /\.(?:png|jpe?g|webp|gif|svg|ico)$/i;
const TEXT_PATTERN = /\.(?:cjs|mjs|js|jsx|ts|tsx|css|html|json|md)$/i;

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  }
  return result.sort();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function slash(value) {
  return String(value).replaceAll('\\', '/');
}

function auditWindowsResources({ repoRoot, packagedRoot = '', strict = false } = {}) {
  const root = path.resolve(repoRoot || path.join(__dirname, '..'));
  const missingRequiredSourceFiles = policy.REQUIRED_SOURCE_FILES.filter(relative => !fs.existsSync(path.join(root, relative)));
  const textRoots = ['src', 'electron', 'scripts', 'cloud-report-service', 'public', 'course-catalog'];
  const searchable = [path.join(root, 'index.html'), path.join(root, 'package.json'),
    ...textRoots.flatMap(relative => walkFiles(path.join(root, relative)).filter(file => TEXT_PATTERN.test(file)))];
  const sourceText = searchable.filter(file => fs.existsSync(file) && fs.statSync(file).size <= 5 * 1024 * 1024)
    .map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const publicRoot = path.join(root, 'public');
  const media = walkFiles(publicRoot).filter(file => MEDIA_PATTERN.test(file)).map(file => {
    const relative = slash(path.relative(publicRoot, file));
    const repoRelative = `public/${relative}`;
    const required = policy.REQUIRED_SOURCE_FILES.includes(repoRelative);
    const dynamic = policy.DYNAMIC_PUBLIC_RESOURCE_PATTERNS.some(pattern => pattern.test(relative));
    const referenced = required || dynamic || sourceText.includes(relative) || sourceText.includes(path.basename(relative));
    return { path: repoRelative, bytes: fs.statSync(file).size, sha256: sha256(file), referenced, required, dynamic };
  });
  const hashes = new Map();
  for (const item of media) hashes.set(item.sha256, [...(hashes.get(item.sha256) || []), item.path]);
  const duplicateMedia = [...hashes.entries()].filter(([, files]) => files.length > 1)
    .map(([hash, files]) => ({ sha256: hash, files }));
  const unreferencedMediaCandidates = media.filter(item => !item.referenced).map(item => item.path);

  let packaged = null;
  if (packagedRoot) {
    const packageRoot = path.resolve(packagedRoot);
    const missingFiles = policy.REQUIRED_PACKAGED_RESOURCES.filter(relative => !fs.existsSync(path.join(packageRoot, relative)));
    const missingDirectories = policy.REQUIRED_PACKAGED_DIRECTORIES.filter(relative => {
      const absolute = path.join(packageRoot, relative);
      return !fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory() || walkFiles(absolute).length === 0;
    });
    packaged = { root: packageRoot, missingFiles, missingDirectories };
  }

  const failures = [
    ...missingRequiredSourceFiles.map(file => `missing source resource: ${file}`),
    ...(packaged?.missingFiles || []).map(file => `missing packaged resource: ${file}`),
    ...(packaged?.missingDirectories || []).map(file => `missing packaged resource directory: ${file}`),
  ];
  const report = {
    schema: 'edu-manager.windows-resource-audit.v1',
    policyVersion: policy.POLICY_VERSION,
    auditedAt: new Date().toISOString(),
    source: {
      mediaFiles: media.length,
      mediaBytes: media.reduce((sum, item) => sum + item.bytes, 0),
      duplicateMedia,
      unreferencedMediaCandidates,
      missingRequiredFiles: missingRequiredSourceFiles,
    },
    packaged,
    status: failures.length ? 'failed' : 'passed',
    failures,
    boundary: 'Duplicate and unreferenced files are advisory candidates only; this audit never deletes files.',
  };
  if (strict && failures.length) throw Object.assign(new Error(failures.join('; ')), { report });
  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const packagedIndex = args.indexOf('--packaged-root');
  const packagedRoot = packagedIndex >= 0 ? args[packagedIndex + 1] : '';
  const report = auditWindowsResources({ repoRoot: path.join(__dirname, '..'), packagedRoot, strict: args.includes('--strict') });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { auditWindowsResources, walkFiles };
