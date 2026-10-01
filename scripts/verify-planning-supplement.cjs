'use strict';
// Public-information integration probe. Fixed synthetic profile; never reads student files.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createCodexResearchSearch } = require('../electron/planning-research.cjs');
const { validateResearchResult } = require('../electron/planning-guidance.cjs');
const { competitions } = require('../electron/research-content.cjs');
async function main() {
  const executable = process.argv[2];
  if (!executable || !fs.existsSync(executable)) throw new Error('Pass a verified absolute Codex CLI executable path');
  const purpose = process.argv[3] === 'competitions' ? 'competition_recommendation' : 'guidance';
  const search = createCodexResearchSearch({ executable, spawnProcess: spawn, terminateProcess: child => {
    if (process.platform === 'win32') spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
  } });
  let record;
  try {
    const queryInput = { purpose, grade: '初二（合成测试）', age: 14, currentRegion: '北京', targetRegions: ['北京'], routes: ['domestic'], interests: ['机器人'], subjectStrengths: ['物理'], careerDirections: ['工程'], learningSignals: [], confirmedGrowthSignals: [], projectSignals: [], preferences: ['仅合成流程测试；资料不足必须说明，不编造学生能力或匹配资格'] };
    const result = await search({ queryInput, timeoutMs: 180000 });
    const validated = validateResearchResult(result);
    if (!validated.ok) throw Error(validated.message);
    if (purpose === 'guidance' && !validated.sections) throw Error('Missing independent sections');
    const candidates = purpose === 'competition_recommendation' ? competitions(validated.competitions, validated.sources, new Date()) : undefined;
    record = { status: 'passed', purpose, checkedAt: new Date().toISOString(), profile: 'fixed synthetic; no student files read', sources: validated.sources, sections: validated.sections, candidates, limitations: validated.limitations,
      boundary: '真实 CLI 联网与返回合同检查，不代表真实学生个性化、人工政策核验、真机 UI 或跨设备验收' };
  } catch (error) { record = { status: 'not_accepted', purpose, checkedAt: new Date().toISOString(), message: error.message, diagnostics: error.diagnostics, boundary: '保留历史内容，不制造示例版本或假来源' }; }
  const destination = path.resolve(__dirname, '..', '.codex_tmp', `planning-real-${purpose}-20261001.json`);
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: record.status, purpose, sources: record.sources?.map(x => x.url), message: record.message, destination })}\n`);
  if (record.status !== 'passed') process.exitCode = 1;
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
