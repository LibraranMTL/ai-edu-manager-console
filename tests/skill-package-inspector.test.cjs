'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectDirectory, parseFrontmatter } = require('../electron/skill-package-inspector.cjs');
const { extractSkillArchive, safeZipPath } = require('../electron/skill-archive-extractor.cjs');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeStoredZip(file, entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [entryName, entryContent] of entries) {
    const name = Buffer.from(entryName, 'utf8');
    const data = Buffer.from(entryContent, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0o100644 * 0x10000, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, centralBytes, end]));
}

function fixture(name = 'safe-skill', description = 'A safe synthetic skill for tests.') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-inspect-'));
  fs.writeFileSync(path.join(root, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\nversion: 1.0.0\n---\n\nOnly answer with synthetic content.\n`);
  return root;
}

test('strict frontmatter accepts scalar and block descriptions but rejects nested ambiguity', () => {
  const parsed = parseFrontmatter('---\nname: demo\ndescription: >\n  first line\n  second line\nallowed-tools:\n  - Read\n  - Grep\n---\nbody');
  assert.equal(parsed.metadata.description, 'first line second line');
  assert.deepEqual(parsed.metadata['allowed-tools'], ['Read', 'Grep']);
  assert.throws(() => parseFrontmatter('---\nname: demo\ndescription:\n  nested: value\n---\nbody'), /嵌套结构|顶层缩进/);
});

test('directory inspection hashes raw bytes and changes on a one-byte change', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'references'));
  fs.writeFileSync(path.join(root, 'references', 'guide.md'), 'A');
  const first = inspectDirectory(root);
  assert.equal(first.inspectionStatus, 'ready_to_archive');
  assert.equal(first.fileCount, 2);
  fs.writeFileSync(path.join(root, 'references', 'guide.md'), 'B');
  const second = inspectDirectory(root);
  assert.notEqual(first.treeSha256, second.treeSha256);
});

test('secrets, binaries and duplicate manifests are blocked without returning secret content', () => {
  const root = fixture('risky');
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=supersecretvalue123456789');
  fs.writeFileSync(path.join(root, 'unsafe.exe'), Buffer.from([0, 1, 2]));
  const inspected = inspectDirectory(root);
  assert.equal(inspected.inspectionStatus, 'quarantined');
  assert.ok(inspected.riskFindings.some(item => item.id === 'secret_filename'));
  assert.ok(inspected.riskFindings.some(item => item.id === 'binary'));
  assert.doesNotMatch(JSON.stringify(inspected.riskFindings), /supersecretvalue/);
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'nested', 'SKILL.md'), '---\nname: nested\ndescription: nested\n---\n');
  assert.throws(() => inspectDirectory(root), /只有一个根级 SKILL\.md/);
});

test('ZIP path normalization blocks traversal, drive paths and absolute paths', () => {
  assert.equal(safeZipPath('skill/SKILL.md'), 'skill/SKILL.md');
  for (const value of ['../SKILL.md', 'skill/../escape', 'C:\\temp\\SKILL.md', '/absolute/SKILL.md', '']) {
    assert.throws(() => safeZipPath(value));
  }
});

test('ZIP extraction accepts a bounded Skill package and rejects traversal before writing outside staging', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-zip-'));
  const staging = path.join(root, 'staging');
  const safeArchive = path.join(root, 'safe.zip');
  writeStoredZip(safeArchive, [['safe/SKILL.md', '---\nname: safe\ndescription: safe zip fixture\n---\nbody\n']]);
  const extracted = await extractSkillArchive(safeArchive, staging);
  assert.equal(path.basename(extracted.contentRoot), 'safe');
  assert.ok(fs.existsSync(path.join(extracted.contentRoot, 'SKILL.md')));

  const maliciousArchive = path.join(root, 'traversal.zip');
  writeStoredZip(maliciousArchive, [['../escaped-SKILL.md', 'blocked']]);
  await assert.rejects(extractSkillArchive(maliciousArchive, staging), /路径越界|invalid relative path/);
  assert.equal(fs.existsSync(path.join(root, 'escaped-SKILL.md')), false);
});
