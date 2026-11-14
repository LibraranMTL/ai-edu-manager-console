'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const directory = path.resolve(root, String(args.get('output') || 'artifacts/p0-red-gate-20261025'));
const stage = String(args.get('stage') || 'pre');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8').replace(/^\uFEFF/, ''));
const exists = name => fs.existsSync(path.join(directory, name));

function provenanceMatches(value, expected) {
  return value?.provenance?.workspaceCommit === expected.workspaceCommit
    && value?.provenance?.candidateSha256 === expected.candidateSha256;
}

function isolationVerified(value) {
  const isolation = value?.isolation || {};
  const userDataDir = String(isolation.userDataDir || '');
  const studentBaseDir = String(isolation.studentBaseDir || '');
  if (isolation.verified !== true || !path.isAbsolute(userDataDir) || !path.isAbsolute(studentBaseDir)) return false;
  const relative = path.relative(path.resolve(userDataDir), path.resolve(studentBaseDir));
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function inspectAblation(name, id, expected) {
  if (!exists(name)) return { passed: false, message: `${name}不存在` };
  let value;
  try { value = read(name); } catch (error) { return { passed: false, message: `${name}不是有效JSON：${error.message}` }; }
  const baselineRuns = Array.isArray(value?.baseline?.runs) ? value.baseline.runs : [];
  const treatmentRuns = Array.isArray(value?.treatment?.runs) ? value.treatment.runs : [];
  const runsValid = [...baselineRuns, ...treatmentRuns].every(run => Number(run?.sampleCount) > 0 && Number(run?.durationSeconds) > 0);
  const metric = value?.comparison?.metric;
  const baselineValues = baselineRuns.map(run => Number(run?.[metric]));
  const treatmentValues = treatmentRuns.map(run => Number(run?.[metric]));
  const metricValuesValid = typeof metric === 'string' && metric.length > 0
    && [...baselineValues, ...treatmentValues].every(Number.isFinite);
  const baselineMean = metricValuesValid ? baselineValues.reduce((sum, current) => sum + current, 0) / baselineValues.length : NaN;
  const treatmentMean = metricValuesValid ? treatmentValues.reduce((sum, current) => sum + current, 0) / treatmentValues.length : NaN;
  const direction = value?.comparison?.direction;
  const improvementPercent = metricValuesValid && baselineMean !== 0
    ? (direction === 'higher_is_better' ? treatmentMean - baselineMean : baselineMean - treatmentMean) / Math.abs(baselineMean) * 100 : NaN;
  const comparisonValid = ['lower_is_better', 'higher_is_better'].includes(direction)
    && closeEnough(value?.comparison?.baselineMean, baselineMean)
    && closeEnough(value?.comparison?.treatmentMean, treatmentMean)
    && closeEnough(value?.comparison?.improvementPercent, improvementPercent);
  const improves = Number.isFinite(improvementPercent) && improvementPercent > 0;
  let semanticsValid = false;
  if (id === 'DATA-01') {
    const hashes = [...baselineRuns, ...treatmentRuns].map(run => String(run.resultHash || ''));
    semanticsValid = hashes.every(hash => hash && hash === hashes[0])
      && baselineRuns.every(run => Number(run.materialRowsRead) > 0)
      && treatmentRuns.every(run => Number(run.materialRowsRead) === 0);
  } else if (id === 'PERF-01') {
    // A completed task contributes one final drain() to release its counters,
    // so the 1.1s treatment can legitimately observe: initial, 1s fallback,
    // pressure-recovery wake, and completion cleanup.
    semanticsValid = baselineRuns.every(run => Number(run.drainCount) >= 7)
      && treatmentRuns.every(run => Number(run.drainCount) <= 4
        && Number.isFinite(Number(run.startLatencyAfterReleaseMs))
        && Number(run.startLatencyAfterReleaseMs) <= 1_200);
  } else if (id === 'PERF-02') {
    semanticsValid = baselineRuns.every(run => Number(run.normalizationCalls) > 0 && run.stateValid === true
        && run.finalHeartbeat === run.persistedHeartbeat)
      && treatmentRuns.every(run => Number(run.normalizationCalls) === 0 && run.stateValid === true
        && run.finalHeartbeat === run.persistedHeartbeat);
  }
  const passed = value?.schema === 1 && value?.id === id && provenanceMatches(value, expected)
    && baselineRuns.length >= 3 && treatmentRuns.length >= 3 && runsValid
    && comparisonValid && improves && semanticsValid
    && typeof value?.conclusion === 'string' && value.conclusion.trim().length > 0;
  return { passed: Boolean(passed), message: passed ? `${id}含基线/处理各${baselineRuns.length}/${treatmentRuns.length}次原始运行摘要`
    : `${id}缺少schema、同源信息、三次基线/处理运行、正向收益、语义等价或结论` };
}

function inspectTimeline(name, expected) {
  if (!exists(name)) return { passed: false, message: `${name}不存在` };
  let value;
  try { value = read(name); } catch (error) { return { passed: false, message: `${name}不是有效JSON：${error.message}` }; }
  const events = Array.isArray(value?.events) ? value.events : [];
  const stages = new Set(events.map(event => event?.stage));
  const required = ['enqueue', 'permit_wait', 'execution', 'reconciliation', 'settlement'];
  const positions = required.map(stage => events.findIndex(event => event?.stage === stage));
  const ordered = positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]));
  const timestamps = events.map(event => Date.parse(event?.at || ''));
  const chronological = timestamps.every((stamp, index) => Number.isFinite(stamp)
    && (index === 0 || stamp >= timestamps[index - 1]));
  const observed = value?.observed || {};
  const closureValid = observed.finalStatus === 'delivered' && Number(observed.deliveryCalls) === 1
    && Number(observed.duplicateDeliveryCalls) === 0 && Number(observed.reconcileCalls) >= 1
    && Number(observed.settlementCalls) >= 1;
  const passed = value?.schema === 1 && provenanceMatches(value, expected) && typeof value?.correlationId === 'string'
    && value.correlationId.length > 0 && required.every(stage => stages.has(stage))
    && ordered && chronological && closureValid;
  return { passed: Boolean(passed), message: passed ? `关联${value.correlationId}包含${events.length}个事件`
    : `缺少来源、关联ID、顺序、单次执行闭环或阶段：${required.filter(stage => !stages.has(stage)).join(',')}` };
}

