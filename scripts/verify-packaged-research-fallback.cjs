'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const WORKBUDDY_PROCESS_GAP_MS = 30_000;
const WORKBUDDY_RESEARCH_TIMEOUT_MS = 300_000;

async function waitForWorkBuddyProcessGap(releasedAt, {
  gapMs = WORKBUDDY_PROCESS_GAP_MS,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const remaining = Math.max(0, Number(gapMs) - (Number(now()) - Number(releasedAt)));
  if (remaining > 0) await sleep(remaining);
  return remaining;
}

function readQualificationCache(file, { now = Date.now } = {}) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value?.ready !== true || value?.profile !== 'research.v1' || !value.runtimeHash
      || !Number.isFinite(Date.parse(value.expiresAt || '')) || Date.parse(value.expiresAt) <= now()) return null;
    return value;
  } catch { return null; }
}

function minimalWorkBuddyFallbackProbe(probeSchema = {}) {
  const schema = structuredClone(probeSchema);
  schema.properties ||= {};
  schema.properties.sources ||= { type: 'array', items: { type: 'object', properties: {} } };
  schema.properties.sources.minItems = 1;
  schema.properties.sources.maxItems = 1;
  schema.properties.sources.items ||= { type: 'object', properties: {} };
  schema.properties.sources.items.properties ||= {};
  schema.properties.sources.items.properties.url ||= { type: 'string' };
  schema.properties.sources.items.properties.url.enum = ['https://www.iana.org/help/example-domains'];
  const prompt = ['C4 无学生资料的最小联网回退验收。仅用 WebSearch。',
    '搜索 IANA example domains。只需一次搜索，不要扩展研究。sources 必须恰好一项，url 必须完整等于 https://www.iana.org/help/example-domains。仅返回合规 JSON。',
    `JSON Schema：${JSON.stringify(schema)}`].join('\n\n');
  return { prompt, schema };
}

function summarizeFallbackRuns(runs = []) {
  const verified = runs.map(value => {
    const common = value?.passed === true && value?.syntheticOnly === true && value?.studentDataRead === false;
    const primarySucceeded = common && value?.resolution === 'primary_succeeded'
      && value?.attempts?.some?.(attempt => attempt?.providerId === 'codex'
        && attempt?.outcome === 'succeeded' && Number(attempt?.sourceCount || 0) > 0);
    const fallbackSucceeded = common && value?.fallback?.safe === true
      && value?.fallback?.from === 'codex' && value?.fallback?.to === 'workbuddy'
      && value?.resolution === 'fallback_succeeded';
    return Boolean(primarySucceeded || fallbackSucceeded);
  });
  const passedCount = verified.filter(Boolean).length;
  return { schema: 'edu.packaged-research-fallback-summary.v1', total: runs.length, passedCount,
    requiredPasses: 2, passed: runs.length === 3 && passedCount >= 2,
    runs: runs.map((value, index) => ({ index: index + 1, passed: verified[index], startedAt: value?.startedAt || '',
      finishedAt: value?.finishedAt || '', resolution: value?.resolution || '',
      workBuddyDurationMs: value?.phases?.find?.(phase => phase.name === 'workbuddy_search')?.durationMs || 0 })) };
}

function fallbackDecision(failure = {}, providers = []) {
  const from = String(providers[0] || 'codex');
  const safe = failure.stage === 'not_sent'
    && ['AGENT_MODEL_UNAVAILABLE', 'AUTHENTICATION_REQUIRED', 'AGENT_UNAVAILABLE'].includes(String(failure.code || ''));
  return {
    safe,
    from,
    to: safe ? String(providers.find(item => item !== from) || '') : '',
    reason: String(failure.providerFailure || failure.code || 'unknown'),
  };
}

function resolvePackagedModuleRoot(candidatePath) {
  const root = path.resolve(candidatePath);
  const candidates = [root, path.join(root, 'app.asar')];
  const match = candidates.find(candidate => fs.existsSync(path.join(candidate, 'electron', 'planning-research.cjs')));
  if (!match) throw Object.assign(new Error(`packaged_module_root_not_found:${root}`), { code: 'PACKAGED_MODULE_ROOT_NOT_FOUND' });
  return match;
}

