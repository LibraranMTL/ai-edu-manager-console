'use strict';

const https = require('node:https');

const WINDOWS_UPDATE_MANIFEST_URL = 'https://www.greatbg.com/download/edu-manager-version.json';
const WINDOWS_UPDATE_HOST = 'www.greatbg.com';
const MAX_UPDATE_MANIFEST_BYTES = 256 * 1024;
const UPDATE_TIMEOUT_MS = 10_000;

function updateError(code, message) {
  return Object.assign(new Error(message), { code });
}

function isAllowedWindowsDownloadUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === WINDOWS_UPDATE_HOST
      && !url.username
      && !url.password
      && !url.port
      && url.pathname.startsWith('/');
  } catch {
    return false;
  }
}

function validateWindowsUpdateManifest(manifest, currentVersionCode) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, hasUpdate: false, code: 'update_manifest_invalid', message: '更新清单格式无效。' };
  }
  if (manifest.windowsReleaseStatus !== 'stable') {
    return { ok: false, hasUpdate: false, code: 'update_channel_not_stable', message: '公开稳定通道暂无可用更新。' };
  }
  const versionCode = Number(manifest.windowsVersionCode);
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
    return { ok: false, hasUpdate: false, code: 'update_version_invalid', message: '更新清单缺少有效 Windows 版本码。' };
  }
  const windowsUrl = String(manifest.windowsUrl || '');
  if (!isAllowedWindowsDownloadUrl(windowsUrl)) {
    return { ok: false, hasUpdate: false, code: 'update_download_url_rejected', message: '更新下载地址未通过安全校验。' };
  }
  const current = Number(currentVersionCode);
  if (!Number.isSafeInteger(current) || current < 0) {
    return { ok: false, hasUpdate: false, code: 'current_version_invalid', message: '当前 Windows 版本码无效。' };
  }
  const hasUpdate = versionCode > current;
  return {
    ok: true,
    hasUpdate,
    code: hasUpdate ? 'update_available' : 'already_current',
    versionCode,
    versionName: String(manifest.windowsVersionName || versionCode).slice(0, 80),
    windowsUrl,
    notes: String(manifest.windowsNotes || manifest.notes || '').slice(0, 4000),
    message: hasUpdate ? '发现新的 Windows 正式版本。' : '当前已是最新正式版本。',
  };
}

function readBoundedJsonResponse(response, maxBytes = MAX_UPDATE_MANIFEST_BYTES) {
  return new Promise((resolve, reject) => {
    if (Number(response?.statusCode || 0) !== 200) {
      response?.resume?.();
      reject(updateError('update_manifest_http_error', `更新清单返回 HTTP ${Number(response?.statusCode || 0)}。`));
      return;
    }
    const declared = Number(response.headers?.['content-length'] || 0);
    if (declared > maxBytes) {
      response.destroy?.();
      reject(updateError('update_manifest_too_large', '更新清单超过 256 KiB 上限。'));
      return;
    }
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    response.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        fail(updateError('update_manifest_too_large', '更新清单超过 256 KiB 上限。'));
        response.destroy?.();
        return;
      }
      chunks.push(buffer);
    });
    response.on('error', (error) => fail(updateError(error.code || 'update_manifest_read_failed', '更新清单读取失败。')));
    response.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(updateError('update_manifest_invalid_json', '更新清单不是有效 JSON。')); }
    });
  });
}

function fetchWindowsUpdateManifest(options = {}) {
  const httpsGet = options.httpsGet || https.get;
  const manifestUrl = String(options.manifestUrl || WINDOWS_UPDATE_MANIFEST_URL);
  const timeoutMs = Number(options.timeoutMs || UPDATE_TIMEOUT_MS);
  const maxBytes = Number(options.maxBytes || MAX_UPDATE_MANIFEST_BYTES);
  if (manifestUrl !== WINDOWS_UPDATE_MANIFEST_URL) {
    return Promise.reject(updateError('update_manifest_url_rejected', '只允许访问正式 HTTPS 更新清单。'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      handler(value);
    };
    const request = httpsGet(manifestUrl, { headers: { Accept: 'application/json', 'User-Agent': 'AI-Education-Manager-Update/1' } }, (response) => {
      readBoundedJsonResponse(response, maxBytes).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
    });
    request.setTimeout(timeoutMs, () => {
      const error = updateError('update_check_timeout', '更新检查在 10 秒内未完成。');
      request.destroy(error);
      finish(reject, error);
    });
    request.on('error', (error) => finish(reject, error.code === 'update_check_timeout'
      ? error : updateError('update_check_network_failed', '更新检查网络请求失败。')));
  });
}

function createWindowsUpdateChecker(options = {}) {
  const fetchManifest = options.fetchManifest || (() => fetchWindowsUpdateManifest(options));
  const now = options.now || (() => new Date());
  let automaticCheckStarted = false;
  return {
    async check(request = {}) {
      const source = request.source === 'startup' ? 'startup' : 'manual';
      if (request.channel !== 'stable') {
        return { ok: false, hasUpdate: false, source, code: 'update_channel_rejected', message: '只支持 stable 更新通道。' };
      }
      if (source === 'startup') {
        if (automaticCheckStarted) return { ok: true, hasUpdate: false, skipped: true, source,
          code: 'automatic_update_check_already_run', message: '本进程已执行过自动更新检查。' };
        automaticCheckStarted = true;
      }
      const checkedAt = now().toISOString();
      try {
        const manifest = await fetchManifest();
        return { ...validateWindowsUpdateManifest(manifest, request.currentVersionCode), source, checkedAt };
      } catch (error) {
        return { ok: false, hasUpdate: false, source, checkedAt,
          code: error.code || 'update_check_failed', message: error.message || '更新检查失败。' };
      }
    },
  };
}

module.exports = {
  WINDOWS_UPDATE_MANIFEST_URL,
  WINDOWS_UPDATE_HOST,
  MAX_UPDATE_MANIFEST_BYTES,
  UPDATE_TIMEOUT_MS,
  isAllowedWindowsDownloadUrl,
  validateWindowsUpdateManifest,
  readBoundedJsonResponse,
  fetchWindowsUpdateManifest,
  createWindowsUpdateChecker,
};