function inspectProcessTrace(name, expected) {
  if (!exists(name)) return { passed: false, message: `${name}不存在` };
  let value;
  try { value = read(name); } catch (error) { return { passed: false, message: `${name}不是有效JSON：${error.message}` }; }
  const observations = Array.isArray(value?.observations) ? value.observations : [];
  const passed = value?.schema === 1 && provenanceMatches(value, expected) && observations.length > 0
    && observations.every(item => item?.at && Array.isArray(item?.processes));
  return { passed: Boolean(passed), message: passed ? `${observations.length}个进程观察点` : '缺少来源或带时间戳的进程观察点' };
}

function inspectReleaseRegression(name, expected) {
  if (!exists(name)) return { passed: false, message: `${name}不存在` };
  let value;
  try { value = read(name); } catch (error) { return { passed: false, message: `${name}不是有效JSON：${error.message}` }; }
  const passed = value?.schema === 1 && provenanceMatches(value, expected) && value?.status === 'passed'
    && Number(value?.summary?.failedTests) === 0 && value?.summary?.businessClosurePassed === true
    && Number(value?.summary?.automaticThroughputLossPercent) <= 5
    && Number(value?.summary?.nonRespondingSamples) === 0;
  return { passed: Boolean(passed), message: passed ? '统一功能、数据、调度和性能回归通过'
    : '缺少同源、零失败、业务闭环、吞吐或响应性证明' };
}

function inspectRuntimeRepairPreview(name) {
  if (!exists(name)) return { passed: false, message: `${name}不存在` };
  let value;
  try { value = read(name); } catch (error) { return { passed: false, message: `${name}不是有效JSON：${error.message}` }; }
  const before = value?.sourceHashes?.before || {};
  const after = value?.sourceHashes?.after || {};
  const sourceKeys = Object.keys(before);
  const hashesStable = sourceKeys.length >= 3 && sourceKeys.every((key) => typeof before[key] === 'string'
    && before[key].length === 64 && before[key] === after[key]);
  const redispatchedUnknown = Array.isArray(value?.wouldRedispatchUnknown) ? value.wouldRedispatchUnknown : null;
  const blocked = Array.isArray(value?.blocked) ? value.blocked : [];
  const exactUnknownProtection = blocked.some((item) => item?.reasonCode === 'execution_unknown_self')
    && blocked.some((item) => ['execution_unknown_same_work', 'execution_unknown_shared_batch',
      'execution_unknown_shared_execution'].includes(item?.reasonCode));
  const passed = value?.schema === 'edu-manager.p0-runtime-repair-preview.v1'
    && value?.readOnlyVerified === true && hashesStable && redispatchedUnknown?.length === 0
    && exactUnknownProtection && value?.firewall?.repairMode === 'explicit_user_uac_only'
    && value?.firewall?.phoneAccepted === false;
  return { passed: Boolean(passed), message: passed
    ? `源文件哈希未变，${blocked.length}项保留精确阻断，未知结果零重派`
    : '缺少只读哈希证明、精确未知结果阻断、零重派或显式UAC防火墙边界' };
}