async function run() {
  const moduleRoot = resolvePackagedModuleRoot(process.argv[2]);
  const reportPath = path.resolve(process.argv[3]);
  const codexExecutable = path.resolve(process.argv[4]);
  const workBuddyDesktop = path.resolve(process.argv[5]);
  const nodeExecutable = path.resolve(process.argv[6]);
  const qualificationCachePath = process.argv[7] ? path.resolve(process.argv[7]) : '';
  const load = file => require(path.join(moduleRoot, 'electron', file));
  const report = {
    schema: 'edu.packaged-research-fallback.v1',
    syntheticOnly: true,
    studentDataRead: false,
    startedAt: new Date().toISOString(),
    providers: ['codex', 'workbuddy'],
    attempts: [],
    phases: [],
    processes: [],
    passed: false,
  };
  let activePhase = 'codex';
  const instrumentedSpawn = (...args) => {
    const child = spawn(...args);
    const includeTails = process.env.EDU_RESEARCH_DIAGNOSTIC_TAILS === '1';
    const processEvidence = { phase: activePhase, processId: child.pid || null, stdoutBytes: 0, stderrBytes: 0 };
    child.stdout?.on('data', chunk => {
      processEvidence.stdoutBytes += chunk.length;
      if (includeTails) processEvidence.stdoutTail = `${processEvidence.stdoutTail || ''}${chunk}`.slice(-1200);
    });
    child.stderr?.on('data', chunk => {
      processEvidence.stderrBytes += chunk.length;
      if (includeTails) processEvidence.stderrTail = `${processEvidence.stderrTail || ''}${chunk}`.slice(-1200);
    });
    child.once('close', (code, signal) => { processEvidence.exitCode = code; processEvidence.signal = signal || ''; });
    report.processes.push(processEvidence);
    return child;
  };
  try {
    const queryInput = {
      purpose: 'competition_recommendation',
      interests: ['synthetic science'],
      subjectStrengths: ['synthetic evidence'],
      limitations: ['no student data'],
    };
    let codexFailure = null;
    try {
      const search = load('planning-research.cjs').createCodexResearchSearch({
        executable: codexExecutable,
        spawnProcess: instrumentedSpawn,
        terminateProcess: child => child?.kill?.(),
      });
      const output = await search({ queryInput, timeoutMs: 120000 });
      report.attempts.push({ providerId: 'codex', outcome: 'succeeded', sourceCount: output.sources.length });
      report.passed = true;
      report.resolution = 'primary_succeeded';
    } catch (error) {
      codexFailure = {
        code: String(error.code || ''),
        stage: String(error.stage || ''),
        providerFailure: String(error.providerFailure || ''),
        message: String(error.message || '').slice(0, 500),
      };
      report.attempts.push({ providerId: 'codex', outcome: codexFailure.stage || 'failed', ...codexFailure });
    }
    if (!report.passed) {
      const decision = fallbackDecision(codexFailure, report.providers);
      report.fallback = decision;
      if (!decision.safe || decision.to !== 'workbuddy') throw Object.assign(new Error('Codex 失败不具备安全回退证据'), { code: 'UNSAFE_FALLBACK' });

      const auth = load('classification-auth.cjs').createClassificationAuth({
        directory: path.join(process.env.APPDATA, 'edu-manager-launcher', 'classification-auth'),
      });
      const state = await auth.read('workbuddy');
      const runtimeModule = load('workbuddy-runtime.cjs');
      const runtime = auth.apply(runtimeModule.discoverWorkBuddyRuntime(workBuddyDesktop, {
        findExecutable: () => nodeExecutable,
        hostNodePath: process.execPath,
      }), state);
      runtime.authVersion = state.version || 0;
      const module = load('workbuddy-research.cjs');
      const qualificationStartedAt = Date.now();
      let qualification = readQualificationCache(qualificationCachePath);
      let qualificationReleasedAt = 0;
      if (qualification) {
        report.phases.push({ name: 'workbuddy_qualification_cache', passed: true, durationMs: Date.now() - qualificationStartedAt });
      } else {
        try {
          activePhase = 'workbuddy_qualification';
          qualification = await module.verifyWorkBuddyResearch({ runtime, spawnProcess: instrumentedSpawn });
          qualification.authScope = JSON.stringify([runtime.configDir || '', runtime.authVersion || 0]);
          if (qualificationCachePath) {
            fs.mkdirSync(path.dirname(qualificationCachePath), { recursive: true });
            fs.writeFileSync(qualificationCachePath, JSON.stringify(qualification, null, 2));
          }
          qualificationReleasedAt = Date.now();
          report.phases.push({ name: 'workbuddy_qualification', passed: true, durationMs: Date.now() - qualificationStartedAt });
        } catch (error) {
          report.phases.push({ name: 'workbuddy_qualification', passed: false, durationMs: Date.now() - qualificationStartedAt,
            code: String(error.code || ''), message: String(error.message || '').slice(0, 500) });
          throw error;
        }
      }
      await module.createWorkBuddyResearchSearch({ runtime, qualification, spawnProcess: instrumentedSpawn });
      if (qualificationReleasedAt) {
        const cooldownStartedAt = Date.now();
        const cooldownMs = await waitForWorkBuddyProcessGap(qualificationReleasedAt);
        report.phases.push({ name: 'workbuddy_process_cooldown', passed: true,
          durationMs: Date.now() - cooldownStartedAt, requiredMs: WORKBUDDY_PROCESS_GAP_MS, waitedMs: cooldownMs });
      }
      const searchStartedAt = Date.now();
      let output;
      try {
        activePhase = 'workbuddy_search';
        const probe = minimalWorkBuddyFallbackProbe(module.PROBE_SCHEMA);
        output = await module.runWorkBuddyResearch(runtime, { ...probe,
          timeoutMs: WORKBUDDY_RESEARCH_TIMEOUT_MS, spawnProcess: instrumentedSpawn });
        report.phases.push({ name: 'workbuddy_search', passed: true, durationMs: Date.now() - searchStartedAt });
      } catch (error) {
        report.phases.push({ name: 'workbuddy_search', passed: false, durationMs: Date.now() - searchStartedAt,
          code: String(error.code || ''), message: String(error.message || '').slice(0, 500) });
        throw error;
      }
      report.attempts.push({ providerId: 'workbuddy', outcome: 'succeeded', sourceCount: output.sources.length });
      report.passed = output.sources.length > 0;
      report.resolution = report.passed ? 'fallback_succeeded' : 'fallback_empty';
    }
  } catch (error) {
    report.error = { code: String(error.code || ''), message: String(error.message || '').slice(0, 1000) };
  }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  process.exitCode = report.passed ? 0 : 1;
}

if (require.main === module) void run();
module.exports = { WORKBUDDY_PROCESS_GAP_MS, WORKBUDDY_RESEARCH_TIMEOUT_MS, fallbackDecision, minimalWorkBuddyFallbackProbe,
  readQualificationCache, resolvePackagedModuleRoot, summarizeFallbackRuns,
  waitForWorkBuddyProcessGap };
