const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { countProjectFiles } = require('../electron/project-file-count.cjs');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');

test('dashboard file counts include nested files but skip manager and dependency folders', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-startup-count-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '资料', '子目录'), { recursive: true });
  fs.mkdirSync(path.join(root, '.edu-manager'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(root, '资料', 'a.pdf'), 'A');
  fs.writeFileSync(path.join(root, '资料', '子目录', 'b.md'), 'B');
  fs.writeFileSync(path.join(root, '.edu-manager', 'index.json'), '{}');
  fs.writeFileSync(path.join(root, 'node_modules', 'package.json'), '{}');

  assert.equal(await countProjectFiles(root), 2);
  fs.writeFileSync(path.join(root, '资料', 'new.txt'), 'new');
  assert.equal(await countProjectFiles(root), 3);
  assert.equal(await countProjectFiles(path.join(root, 'missing')), 0);
});

test('project dashboard uses async directory counts and leaves content hashes to import flows', () => {
  const getProjects = main.slice(main.indexOf('async function getProjects()'), main.indexOf('function createProject(', main.indexOf('async function getProjects()')));
  assert.match(getProjects, /await countProjectFiles\(project\.rawPath\)/);
  assert.match(getProjects, /knowledgeFileCount \+= await countProjectFiles\(dir\)/);
  assert.doesNotMatch(getProjects, /collectProjectRawFiles|sha1File/);
  assert.match(main, /function collectProjectRawFiles\(rawPath\)[\s\S]*?sha1: sha1File\(fullPath\)/);
  assert.match(main, /function deferredInvoke\(handler\)[\s\S]*?Promise\.resolve\(\)\.then\(handler\)\.then\(resolve/);
});

test('startup skips unchanged template and student writes and probes Agents only when authorized', () => {
  const templates = main.slice(main.indexOf('function writeTemplateFiles('), main.indexOf('function readTemplateFiles('));
  assert.match(templates, /fs\.readFileSync\(file, 'utf8'\) === content/);
  const syncStudents = main.slice(main.indexOf('function syncStudentsIndex('), main.indexOf('function findStudentByKey(', main.indexOf('function syncStudentsIndex(')));
  assert.match(syncStudents, /!isDeepStrictEqual\(students, currentStudents\)/);
  assert.match(syncStudents, /createdAt: student\.createdAt \|\| existing\?\.createdAt/);
  const reconcile = main.slice(main.indexOf('function reconcileAuthorizedLifecycleAdapters('), main.indexOf('function startAgentLifecycleInstallMonitor('));
  assert.ok(reconcile.indexOf('descriptor?.lifecycleCapture?.enabled !== true') < reconcile.indexOf('currentLifecycleInstallFingerprint(options)'));
});

test('initial host status does not block on the Tailscale DNS process', () => {
  const dns = main.slice(main.indexOf('let tailscaleDnsUrlCache ='), main.indexOf('function getHostConnectionMode('));
  assert.match(dns, /spawn\('tailscale\.exe', \['status', '--json'\]/);
  assert.match(dns, /notify\('onNativeHostServiceChanged', getHostServiceStatus\(\)\)/);
  assert.doesNotMatch(dns, /spawnSync\(/);
});