function inspectOriginalFailureBaseline(name, expected) {
  if (!exists(name)) return { passed: false, message: `${name}不存在` };
  let value;
  try { value = read(name); } catch (error) { return { passed: false, message: `${name}不是有效JSON：${error.message}` }; }
  const observations = Array.isArray(value?.observations) ? value.observations : [];
  const passed = value?.schema === 1 && value?.provenance?.buildCommit === expected.buildCommit
    && value?.provenance?.candidateSha256 === expected.candidateSha256 && observations.length > 0
    && observations.every(item => item?.at && item?.symptom && item?.sampleFile);
  return { passed: Boolean(passed), message: passed ? `${observations.length}个原候选故障观察已绑定原始样本`
    : '缺少原候选构建/哈希、故障观察或原始样本引用' };
}

function closeEnough(actual, expected, tolerance = 0.01) {
  return Number.isFinite(Number(actual)) && Math.abs(Number(actual) - Number(expected)) <= tolerance;
}

function inspectRuntimeScenarios(expected) {
  const minimumDuration = { idle: 600, 'normal-task': 600, 'backlog-recovery': 1800 };
  const validRuns = new Map();
  const invalid = [];
  for (const name of fs.readdirSync(directory)) {
    if (!/^p0-live-runtime-.*\.json$/i.test(name)) continue;
    let value;
    try { value = read(name); } catch (error) { invalid.push({ name, reason: `invalid_json:${error.message}` }); continue; }
    if (!(value?.scenario in minimumDuration)) continue;
    const samples = Array.isArray(value.samples) ? value.samples : [];
    const totalIntervalSeconds = samples.reduce((sum, sample) => sum + Number(sample?.actualIntervalMilliseconds || 0), 0) / 1000;
    const cpuAverage = samples.length ? samples.reduce((sum, sample) => sum + Number(sample?.treeCpuWholeMachinePercent || 0), 0) / samples.length : NaN;
    const memoryAverage = samples.length ? samples.reduce((sum, sample) => sum + Number(sample?.mainPrivateMemoryBytes || 0), 0) / samples.length : NaN;
    const valid = value.schema === 2 && provenanceMatches(value, expected) && isolationVerified(value)
      && typeof value.runId === 'string' && value.runId.length > 0
      && Number(value.actualDurationSeconds) >= minimumDuration[value.scenario] * 0.95
      && totalIntervalSeconds >= minimumDuration[value.scenario] * 0.9
      && Number(value?.summary?.sampleCount) === samples.length && samples.length > 0
      && closeEnough(value?.summary?.treeCpuWholeMachineAveragePercent, cpuAverage)
      && closeEnough(value?.summary?.mainPrivateMemoryAverageBytes, memoryAverage, 1);
    if (!valid) { invalid.push({ name, reason: 'schema_provenance_isolation_duration_samples_or_summary_mismatch' }); continue; }
    if (!validRuns.has(value.scenario)) validRuns.set(value.scenario, new Set());
    validRuns.get(value.scenario).add(value.runId);
  }
  return { counts: Object.fromEntries([...validRuns].map(([scenario, runs]) => [scenario, runs.size])), invalid };
}

function markdown(report) {
  const lines = [
    '# P0证据就绪门禁', '',
    `- 生成时间：${report.generatedAt}`,
    `- Evidence：${report.gates.evidence ? '通过' : '未通过'}`,
    `- Provenance：${report.gates.provenance ? '通过' : '未通过'}`,
    `- Correctness design：${report.gates.correctness ? '通过' : '未通过'}`,
    `- Stability design：${report.gates.stability ? '通过' : '未通过'}`,
    `- Causal：${report.gates.causal ? '通过' : '未通过'}`,
    `- Release：${report.gates.release ? '通过' : '未通过'}`,
    '', '| 条件 | 状态 | 说明 |', '|---|---|---|',
  ];
  for (const item of report.checks) lines.push(`| ${item.id} | ${item.passed ? '通过' : '未完成'} | ${item.message} |`);
  lines.push('', '未完成项必须保留为显式门禁；禁止用红灯路径复现代替单因素因果证明。', '');
  return lines.join('\n');
}

