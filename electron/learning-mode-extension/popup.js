'use strict';
const status = document.getElementById('status');
const disconnected = '暂未连接本机组件。已同步的网页规则会保留，连接后将自动更新。';
chrome.runtime.sendMessage({ action: 'status' }).then(result => {
  if (!result?.ready) status.textContent = disconnected;
  else status.textContent = result.count ? '本机专注规则已接入。' : '已连接。本机专注模式当前未限制网页。';
}).catch(() => { status.textContent = disconnected; });
