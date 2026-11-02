'use strict';

const PROJECT_IPC_LIMIT_BYTES = 2 * 1024 * 1024;

function boundedProjectIpcJson(payload, options = {}) {
  const body = JSON.stringify(payload);
  const responseBytes = Buffer.byteLength(body, 'utf8');
  const limitBytes = Number(options.limitBytes || PROJECT_IPC_LIMIT_BYTES);
  if (responseBytes <= limitBytes) return body;

  const diagnostic = payload && typeof payload === 'object' ? {
    itemCount: Array.isArray(payload.items) ? payload.items.length : undefined,
    hasProject: Boolean(payload.project),
    hasProjection: Boolean(payload.projection),
    responseBytes,
    limitBytes,
  } : { responseBytes, limitBytes };
  (options.logger || console).warn('[project-ipc] bounded response rejected', diagnostic);
  return JSON.stringify({
    ok: false,
    code: 'project_ipc_payload_too_large',
    message: '项目数据超过单次传输上限，请缩小筛选范围或继续分页。',
    responseBytes,
    limitBytes,
  });
}

module.exports = { PROJECT_IPC_LIMIT_BYTES, boundedProjectIpcJson };