async function main() {
  const red = read('p0-red-gate-report.json');
  const green = read('p0-green-gate-report.json');
  const repairGateIds = Array.isArray(red?.requiredGateIds) ? red.requiredGateIds.map(String) : [];
  const redResults = Array.isArray(red?.results) ? red.results : [];
  const repairRedReady = repairGateIds.length > 0
    ? repairGateIds.every(id => redResults.find(result => result?.id === id)?.reproduced === true)
    : red.verdict === 'red_gate_confirmed' && red.summary.reproduced === 7;
  const expectedControlCount = repairGateIds.length > 0 ? Number(red?.summary?.total || 0) : 7;
  const expectedGreenBeforeRepair = repairGateIds.length > 0
    ? Math.max(0, Number(green?.summary?.total || red?.summary?.total || 0) - repairGateIds.length)
    : 0;
  const provenance = read('p0-candidate-provenance.json');
  const expectedProvenance = {
    workspaceCommit: provenance?.chains?.diagnosticCandidate?.workspaceCommit || provenance?.workspace?.commit,
    candidateSha256: provenance?.chains?.diagnosticCandidate?.candidateSha256 || provenance?.candidate?.exe?.sha256,
  };
  const runtime = inspectRuntimeScenarios(expectedProvenance);
  const scenarios = runtime.counts;
  const dataAblation = inspectAblation('ablation-DATA-01.json', 'DATA-01', expectedProvenance);
  const pollAblation = inspectAblation('ablation-PERF-01.json', 'PERF-01', expectedProvenance);
  const heartbeatAblation = inspectAblation('ablation-PERF-02.json', 'PERF-02', expectedProvenance);
  const flowTimeline = inspectTimeline('p0-task-timeline.json', expectedProvenance);
  const processTrace = inspectProcessTrace('p0-cmd-process-trace.json', expectedProvenance);
  const releaseRegression = inspectReleaseRegression('p0-release-regression.json', expectedProvenance);
  const runtimeRepairPreview = inspectRuntimeRepairPreview('p0-runtime-repair-preview.json');
  const expectedOriginal = { buildCommit: provenance?.chains?.originalCandidate?.buildCommit,
    candidateSha256: provenance?.chains?.originalCandidate?.candidateSha256 };
  const originalFailureBaseline = inspectOriginalFailureBaseline('p0-original-candidate-failure-baseline.json', expectedOriginal);
  const originalChainReady = provenance?.chains?.originalCandidate?.status === 'verified_artifact_identity'
    && typeof provenance?.chains?.originalCandidate?.buildCommit === 'string'
    && provenance.chains.originalCandidate.buildCommit.length > 0
    && typeof provenance?.chains?.originalCandidate?.candidateSha256 === 'string'
    && provenance.chains.originalCandidate.candidateSha256.length > 0
    && (provenance?.chains?.originalCandidate?.observedRunningArtifactMatches === true
      || provenance?.chains?.originalCandidate?.runningArtifactMatches === true);
  const diagnosticChainReady = provenance?.chains?.diagnosticCandidate?.status === 'same_source_verified'
    && provenance?.chains?.diagnosticCandidate?.candidateSha256 === expectedProvenance.candidateSha256
    && provenance?.chains?.diagnosticCandidate?.workspaceCommit === expectedProvenance.workspaceCommit;
  const checks = [
    { id: 'RED-REPRO', passed: repairRedReady,
      message: repairGateIds.length > 0
        ? `${repairGateIds.filter(id => redResults.find(result => result?.id === id)?.reproduced === true).length}/${repairGateIds.length}新增路径稳定复现`
        : `${red.summary.reproduced}/7路径稳定复现` },
    { id: 'TEST-CONTROLS', passed: red.summary.controlsPassed === expectedControlCount && red.summary.harnessErrors === 0,
      message: `${red.summary.controlsPassed}/${expectedControlCount}阳性与旧缺陷对照有效，夹具错误${red.summary.harnessErrors}` },
    { id: 'GREEN-NOT-FALSE-POSITIVE', passed: (green.verdict === 'green_gate_failed'
        && green.summary.desiredPassed === expectedGreenBeforeRepair)
        || (green.verdict === 'green_gate_passed' && Number(green.summary.desiredPassed) === Number(green.summary.total)
          && Number(green.summary.controlsPassed) === Number(green.summary.total) && Number(green.summary.harnessErrors) === 0),
      message: green.verdict === 'green_gate_passed'
        ? `修复后${green.summary.desiredPassed}/${green.summary.total}目标及${green.summary.controlsPassed}/${green.summary.total}对照全部通过`
        : repairGateIds.length > 0
          ? `修复前已有${expectedGreenBeforeRepair}项通过，新增${repairGateIds.length}项仍为红灯`
          : '未修复工作树没有被绿色门禁误判为通过' },
    { id: 'ORIGINAL-CANDIDATE-CHAIN', passed: originalChainReady,
      message: originalChainReady ? '原候选运行包装器、构建审计和哈希已对应' : '原候选观察基线尚未独立建账或哈希不一致' },
    { id: 'DIAGNOSTIC-CANDIDATE-CHAIN', passed: diagnosticChainReady,
      message: diagnosticChainReady ? '诊断候选与测试工作树同源' : '尚无与当前测试源码同源的诊断候选' },
    { id: 'ORIGINAL-FAILURE-BASELINE', ...originalFailureBaseline },
    { id: 'ABLATION-DATA-01', ...dataAblation },
    { id: 'ABLATION-PERF-01', ...pollAblation },
    { id: 'ABLATION-PERF-02', ...heartbeatAblation },
    { id: 'FLOW-TIMELINE', ...flowTimeline },
    { id: 'PROCESS-TRACE', ...processTrace },
    { id: 'RUNTIME-REPAIR-PREVIEW', ...runtimeRepairPreview },
    { id: 'RUNTIME-IDLE-X3', passed: (scenarios.idle || 0) >= 3, message: `已有${scenarios.idle || 0}/3` },
    { id: 'RUNTIME-NORMAL-X3', passed: (scenarios['normal-task'] || 0) >= 3, message: `已有${scenarios['normal-task'] || 0}/3` },
    { id: 'RUNTIME-BACKLOG-X3', passed: (scenarios['backlog-recovery'] || 0) >= 3, message: `已有${scenarios['backlog-recovery'] || 0}/3` },
    { id: 'PATCHED-GREEN-GATE', passed: green.verdict === 'green_gate_passed' && green.summary.desiredPassed === green.summary.total,
      message: green.verdict },
    { id: 'RELEASE-REGRESSION', ...releaseRegression },
  ];
  const ids = {
    evidence: ['RED-REPRO', 'TEST-CONTROLS', 'GREEN-NOT-FALSE-POSITIVE'],
    provenance: ['ORIGINAL-CANDIDATE-CHAIN', 'DIAGNOSTIC-CANDIDATE-CHAIN'],
    causal: ['ORIGINAL-FAILURE-BASELINE', 'ABLATION-DATA-01', 'ABLATION-PERF-01', 'ABLATION-PERF-02', 'FLOW-TIMELINE', 'PROCESS-TRACE', 'RUNTIME-REPAIR-PREVIEW',
      'RUNTIME-IDLE-X3', 'RUNTIME-NORMAL-X3', 'RUNTIME-BACKLOG-X3'],
    release: ['PATCHED-GREEN-GATE', 'RELEASE-REGRESSION'],
  };
  const byId = new Map(checks.map(item => [item.id, item]));
  const allPass = values => values.every(id => byId.get(id)?.passed === true);
  const gates = { evidence: allPass(ids.evidence), provenance: allPass(ids.provenance) };
  gates.correctness = gates.evidence && gates.provenance;
  gates.stability = gates.evidence && gates.provenance;
  gates.causal = gates.provenance && allPass(ids.causal);
  gates.release = gates.evidence && gates.provenance && gates.causal && allPass(ids.release);
  const stageAlias = stage === 'pre' ? 'evidence' : stage;
  const stageReady = gates[stageAlias] === true;
  const requiredIds = stageAlias === 'evidence' ? ids.evidence
    : stageAlias === 'provenance' ? ids.provenance
      : stageAlias === 'correctness' || stageAlias === 'stability' ? [...ids.evidence, ...ids.provenance]
        : stageAlias === 'causal' ? [...ids.provenance, ...ids.causal]
          : [...ids.evidence, ...ids.provenance, ...ids.causal, ...ids.release];
  const incomplete = requiredIds.filter(id => !byId.get(id)?.passed);
  const report = { schema: 2, generatedAt: new Date().toISOString(), stage: stageAlias, directory,
    preAcceptanceReady: gates.evidence, causalFreezeReady: gates.causal, stageReady, gates, scenarios,
    invalidRuntimeEvidence: runtime.invalid, checks };
  const reportBase = `p0-${stageAlias}-readiness`;
  await fsp.writeFile(path.join(directory, `${reportBase}.json`), JSON.stringify(report, null, 2));
  await fsp.writeFile(path.join(directory, `${reportBase}.md`), markdown(report));
  process.stdout.write(`${JSON.stringify({ stage: stageAlias, stageReady, gates, incomplete }, null, 2)}\n`);
  process.exitCode = stageReady ? 0 : 1;
}

main().catch(error => { console.error(error); process.exitCode = 2; });
