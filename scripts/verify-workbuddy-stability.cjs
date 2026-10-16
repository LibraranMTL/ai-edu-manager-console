'use strict';
// Opt-in bounded live tests, synthetic inputs only. Independent successful
// rounds are not retries: any error/timeout stops the series for inspection.
const fs = require('node:fs/promises'), path = require('node:path');
const { spawn } = require('node:child_process');
async function main() {
  const profile = path.resolve(process.argv[2]), executable = path.resolve(process.argv[3]);
  const directory = path.resolve(process.argv[4]);
  await fs.mkdir(directory, { recursive: true });
  const report = { schema: 'edu-manager.workbuddy-stability.v1', fixture: 'synthetic-only',
    plannedRounds: 3, maxConcurrentAgentCalls: 1, startedAt: new Date().toISOString(), rounds: [], passed: false };
  const save = () => fs.writeFile(path.join(directory, 'summary.json'), JSON.stringify(report, null, 2));
  await save();
  for (let index = 1; index <= report.plannedRounds; index++) {
    const file = path.join(directory, `round-${index}.json`);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(__dirname, 'verify-smart-inbox-agent.cjs'), executable, file,
        '--workbuddy', '--bundled-cli', '--isolated-profile', profile, '--diagnostic-timing'],
      { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
      child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
      // Each underlying call already has a bounded timeout and confirmed-stop
      // protocol. Do not kill this parent while a child may still be running.
    });
    const evidence = await fs.readFile(file, 'utf8').then(JSON.parse, () => null);
    report.rounds.push({ index, ...result, passed: result.code === 0 && evidence?.passed === true,
      cases: evidence?.cases?.map(c => ({ id: c.id, durationMs: c.durationMs, passed: c.passed, error: c.error })),
      invocations: evidence?.runs?.length });
    await save(); console.log(JSON.stringify(report.rounds.at(-1)));
    if (!report.rounds.at(-1).passed) break;
  }
  report.passed = report.rounds.length === report.plannedRounds && report.rounds.every(r => r.passed);
  report.finishedAt = new Date().toISOString(); await save();
  if (!report.passed) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
