'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const {
  DEFAULT_RULES, active, rulesFrom, activeSources, blockedBy, applicationDecision,
} = require('../electron/learning-mode-rules.cjs');
const { installCourseGuards } = require('../electron/course-browser.cjs');

function setup(t) {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-mode-'));
  t.after(() => fs.rmSync(local, { recursive: true, force: true }));
  const root = path.join(local, 'QXMatrix', 'LearningMode');
  const source = (role, state) => {
    fs.mkdirSync(path.join(root, role), { recursive: true });
    fs.writeFileSync(path.join(root, role, 'installation.json'), JSON.stringify({ runtimeExe: process.execPath }));
    fs.writeFileSync(path.join(root, role + '.json'), JSON.stringify({
      enabled: true, pauseUntil: 0, revision: 1, rules: DEFAULT_RULES, ...state,
    }));
  };
  return { local, root, source };
}

test('scope changes survive reading a new instance and leave the other Windows client active', t => {
  const { root, source } = setup(t);
  const now = 50_000;
  source('host', { pauseUntil: now + 2000 });
  source('student', { rules: { ...DEFAULT_RULES, websites: ['example.org'] } });
  assert.equal(active({ enabled: true, pauseUntil: now + 2000 }, now), false);
  assert.deepEqual(activeSources(root, now).map(item => item.role), ['student']);
  assert.equal(blockedBy('https://example.org/page', activeSources(root, now)).role, 'student');
  assert.equal(blockedBy('https://www.bilibili.com/', activeSources(root, now)), null);
  assert.deepEqual(activeSources(root, now + 2000).map(item => item.role), ['host', 'student']);
  fs.writeFileSync(path.join(root, 'host', 'installation.json'), JSON.stringify({ runtimeExe: path.join(root, 'uninstalled.exe') }));
  assert.deepEqual(activeSources(root, now + 2000).map(item => item.role), ['student']);
});

test('course exception is page-specific and cannot suppress a second client’s policy', () => {
  const book = 'https://www.bilibili.com/video/BVexample';
  const host = { role: 'host', rules: rulesFrom({ ...DEFAULT_RULES, allowedUrls: [book] }) };
  const student = { role: 'student', rules: DEFAULT_RULES };
  assert.equal(blockedBy(book + '#time', [host]), null);
  assert.equal(blockedBy(book + '/extra', [host]).role, 'host');
  assert.equal(blockedBy(book, [host, student]).role, 'student');
  assert.equal(blockedBy('https://bilibili.com.example.org/', [host, student]), null);
  assert.throws(() => rulesFrom({ ...DEFAULT_RULES, websites: ['*.bilibili.com'] }), /域名/);
  assert.throws(() => rulesFrom({ ...DEFAULT_RULES, allowedUrls: ['https://user:pw@example.org/'] }), /HTTPS/);
});

test('application matching requires positive identity and respects education exceptions', () => {
  const steam = { file: 'steam.exe', hash: 'a'.repeat(64), signer: 'Valve Corp.', signatureValid: true, product: 'Steam' };
  assert.equal(applicationDecision(steam, DEFAULT_RULES), 'block');
  assert.equal(applicationDecision({ ...steam, signer: 'Unknown' }, DEFAULT_RULES), 'review');
  assert.equal(applicationDecision({ ...steam, signatureValid: false }, DEFAULT_RULES), 'review');
  assert.equal(applicationDecision(steam, { ...DEFAULT_RULES, allowedApps: [steam.hash], blockedApps: [steam.hash] }), 'allow');
  assert.equal(applicationDecision({ file: 'lesson.exe', product: 'Unity Player', hash: 'b'.repeat(64) }, DEFAULT_RULES), 'review');
  assert.equal(applicationDecision({ file: 'reader.exe', product: 'Course Reader', hash: 'c'.repeat(64) }, DEFAULT_RULES), 'allow');
});

