const bridge = window.licenseAdmin;

const state = {
  records: [],
  query: '',
  latestCode: '',
};

function parseResult(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return { ok: false, message: raw || '结果解析失败。' };
  }
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
        <div class="muted">${escapeHtml(record.plan || '')}</div>
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
    customerName: $('customerName').value,
    contact: $('contact').value,
    orderNo: $('orderNo').value,
    plan: $('plan').value,
    studentLimit: $('studentLimit').value,
    deviceLimit: $('deviceLimit').value,
    expiresAt: permanent ? 'PERM' : $('expiresAt').value,
    note: $('note').value,
  };
}

function issueLicense(event) {
  event.preventDefault();
  const input = formInput();
  if (!input.customerName.trim()) {
    showMessage('请填写客户名称。', true);
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
  $('openRecordsFolderBtn').addEventListener('click', () => {
    const result = parseResult(bridge.openRecordsFolder());
    showMessage(result.ok ? '已打开记录目录。' : result.message || '打开记录目录失败。', !result.ok);
  });
  $('permanent').addEventListener('change', (event) => {
    $('expiresAt').disabled = event.target.checked;
  });
  $('expiresAt').disabled = $('permanent').checked;

  $('recordsBody').addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'copy') copyText(target.dataset.code || '', '已复制授权码。');
    if (action === 'validate') validateCode(target.dataset.code || '');
  });

  $('recordsBody').addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.action === 'status') updateStatus(target.dataset.id, target.value);
  });

  refreshRecords();
}

init();
