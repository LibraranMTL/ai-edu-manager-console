'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const args = new Map(process.argv.slice(2).map(entry => {
  const separator = entry.indexOf('=');
  return separator < 0
    ? [entry.replace(/^--/, ''), 'true']
    : [entry.slice(0, separator).replace(/^--/, ''), entry.slice(separator + 1)];
}));
const fixture = path.resolve(String(args.get('fixture') || ''));
if (!fixture) throw new Error('--fixture is required');
const temporaryRoot = path.resolve(os.tmpdir());
const relativeFixture = path.relative(temporaryRoot, fixture);
if (!relativeFixture || relativeFixture === '..' || relativeFixture.startsWith(`..${path.sep}`)
  || path.isAbsolute(relativeFixture) || !path.basename(fixture).startsWith('edu-p0-')) {
  throw new Error('fixture must be an edu-p0-* directory below the system temporary directory');
}
const inbox = path.join(fixture, 'project-data', 'p0-synthetic-project-01', '项目工作空间', '收件箱');
if (!fs.existsSync(inbox)) throw new Error('synthetic project inbox not found');
const sequence = String(args.get('sequence') || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '');
const file = path.join(inbox, `hot-event-${sequence}.md`);
if (fs.existsSync(file)) throw new Error('fixture material already exists');
fs.writeFileSync(file, [
  `# P0 hot event ${sequence}`,
  '',
  'This isolated synthetic material was added after the application became ready.',
  'It verifies workspace-change detection, automatic task reactivation, one Agent execution, and durable knowledge settlement.',
  '',
].join('\n'), 'utf8');
process.stdout.write(`${JSON.stringify({ file, createdAt: new Date().toISOString() })}\n`);

