const bridge = window.licenseAdmin;

const state = {
  records: [],
  query: '',
  latestCode: '',
  qrCode: '',
  qrDataUrl: '',
  qrSuggestedName: '',
  keyStore: { active: {}, keys: [] },
};

function parseResult(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return { ok: false, message: raw || '结果解析失败。' };
  }
}

function showKeyMessage(text, danger = false) {
  const el = $('keyMessage');
  el.hidden = !text;
  el.textContent = text || '';
  el.style.color = danger ? '#9f1239' : '#0f5132';
  el.style.background = danger ? '#fff1f2' : '#ecfdf5';
}

function renderKeyStore() {
  const activeId = state.keyStore?.active?.license_signing || '';
  const keys = (state.keyStore?.keys || []).filter((item) => item.purpose === 'license_signing');
  const badge = $('keyStatusBadge');
  badge.textContent = activeId ? `已配置 · ${activeId}` : '尚未初始化';
  badge.classList.toggle('ready', Boolean(activeId));
  $('keyList').innerHTML = keys.length ? keys.map((item) => `
    <article class="key-item">
      <div><strong>${escapeHtml(item.keyId)}</strong><div class="muted">${escapeHtml(item.status === 'revoked' ? '已撤销' : item.keyId === activeId ? '当前签发密钥' : '可用历史密钥')}</div></div>
      <code>SHA-256 ${escapeHtml(item.fingerprint)}</code>
      <div class="row-actions">
        ${item.status !== 'revoked' && item.keyId !== activeId ? `<button class="secondary" data-key-action="select" data-key-id="${escapeHtml(item.keyId)}">设为当前</button>` : ''}
        ${item.status !== 'revoked' ? `<button class="danger" data-key-action="revoke" data-key-id="${escapeHtml(item.keyId)}">泄露/撤销</button>` : ''}
      </div>
    </article>
  `).join('') : '<span class="muted">尚未创建平台 License 密钥。普通版本仍可使用旧授权流程，但平台版不能签发。</span>';
}

async function refreshKeyStatus(message = '') {
  const result = parseResult(await bridge.keyStatus());
  if (!result.ok) return showKeyMessage(result.message || '读取密钥状态失败。', true);
  state.keyStore = result.keyStore || { active: {}, keys: [] };
  renderKeyStore();
  if (message) showKeyMessage(message);
}

async function runKeyAction(action, ...args) {
  const result = parseResult(await action(...args));
  if (!result.ok) return showKeyMessage(result.message || '密钥操作失败。', true);
  if (result.keyStore) state.keyStore = result.keyStore;
  renderKeyStore();
  showKeyMessage(result.message || '密钥操作完成。');
}

function $(id) {
  return document.getElementById(id);
}

function showMessage(text, danger = false) {
  const el = $('message');
  el.hidden = !text;
  el.textContent = text || '';
  el.style.color = danger ? '#9f1239' : '#0f5132';
  el.style.background = danger ? '#fff1f2' : '#ecfdf5';
  el.style.borderColor = danger ? 'rgba(225, 29, 72, 0.28)' : 'rgba(15, 118, 110, 0.22)';
}

function formatDate(value) {
  if (!value) return '永久';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('zh-CN');
}

