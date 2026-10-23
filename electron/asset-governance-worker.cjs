'use strict';

const fsp = require('node:fs/promises');
const { parentPort } = require('node:worker_threads');

async function pathExists(target) {
  if (!target) return false;
  try {
    await fsp.access(target);
    return true;
  } catch { return false; }
}

parentPort.on('message', async message => {
  if (message?.type !== 'check') return;
  const paths = [...new Set((Array.isArray(message.paths) ? message.paths : []).map(String).filter(Boolean))];
  const results = [];
  for (const target of paths) results.push([target, await pathExists(target)]);
  parentPort.postMessage({ type: 'checked', requestId: message.requestId, results });
});
