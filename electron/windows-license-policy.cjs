const {
  LICENSE_V3_SCHEMA,
  capabilitiesFor,
  planLabel,
  verifyLicenseTokenV3,
} = require('./license-entitlements.cjs');

const WINDOWS_PRODUCT_ID = 'WINDOWS_HOST';

function inactiveStatus(message, status = 'inactive') {
  return {
    status,
    active: false,
    planLabel: '未激活',
    message,
  };
}

function activateWindowsLicenseV3(code, options = {}) {
  const token = String(code || '').trim();
  if (!token.startsWith('AIE3.')) {
    return {
      ok: false,
      code: 'LICENSE_V3_REQUIRED',
      message: '此版本只接受 License v3。旧版激活码需要由授权管理工具换发为绑定本机设备码的新激活码。',
    };
  }
  const checked = verifyLicenseTokenV3(token, {
    trustedIssuers: options.trustedIssuers,
    deviceId: options.deviceId,
    productId: WINDOWS_PRODUCT_ID,
    now: options.now,
  });
  if (!checked.ok) return checked;
  const activatedAt = options.now instanceof Date
    ? options.now.toISOString()
    : new Date(options.now || Date.now()).toISOString();
  return {
    ok: true,
    license: {
      ...checked.license,
      status: 'active',
      active: true,
      licenseToken: token,
      codeHash: checked.license.tokenHash,
      activatedAt,
    },
  };
}

function evaluateStoredWindowsLicense(rawLicense, options = {}) {
  if (!rawLicense) return inactiveStatus('Windows 主机尚未激活。平板终端会跟随主机授权状态。');
  if (rawLicense.schema !== LICENSE_V3_SCHEMA || !String(rawLicense.licenseToken || '').startsWith('AIE3.')) {
    return inactiveStatus('检测到旧版授权记录。为保护授权安全，请联系销售换发绑定本机设备码的 License v3；已有档案仍可只读浏览。', 'migration_required');
  }
  const checked = verifyLicenseTokenV3(rawLicense.licenseToken, {
    trustedIssuers: options.trustedIssuers,
    deviceId: options.deviceId,
    productId: WINDOWS_PRODUCT_ID,
    now: options.now,
  });
  if (!checked.ok) {
    const expired = /过期/.test(checked.message || '');
    return inactiveStatus(checked.message || 'License v3 验证失败。', expired ? 'expired' : 'invalid');
  }
  const license = { ...rawLicense, ...checked.license, status: 'active', active: true };
  const { licenseToken: _licenseToken, token: _token, ...publicLicense } = license;
  return {
    ...publicLicense,
    status: 'active',
    active: true,
    planLabel: license.planLabel || planLabel(license.edition || license.plan),
    edition: license.edition || license.plan,
    capabilities: capabilitiesFor(license.edition || license.plan, license.role || ''),
    codeHash: license.codeHash ? `${license.codeHash.slice(0, 8)}...${license.codeHash.slice(-6)}` : '',
    message: 'Windows 主机已激活，平板终端跟随主机授权。',
  };
}

module.exports = {
  WINDOWS_PRODUCT_ID,
  activateWindowsLicenseV3,
  evaluateStoredWindowsLicense,
};