function statusLabel(status) {
  if (status === 'issued') return '有效';
  if (status === 'revoked') return '已作废';
  if (status === 'replaced') return '已换码';
  if (status === 'expired') return '已过期';
  return status || '未知';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderRecords() {
  const body = $('recordsBody');
  if (!state.records.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted">暂无授权记录。</td></tr>';
    return;
  }
  body.innerHTML = state.records.map((record) => `
    <tr>
      <td>
        <div class="record-main">
          <strong>${escapeHtml(record.customerName || '未填写客户')}</strong>
          <span class="muted">${escapeHtml(record.contact || '未填写联系方式')}</span>
          <span class="muted">${escapeHtml(record.orderNo || '')}</span>
        </div>
      </td>
      <td>
        <strong>${escapeHtml(record.planLabel || record.plan || '')}</strong>
        <div class="muted">${escapeHtml(record.productId || '历史 Windows 授权')} · ${escapeHtml(record.plan || '')}</div>
      </td>
      <td>
        学生 ${escapeHtml(record.studentLimit || '')}<br />
        设备 ${escapeHtml(record.deviceLimit || '')}
      </td>
      <td>
        ${escapeHtml(formatDate(record.expiresAt))}
        <div class="muted">${escapeHtml(record.issuedAt ? new Date(record.issuedAt).toLocaleString('zh-CN') : '')}</div>
      </td>
      <td>
        <select data-action="status" data-id="${escapeHtml(record.id)}">
          <option value="issued" ${record.status === 'issued' ? 'selected' : ''}>有效</option>
          <option value="revoked" ${record.status === 'revoked' ? 'selected' : ''}>已作废</option>
          <option value="expired" ${record.status === 'expired' ? 'selected' : ''}>已过期</option>
          <option value="replaced" ${record.status === 'replaced' ? 'selected' : ''}>已换码</option>
        </select>
      </td>
      <td class="code-cell">${escapeHtml(record.code || '')}</td>
      <td>
        <div class="row-actions">
          <button class="secondary" data-action="copy" data-code="${escapeHtml(record.code || '')}">复制</button>
          <button class="secondary" data-action="qr" data-code="${escapeHtml(record.code || '')}" data-label="${escapeHtml(record.customerName || record.productId || 'License-v3')}">二维码</button>
          <button class="ghost" data-action="validate" data-code="${escapeHtml(record.code || '')}">校验</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function refreshRecords(message = '') {
  const result = parseResult(bridge.listRecords(state.query));
  if (!result.ok) {
    showMessage(result.message || '读取记录失败。', true);
    return;
  }
  state.records = result.records || [];
  renderRecords();
  if (message) showMessage(message);
}

function formInput() {
  const permanent = $('permanent').checked;
  return {
    productId: $('productId').value,
    customerName: $('customerName').value,
    contact: $('contact').value,
    orderNo: $('orderNo').value,
    plan: $('plan').value,
    studentLimit: $('studentLimit').value,
    deviceLimit: $('deviceLimit').value,
    expiresAt: permanent ? 'PERM' : $('expiresAt').value,
    devicePolicy: $('devicePolicy').value,
    deviceId: $('deviceId').value,
    note: $('note').value,
  };
}

async function issueLicense(event) {
  event.preventDefault();
  const input = formInput();
  if (!input.customerName.trim()) {
    showMessage('请填写客户名称。', true);
    return;
  }
  if (input.devicePolicy === 'required_binding' && !input.deviceId.trim()) {
    showMessage('必须绑定当前主机时，请填写目标稳定主机 ID。', true);
    return;
  }
  const result = parseResult(bridge.issue(input));
  if (!result.ok) {
    showMessage(result.message || '生成授权码失败。', true);
    return;
  }
  state.latestCode = result.record.code;
  $('latestCode').textContent = state.latestCode;
  state.records = result.records || [];
  renderRecords();
  showMessage(result.message || '已生成授权码。');
  await showLicenseQr(state.latestCode, result.record.customerName || result.record.productId || 'License-v3');
}

function normalizedV3Code(code) {
  const value = String(code || '').trim();
  if (!value.startsWith('AIE3.') || value.length > 16384) return '';
  return value;
}

async function showLicenseQr(code, label = 'License-v3') {
  const token = normalizedV3Code(code);
  if (!token) {
    showMessage('只有有效的 License v3 激活码才能生成二维码。', true);
    return;
  }
  try {
    const dataUrl = await QRCode.toDataURL(token, {
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 720,
      color: { dark: '#10201fff', light: '#ffffffff' },
    });
    state.qrCode = token;
    state.qrDataUrl = dataUrl;
    state.qrSuggestedName = `AI教育管家-${String(label || 'License-v3').trim()}-License-v3-二维码`;
    $('licenseQrTitle').textContent = `${label || 'License v3'} · 激活二维码`;
    $('licenseQrImage').src = dataUrl;
    $('licenseQrPreview').textContent = `${token.slice(0, 28)}…${token.slice(-18)}`;
    $('licenseQrDialog').showModal();
  } catch (error) {
    showMessage(`生成二维码失败：${error?.message || error}`, true);
  }
}

function saveCurrentQr() {
  if (!state.qrDataUrl) return showMessage('请先生成二维码。', true);
  const result = parseResult(bridge.saveQr(state.qrDataUrl, state.qrSuggestedName));
  showMessage(result.message || (result.ok ? '二维码已保存。' : '二维码保存失败。'), !result.ok);
}

function updateStatus(id, status) {
  const result = parseResult(bridge.updateRecordStatus(id, status));
  if (!result.ok) {
    showMessage(result.message || '更新状态失败。', true);
    return;
  }
  state.records = result.records || [];
  renderRecords();
  showMessage(result.message || '状态已更新。');
}

function copyText(text, message = '已复制。') {
  const result = parseResult(bridge.copyText(text));
  showMessage(result.ok ? message : result.message || '复制失败。', !result.ok);
}

function validateCode(code) {
  const result = parseResult(bridge.validateCode(code));
  if (!result.ok) {
    showMessage(result.message || '授权码校验失败。', true);
    return;
  }
  const license = result.license || {};
  showMessage(`授权码有效：${license.planLabel || license.plan}，学生 ${license.studentLimit}，设备 ${license.deviceLimit}，到期 ${formatDate(license.expiresAt)}。`);
}

function exportRecords(kind) {
  const result = parseResult(kind === 'csv' ? bridge.exportCsv(state.query) : bridge.exportJson(state.query));
  if (!result.ok) {
    showMessage(result.message || '导出失败。', true);
    return;
  }
  showMessage(result.message || '导出完成。');
}

function init() {
  const info = parseResult(bridge.getAppInfo());
  if (info.ok) $('versionText').textContent = `v${info.version}`;

  $('issueForm').addEventListener('submit', issueLicense);
  $('productId').addEventListener('change', () => {
    const android = $('productId').value === 'ANDROID_STANDALONE';
    $('devicePolicy').value = 'required_binding';
    if (android) {
      $('studentLimit').value = '1';
      $('deviceLimit').value = '1';
    }
    $('deviceId').placeholder = android ? 'ANDROID-XXXX-XXXX-XXXX' : 'HOST-XXXX-XXXX-XXXX';
  });
  $('searchInput').addEventListener('input', (event) => {
    state.query = event.target.value;
    refreshRecords();
  });
  $('refreshBtn').addEventListener('click', () => refreshRecords('已刷新记录。'));
  $('exportCsvBtn').addEventListener('click', () => exportRecords('csv'));
  $('exportJsonBtn').addEventListener('click', () => exportRecords('json'));
  $('copyLatestBtn').addEventListener('click', () => {
    if (!state.latestCode) {
      showMessage('尚未生成授权码。', true);
      return;
    }
    copyText(state.latestCode, '已复制最近生成的授权码。');
  });
  $('showLatestQrBtn').addEventListener('click', () => showLicenseQr(state.latestCode, $('customerName').value || 'License-v3'));
  $('closeQrBtn').addEventListener('click', () => $('licenseQrDialog').close());
  $('saveQrBtn').addEventListener('click', saveCurrentQr);
  $('copyQrCodeBtn').addEventListener('click', () => copyText(state.qrCode, '已复制二维码中的激活码。'));
  $('openRecordsFolderBtn').addEventListener('click', () => {
    const result = parseResult(bridge.openRecordsFolder());
    showMessage(result.ok ? '已打开记录目录。' : result.message || '打开记录目录失败。', !result.ok);
  });
  $('permanent').addEventListener('change', (event) => {
    $('expiresAt').disabled = event.target.checked;
  });
  $('expiresAt').disabled = $('permanent').checked;
  $('createPlatformKeyBtn').addEventListener('click', () => runKeyAction(bridge.createPlatformKey, $('newKeyId').value));
  $('importPlatformKeyBtn').addEventListener('click', () => runKeyAction(bridge.importPlatformKey, $('newKeyId').value));
  $('exportTrustBundleBtn').addEventListener('click', async () => {
    const result = parseResult(await bridge.exportTrustBundle());
    showKeyMessage(result.ok ? result.message : result.message || '导出可信公钥包失败。', !result.ok);
  });
  const backupPassword = () => $('keyBackupPassword').value;
  $('createKeyBackupBtn').addEventListener('click', () => runKeyAction(bridge.createKeyBackup, backupPassword()));
  $('restoreKeyBackupBtn').addEventListener('click', () => runKeyAction(bridge.restoreKeyBackup, backupPassword(), false));
  $('testKeyBackupBtn').addEventListener('click', () => runKeyAction(bridge.restoreKeyBackup, backupPassword(), true));
  $('keyList').addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const keyId = target.dataset.keyId || '';
    if (target.dataset.keyAction === 'select') await runKeyAction(bridge.selectPlatformKey, keyId);
    if (target.dataset.keyAction === 'revoke') {
      const reason = window.prompt('请输入撤销或疑似泄露原因。撤销后该密钥不能再签发新 License。');
      if (reason) await runKeyAction(bridge.revokePlatformKey, keyId, reason);
    }
  });

  $('recordsBody').addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'copy') copyText(target.dataset.code || '', '已复制授权码。');
    if (action === 'qr') showLicenseQr(target.dataset.code || '', target.dataset.label || 'License-v3');
    if (action === 'validate') validateCode(target.dataset.code || '');
  });

  $('recordsBody').addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.action === 'status') updateStatus(target.dataset.id, target.value);
  });

  refreshRecords();
  refreshKeyStatus();
}

init();