test('course guard keeps signed-course boundaries and adds learning mode to redirects', () => {
  const view = new EventEmitter();
  view.setWindowOpenHandler = handler => { view.open = handler; };
  view.loadURL = () => { throw Error('Blocked window should not load'); };
  const session = new EventEmitter();
  session.setPermissionRequestHandler = () => {};
  session.setPermissionCheckHandler = () => {};
  const seen = [];
  const guard = installCourseGuards(view, { allowedHosts: ['www.bilibili.com'] }, session,
    rejected => seen.push(rejected), page => page.endsWith('/blocked'));
  assert.equal(guard(null, 'https://www.bilibili.com/course'), true);
  assert.equal(guard(null, 'https://other.example/course'), false);
  assert.deepEqual(view.open({ url: 'https://www.bilibili.com/blocked' }), { action: 'deny' });
  const event = { preventDefault: () => { event.rejected = true; } };
  view.emit('will-redirect', event, 'https://www.bilibili.com/blocked');
  assert.equal(event.rejected, true);
  assert.equal(seen.at(-1).code, 'LEARNING_MODE_BLOCKED');
});

test('native messaging uses framed JSON and publishes removal of only the expired source', { timeout: 5000 }, async t => {
  const { local, source } = setup(t);
  source('host', {});
  source('student', {});
  const child = spawn(process.execPath, [path.resolve(__dirname, '../electron/learning-mode-worker.cjs'), 'browser'], {
    env: { ...process.env, LOCALAPPDATA: local }, stdio: ['pipe', 'pipe', 'inherit'],
  });
  t.after(() => child.kill());
  const payload = Buffer.from(JSON.stringify({ action: 'connect' }));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  let received = Buffer.alloc(0);
  const messages = [];
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', () => { if (messages.length < 2) reject(Error('Host exited before replying twice')); });
    child.stdout.on('data', chunk => {
      received = Buffer.concat([received, chunk]);
      while (received.length >= 4 && received.length >= 4 + received.readUInt32LE()) {
        const size = received.readUInt32LE(0);
        messages.push(JSON.parse(received.subarray(4, 4 + size)));
        received = received.subarray(4 + size);
        if (messages.length === 1) source('host', { enabled: false });
        if (messages.length === 2) resolve();
      }
    });
    child.stdin.write(header.subarray(0, 2));
    child.stdin.write(Buffer.concat([header.subarray(2), payload]));
  });
  assert.deepEqual(messages.map(message => message.sources.map(item => item.role)), [['host', 'student'], ['student']]);
  assert.equal(Object.hasOwn(messages[0].sources[0].rules, 'blockedApps'), false);
  child.stdin.end();
});

test('browser rules survive native disconnect and clear after a fresh inactive policy', async () => {
  const listen = () => ({ addListener() {} });
  const channels = [];
  let reconnect;
  let rules = [];
  const context = vm.createContext({
    URL,
    navigator: { userAgent: 'Chrome' },
    setTimeout: callback => { reconnect = callback; },
    clearTimeout() {},
    setInterval() {},
    clearInterval() {},
    chrome: {
      runtime: {
        getURL: file => file,
        connectNative() {
          const channel = {
            onMessage: { addListener(handler) { channel.message = handler; } },
            onDisconnect: { addListener(handler) { channel.disconnect = handler; } },
            postMessage() {},
          };
          channels.push(channel);
          return channel;
        },
        onMessage: listen(),
        onStartup: listen(),
        onInstalled: listen(),
      },
      declarativeNetRequest: {
        getDynamicRules: async () => rules,
        updateDynamicRules: async ({ removeRuleIds, addRules }) => {
          rules = [...rules.filter(rule => !removeRuleIds.includes(rule.id)), ...addRules];
        },
      },
      tabs: { query: async () => [] },
      action: { setBadgeText: async () => {} },
      webNavigation: { onHistoryStateUpdated: listen(), onCommitted: listen() },
      alarms: { onAlarm: listen(), create() {} },
    },
  });
  const worker = fs.readFileSync(path.join(__dirname, '../electron/learning-mode-extension/background.js'), 'utf8');
  vm.runInContext(worker, context);

  channels[0].message({ sources: [{ rules: { websites: ['example.org'], allowedUrls: [] } }] });
  await vm.runInContext('queue', context);
  assert.equal(rules[0].condition.requestDomains[0], 'example.org');

  channels[0].disconnect();
  await vm.runInContext('queue', context);
  assert.equal(rules.length, 1);

  reconnect();
  channels[1].message({ sources: [] });
  await vm.runInContext('queue', context);
  assert.equal(rules.length, 0);
});
