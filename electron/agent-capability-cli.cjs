#!/usr/bin/env node
const fs = require('fs');

function argumentsFrom(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--') || !argv[i + 1]) throw new Error(`Invalid argument: ${key}`);
    options[key.slice(2)] = argv[++i];
  }
  return options;
}

async function run(argv = process.argv.slice(2)) {
  let options;
  try { options = argumentsFrom(argv); } catch (error) { return { exitCode: 2, output: { ok: false, code: 'INVALID_ARGUMENT', message: error.message } }; }
  const phase = options.phase || 'invoke';
  if (!['catalog', 'invoke', 'preview', 'execute', 'status'].includes(phase) || !options.descriptor || (['invoke', 'preview'].includes(phase) && (!options.name || !options.studentId)) || (['execute', 'status'].includes(phase) && !options.intentId)) return { exitCode: 2, output: { ok: false, code: 'INVALID_ARGUMENT', message: 'Provide --descriptor and the capability/scope or intent ID required by the selected phase.' } };
  let descriptor;
  try { descriptor = JSON.parse(fs.readFileSync(options.descriptor, 'utf8')); } catch { return { exitCode: 2, output: { ok: false, code: 'DESCRIPTOR_UNAVAILABLE' } }; }
  const endpoint = String(descriptor.capabilityEndpoint || '');
  if (!/^http:\/\/127\.0\.0\.1:\d+\/api\/agent\/invoke$/.test(endpoint)) return { exitCode: 2, output: { ok: false, code: 'LOCAL_ENDPOINT_REQUIRED' } };
  let token;
  try { token = fs.readFileSync(descriptor.authentication.tokenFile, 'utf8').trim(); } catch { return { exitCode: 3, output: { ok: false, code: 'CREDENTIAL_UNAVAILABLE' } }; }
  if (phase === 'catalog') {
    try {
      const response = await fetch(endpoint.replace('/api/agent/invoke', '/api/agent/capabilities'), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      const output = await response.json();
      return { exitCode: output.ok ? 0 : 3, output };
    } catch { return { exitCode: 4, output: { ok: false, code: 'HOST_UNAVAILABLE' } }; }
  }
  let input = { studentId: options.studentId };
  if (phase === 'preview') {
    if (!options.inputFile || !options.idempotencyKey) return { exitCode: 2, output: { ok: false, code: 'INPUT_FILE_AND_KEY_REQUIRED' } };
    try { input = JSON.parse(fs.readFileSync(options.inputFile, 'utf8')); } catch { return { exitCode: 2, output: { ok: false, code: 'INPUT_FILE_INVALID' } }; }
    if (input.studentId !== options.studentId || (options.projectId && input.projectId !== options.projectId)) return { exitCode: 2, output: { ok: false, code: 'SCOPE_MISMATCH' } };
  } else if (phase === 'invoke') {
    if (options.projectId) input.projectId = options.projectId;
    if (options.question) input.question = options.question;
    if (options.reportId) input.reportId = options.reportId;
    if (options.cursor) input.cursor = Number(options.cursor);
    if (options.limit) input.limit = Number(options.limit);
  }
  const target = phase === 'invoke' ? endpoint : endpoint.replace('/api/agent/invoke', `/api/agent/write/${phase}`);
  const body = ['execute', 'status'].includes(phase) ? { intentId: options.intentId } : phase === 'preview' ? { name: options.name, input, idempotencyKey: options.idempotencyKey } : { name: options.name, input };
  try {
    const response = await fetch(target, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(75_000) });
    const output = await response.json();
    return { exitCode: output.ok ? 0 : response.status === 401 || response.status === 403 ? 3 : 4, output };
  } catch { return { exitCode: 4, output: { ok: false, code: 'HOST_UNAVAILABLE' } }; }
}

if (require.main === module) run().then(({ exitCode, output }) => { process.stdout.write(`${JSON.stringify(output)}\n`); process.exitCode = exitCode; });
module.exports = { run, argumentsFrom };
