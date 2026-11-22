'use strict';

const by = id => document.getElementById(id);
const bridge = window.learningMode;
let revision = -1;
let preset = '';
let preview = '';
let recoveryCode = '';
let busy = false;
let browserSetup;

async function command(action, input) {
  if (busy) return;
  busy = true;
  try {
    const result = await bridge.command(action, input);
    if (!result) return;
    by('message').textContent = result.message || '';
    if (result.browserSetup) {
      browserSetup = result.browserSetup;
      by('browser-page').value = browserSetup.page;
      by('browser-page-guide').hidden = false;
    }
    if (result.browserMessage) by('browser-message').textContent = result.browserMessage;
    if (result.state) render(result.state);
    if (result.recovery) {
      recoveryCode = result.recovery;
      by('recovery').hidden = false;
      by('recovery').textContent = '请单独保存恢复码。此处只显示一次。 ' + recoveryCode;
    }
    if (result.answer) by('answer').textContent = result.answer;
    if (result.preview) preview = result.preview;
    by('agent-apply').hidden = !preview;
  } catch (error) {
    by('message').textContent = error.message.replace(/^.*Error: /, '');
  } finally { busy = false; }
}
function render(state) {
  by('state').textContent = state.paused ? '已暂停 · 剩余 ' + Math.ceil(state.remainingMs / 1000) + ' 秒' : state.enabled ? '已开启' : '已关闭';
  const coverage = state.coverage.map(name => name === 'edge' ? 'Edge' : 'Chrome');
  by('coverage').textContent = '应用管控：' + (state.worker ? '运行中' : state.enabled && !state.paused ? '等待组件或扫描' : '待命')
    + '。网页管控：' + (coverage.length ? '已连接 ' + coverage.join('、') : '暂无在线连接')
    + '。' + (state.lastError ? '应用扫描异常，可使用 Agent 排查。' : '')
    + (state.captureInterruptedAt ? '上一次采集已中断，已保存的截图会继续整理。' : '');
  const extensionPath = state.browserExtensionPath || '';
  const browserStatus = (browser, name) => name + ' ' + (state.coverage.includes(browser) ? '已连接' : '暂无在线连接');
  const connections = browserStatus('edge', 'Edge') + ' · ' + browserStatus('chrome', 'Chrome');
  if (by('browser-status').textContent !== connections) by('browser-status').textContent = connections;
  by('browser-folder').hidden = !extensionPath;
  if (by('browser-path').value !== extensionPath) by('browser-path').value = extensionPath;
  by('enable').hidden = state.enabled;
  by('pause').hidden = !state.enabled || state.paused;
  by('resume').hidden = !state.paused;
  by('disable').hidden = !state.enabled;
  by('reset').hidden = !state.hasPassword;
  by('undo').hidden = !state.canUndo;
  if (revision !== state.revision) {
    revision = state.revision;
    by('games').checked = state.rules.games;
    by('sites').value = state.rules.websites.join('\n');
    by('allow').value = state.rules.allowedUrls.join('\n');
  }
  const events = by('events');
  const signature = JSON.stringify(state.events);
  if (signature === preset) return;
  preset = signature;
  events.replaceChildren();
  if (!state.events.length) events.textContent = '暂无应用识别记录。';
  for (const record of state.events) {
    const entry = document.createElement('p');
    entry.className = 'event';
    entry.textContent = (record.product || record.file) + ' · ' +
      ({ block: '已关闭', review: '疑似娱乐应用', close_failed: '关闭失败' }[record.kind] || record.kind) + ' ';
    for (const [type, caption] of [['allow', '始终允许'], ['block', '以后限制']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = caption;
      button.onclick = () => command('app-rule', { type, hash: record.hash });
      entry.append(button);
    }
    events.append(entry);
  }
}

bridge.info().then(info => {
  if (info.kind !== 'settings') {
    by('title').textContent = info.title;
    by('auth').hidden = false;
    by('secret-label').textContent = info.kind === 'recovery' ? '恢复码' : '管理密码';
    by('confirm-fields').hidden = info.kind !== 'create';
    by('auth-form').onsubmit = async event => {
      event.preventDefault();
      const pending = { secret: by('secret').value, confirmation: by('confirm-secret').value };
      by('secret').value = '';
      by('confirm-secret').value = '';
      await command('submit', pending);
      by('secret').focus();
    };
    by('cancel').onclick = () => command('cancel');
    by('secret').focus();
    return;
  }
  by('settings').hidden = false;
  render(info.state);
  for (const [id, action] of [['enable','enable'], ['pause','pause'], ['resume','resume'], ['disable','disable'], ['reset','reset'], ['undo','undo']]) {
    by(id).onclick = () => command(action);
  }
  for (const browser of ['edge', 'chrome']) {
    by('setup-' + browser).onclick = () => command('browser', { browser });
  }
  by('copy-browser-folder').onclick = () => command('copy-browser-folder');
  by('copy-browser-page').onclick = () => command('copy-browser-page', { browser: browserSetup?.browser });
  const lines = id => by(id).value.split('\n').map(line => line.trim()).filter(Boolean);
  by('save').onclick = () => command('rules', { games: by('games').checked, websites: lines('sites'), allowedUrls: lines('allow'), revision });
  by('agent').onclick = () => { preview = ''; command('agent', { question: by('question').value.trim() }); };
  by('agent-apply').onclick = async () => { const pending = preview; preview = ''; await command('apply', { preview: pending }); };
  setInterval(() => { if (!busy) bridge.info().then(value => render(value.state)).catch(() => {}); }, 1800);
}).catch(error => { by('message').textContent = error.message; });
