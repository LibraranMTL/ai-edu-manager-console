'use strict';

const port = Number(process.argv[2]);
const expression = String(process.argv[3] || 'undefined');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('valid debugging port is required');

async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!target) throw new Error('renderer page target not found');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const id = 1;
  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP evaluation timed out')), 15_000);
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timeout);
      resolve(message);
    });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  socket.close();
  if (response.error) throw new Error(response.error.message || 'CDP evaluation failed');
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text || 'renderer evaluation failed');
  process.stdout.write(`${JSON.stringify(response.result?.result?.value ?? null, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
