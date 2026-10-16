'use strict';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => { input += data; });
process.stdin.on('end', () => {
  const task = JSON.parse(input), mode = process.argv[2];
  if (mode === 'wait') return setInterval(() => {}, 1000);
  if (mode === 'fail') return process.exit(2);
  if (mode === 'bad') return process.stdout.write('{invalid');
  const result = task.type === 'probe' ? { nonce: task.input.nonce } : JSON.parse(task.prompt.split('合成 JSON：')[1] || '{"answer":42}');
  process.stdout.write(JSON.stringify({ protocol: task.protocol, requestId: task.requestId, ok: true, result }));
});
