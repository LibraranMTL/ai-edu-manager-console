'use strict';

const connection = 'com.qxmatrix.learning_mode';
const browser = /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
const blockedPage = chrome.runtime.getURL('blocked.html');
let port = null;
let sources = [];
let ready = false;
let reconnect;
let heartbeat;
let queue = Promise.resolve();

function blocked(url, current = sources) {
  try {
    const page = new URL(url);
    if (!['http:', 'https:'].includes(page.protocol)) return false;
    page.hash = '';
    return current.some(({ rules }) => !rules.allowedUrls.includes(page.href)
      && rules.websites.some(host => page.hostname === host || page.hostname.endsWith('.' + host)));
  } catch { return false; }
}
function regexEscape(value) {
  return value.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
}
function buildRules(current) {
  const domains = [...new Set(current.flatMap(({ rules }) => rules.websites))];
  const exact = [...new Set(current.flatMap(({ rules }) => rules.allowedUrls))].filter(url => !blocked(url, current));
  const resourceTypes = ['main_frame'];
  const denied = domains.length ? [{
    id: 1, priority: 1, action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
    condition: { requestDomains: domains, regexFilter: '^https?://', resourceTypes },
  }] : [];
  return [...denied, ...exact.map((url, index) => ({
    id: index + 2, priority: 2, action: { type: 'allow' },
    condition: { regexFilter: '^' + regexEscape(url) + '$', isUrlFilterCaseSensitive: true, resourceTypes },
  }))];
}
async function replaceRules(current) {
  // Keep the last confirmed rules active during browser startup and bridge reconnects.
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map(rule => rule.id),
    addRules: buildRules(current),
  });
  sources = current;
  for (const tab of await chrome.tabs.query({})) {
    if (blocked(tab.url) && tab.id) chrome.tabs.update(tab.id, { url: blockedPage }).catch(() => {});
  }
}
function connect() {
  if (port) return;
  clearTimeout(reconnect);
  const channel = chrome.runtime.connectNative(connection);
  port = channel;
  channel.onMessage.addListener(message => {
    if (!Array.isArray(message.sources)) return;
    queue = queue.catch(() => {}).then(async () => {
      if (port !== channel) return;
      await replaceRules(message.sources);
      if (port !== channel) return;
      ready = true;
      channel.postMessage({ browser, action: 'applied' });
      clearInterval(heartbeat);
      heartbeat = setInterval(() => { if (ready && port === channel) channel.postMessage({ browser, action: 'applied' }); }, 8000);
      await chrome.action.setBadgeText({ text: '' });
    }).catch(() => {
      ready = false;
      chrome.action.setBadgeText({ text: '!' }).catch(() => {});
    });
  });
  channel.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (port !== channel) return;
    port = null;
    ready = false;
    clearInterval(heartbeat);
    chrome.action.setBadgeText({ text: '!' }).catch(() => {});
    reconnect = setTimeout(connect, 4000);
  });
  channel.postMessage({ browser, action: 'connect' });
}
function reevaluate(details) {
  if (details.frameId === 0 && blocked(details.url)) chrome.tabs.update(details.tabId, { url: blockedPage }).catch(() => {});
}
chrome.webNavigation.onHistoryStateUpdated.addListener(reevaluate);
chrome.webNavigation.onCommitted.addListener(reevaluate);
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.action === 'status') reply({ ready, count: sources.length });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'learning-mode') connect();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.alarms.create('learning-mode', { periodInMinutes: 0.5 });
connect();
