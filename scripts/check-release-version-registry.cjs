const path = require('node:path');
const { collectVersionRegistryViolations } = require('./release-version-registry.cjs');

const root = path.resolve(__dirname, '..');
const violations = collectVersionRegistryViolations(root);
if (violations.length) {
  process.stderr.write(`Release version registry check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Release version registry check passed.\n');
}
