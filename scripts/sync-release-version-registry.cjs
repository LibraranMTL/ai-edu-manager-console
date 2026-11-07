const path = require('node:path');
const { loadRegistry, synchronizeReleaseVersionFiles, collectVersionRegistryViolations } = require('./release-version-registry.cjs');

const root = path.resolve(__dirname, '..');
const registry = loadRegistry(root);
const changed = synchronizeReleaseVersionFiles(root, registry, { write: true });
const violations = collectVersionRegistryViolations(root, registry);
if (violations.length) {
  process.stderr.write(`Release version registry synchronization failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(changed.length ? `Synchronized release version files: ${changed.join(', ')}\n` : 'Release version files already synchronized.\n');
}
