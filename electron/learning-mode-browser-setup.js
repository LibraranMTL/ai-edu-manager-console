'use strict';

const parameters = new URLSearchParams(location.search);
const browser = parameters.get('browser') === 'edge' ? 'edge' : 'chrome';
const marker = parameters.get('setup') || '';
if (/^[0-9a-f]{16}$/.test(marker)) {
  document.title += ' · ' + marker;
  document.getElementById('folder-instructions').textContent = '开启开发人员模式，点「加载已解压扩展」。程序会尝试填入目录，请检查后确认。若未填入，仍可复制下面的目录。';
}
const address = document.getElementById('manager-address');
address.value = browser + '://extensions/';

const extension = new URL('./browser-extension', location.href);
const folder = document.getElementById('extension-folder');
const windowsPath = decodeURIComponent(extension.pathname).replace(/^\/(?=[A-Za-z]:)/, '').replaceAll('/', '\\');
folder.value = extension.hostname ? '\\\\' + extension.hostname + windowsPath : windowsPath;

const status = document.getElementById('copy-status');
async function copy(field, label) {
  try {
    await navigator.clipboard.writeText(field.value);
    status.textContent = label + '已复制。';
  } catch {
    field.focus();
    field.select();
    status.textContent = label + '已选中，请按 Ctrl+C 复制。';
  }
}
document.getElementById('copy-address').onclick = () => copy(address, '管理页地址');
document.getElementById('copy-folder').onclick = () => copy(folder, '扩展目录');
