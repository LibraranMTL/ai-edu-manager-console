'use strict';

const { buildProjectReportSnapshot, POLICY_VERSION, sha256 } = require('./project-report-snapshot.cjs');
const { buildM1ProjectReport, buildM2ProjectReport, compareReportClaims, M2_POLICY_VERSION } = require('./project-report-claims.cjs');
const { projectReportProjection, citationProjection } = require('./project-report-access.cjs');

function text(value) { return String(value ?? '').trim(); }
function statusLabel(status) { return ({ active: '进行中', paused: '已暂停', completed: '已完成待归档', archived: '已归档', published: '已发布' })[text(status)] || '状态待核对'; }
function emptyProjection(project, authorizationVersion, asOf) {
  return { projectId: text(project.id), snapshotId: '', versionId: '', reportType: 'stage_summary', status: 'empty', asOf,
    policyVersion: POLICY_VERSION, dataGeneration: 0, authorizationVersion,
    project: { name: text(project.name), type: text(project.type), status: text(project.status || 'active'),
      objective: text(project.objective), description: text(project.description), deliverables: Array.isArray(project.deliverables) ? project.deliverables : [] },
    summary: { currentStage: statusLabel(project.status), changes: '尚未构建阶段摘要。', representativeResults: [],
      nextAction: project.objective ? '添加能证明当前阶段的资料，然后构建阶段摘要。' : '先补充项目目标和完成标准。' },
    claims: [], gaps: [project.objective ? '尚无固定证据快照。' : '尚未登记明确项目目标。'], personalContributions: [],
    coverage: { materials: { total: 0, analyzed: 0, unavailable: 0, pending: 0 }, knowledge: { total: 0, analyzed: 0, pending: 0 }, contributions: { confirmed: 0, unconfirmed: 0 } },
    disclaimer: '尚无项目报告版本；当前只显示项目登记信息，读取不会扫描目录、派发任务或写入项目。' };
}

function createProjectReportService({ store, loadProject, loadRegistry, authorizationVersion, enqueueTask = async () => {}, now = Date.now } = {}) {
  if (!store || typeof loadProject !== 'function' || typeof loadRegistry !== 'function' || typeof authorizationVersion !== 'function') {
    throw new Error('Project report service dependencies are required');
  }
  async function get(reader, projectId, asOf = new Date(now()).toISOString()) {
    const project = await loadProject(projectId);
    if (!project) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
    const currentAuthorization = authorizationVersion(project);
    const current = store.getCurrentProjectReport(projectId);
    if (!current) return emptyProjection(project, currentAuthorization, asOf);
    const versions = store.listProjectReportVersions(projectId);
    if (text(current.snapshot.authorizationVersion) !== text(currentAuthorization)) {
      const empty = emptyProjection(project, currentAuthorization, asOf);
      return { ...empty, status: 'authorization_changed', authorizationNotice: '项目成员或授权已变化，旧版本内容已立即停止展示。',
        gaps: ['项目成员或授权已变化，旧总体报告已停止展示。'],
        summary: { ...empty.summary, changes: '授权已变化，需要明确更新总体报告。' },
        previousVersionId: versions[1]?.versionId || '', versions };
    }
    return { ...projectReportProjection({ ...reader, authorizationVersion: currentAuthorization }, current.snapshot, current.version.report, current.version),
      status: 'ready', authorizationNotice: '',
      previousVersionId: versions[1]?.versionId || '', versions };
  }
  async function refresh(scope, reader, projectId, asOf = new Date(now()).toISOString()) {
    const project = await loadProject(projectId);
    if (!project) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
    const currentAuthorization = authorizationVersion(project);
    const snapshot = await buildProjectReportSnapshot({ projectId, asOf, authorizationVersion: currentAuthorization,
      loadProject: () => loadProject(projectId), loadRegistry: () => loadRegistry(projectId) });
    const snapshotCommitKey = sha256(`project-report-snapshot\n${projectId}\n${snapshot.inputFingerprint}\n${currentAuthorization}`);
    const savedSnapshot = store.saveSnapshot(scope, snapshot, snapshotCommitKey);
    const report = buildM1ProjectReport(savedSnapshot);
    const reportCommitKey = sha256(`project-report-m1\n${projectId}\n${savedSnapshot.inputFingerprint}\n${report.policyVersion}`);
    const version = store.commitReportVersion(scope, { snapshotId: savedSnapshot.snapshotId, commitKey: reportCommitKey, report });
    return { ...projectReportProjection({ ...reader, authorizationVersion: currentAuthorization }, savedSnapshot, version.report, version), status: 'ready' };
  }
  async function citation(reader, projectId, versionId, citationId) {
    const project = await loadProject(projectId);
    if (!project) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
    const current = store.getProjectReportVersion(projectId, versionId);
    if (!current) throw Object.assign(new Error('项目报告版本不存在或已变化。'), { code: 'project_report_version_missing' });
    const currentAuthorization = authorizationVersion(project);
    if (text(current.snapshot.authorizationVersion) !== text(currentAuthorization)) throw Object.assign(new Error('项目授权已变化。'), { code: 'subject_scope_forbidden' });
    return citationProjection({ ...reader, authorizationVersion: currentAuthorization }, current.snapshot, citationId);
  }
  async function requestUpdate(scope, reader, projectId, options = {}) {
    const project = await loadProject(projectId);
    if (!project) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
    const currentAuthorization = authorizationVersion(project);
    const asOf = text(options.asOf) || new Date(now()).toISOString();
    const snapshot = await buildProjectReportSnapshot({ projectId, asOf, authorizationVersion: currentAuthorization,
      loadProject: () => loadProject(projectId), loadRegistry: () => loadRegistry(projectId) });
    const snapshotCommitKey = sha256(`project-report-snapshot\n${projectId}\n${snapshot.inputFingerprint}\n${currentAuthorization}`);
    const savedSnapshot = store.saveSnapshot(scope, snapshot, snapshotCommitKey);
    const taskKey = sha256(`project-overall-report\n${projectId}\n${savedSnapshot.inputFingerprint}\n${M2_POLICY_VERSION}\noverall`);
    const taskId = `task-project-overall-report-${taskKey.slice(0, 20)}`;
    const run = store.ensureGenerationRun(scope, { taskId, taskKey, projectId, snapshotId: savedSnapshot.snapshotId,
      reportType: 'overall', policyVersion: M2_POLICY_VERSION });
    const task = {
      id: taskId, kind: 'project_overall_report', title: `${text(project.name) || '项目'}总体报告更新`,
      sourceType: 'project', sourceId: projectId, sourceName: text(project.name), status: 'pending',
      trigger: text(options.trigger) || 'manual', automaticExecution: options.trigger === 'automatic',
      executor: 'internal', executionMode: 'internal', idempotencyKey: taskKey, workKey: taskKey,
      sourceVersion: savedSnapshot.inputFingerprint, pipelineVersion: M2_POLICY_VERSION, riskLevel: 'low',
      input: { operation: 'generate_project_overall_report', snapshotId: savedSnapshot.snapshotId,
        inputFingerprint: savedSnapshot.inputFingerprint, authorizationVersion: currentAuthorization,
        reportType: 'overall', policyVersion: M2_POLICY_VERSION },
      expectedOutput: { type: 'project_report_candidate_v1', hostManaged: true },
      permissions: { read: [], write: [], operations: ['read_project_report_snapshot'] },
      completionPolicy: 'auto_after_validation', autoRetry: false,
    };
    if (run.created) await enqueueTask(task);
    return { projectId, task, run, reused: !run.created, reader: { ...reader, authorizationVersion: currentAuthorization } };
  }
  async function settleUpdate(scope, reader, input = {}) {
    const run = store.getGenerationRun(input.taskId);
    if (!run) throw Object.assign(new Error('项目报告生成任务不存在。'), { code: 'project_report_task_missing' });
    if (run.status === 'succeeded' && run.versionId) return getVersion(reader, run.projectId, run.versionId);
    store.beginGenerationRun(scope, run.taskId, input.executionId);
    const frozen = store.getSnapshot(run.snapshotId);
    try {
      const project = await loadProject(run.projectId);
      if (!project) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
      const currentAuthorization = authorizationVersion(project);
      const currentSnapshot = await buildProjectReportSnapshot({ projectId: run.projectId, asOf: new Date(now()).toISOString(),
        authorizationVersion: currentAuthorization, loadProject: () => loadProject(run.projectId), loadRegistry: () => loadRegistry(run.projectId) });
      if (text(currentAuthorization) !== text(frozen.authorizationVersion)
        || text(currentSnapshot.inputFingerprint) !== text(frozen.inputFingerprint)) {
        store.settleGenerationRun(scope, run.taskId, { status: 'stale', executionId: input.executionId,
          errorCode: 'project_report_input_changed' });
        throw Object.assign(new Error('项目范围、证据或授权已变化，旧结果未提交。'), { code: 'project_report_input_changed' });
      }
      const previous = store.getCurrentProjectReport(run.projectId);
      const report = buildM2ProjectReport(frozen, previous?.version?.report || null, input.candidate || {});
      const version = store.commitReportVersion(scope, { snapshotId: frozen.snapshotId, commitKey: run.taskKey,
        expectedCurrentVersionId: run.baseVersionId, report });
      store.settleGenerationRun(scope, run.taskId, { status: 'succeeded', executionId: input.executionId,
        versionId: version.versionId, resultHash: report.contentFingerprint });
      return { ...projectReportProjection({ ...reader, authorizationVersion: currentAuthorization }, frozen, version.report, version),
        status: 'ready', previousVersionId: run.baseVersionId, changes: version.report.changes,
        versions: store.listProjectReportVersions(run.projectId) };
    } catch (error) {
      if (!['project_report_input_changed', 'project_report_current_changed'].includes(error.code)) {
        try { store.settleGenerationRun(scope, run.taskId, { status: 'failed', executionId: input.executionId, errorCode: error.code || 'project_report_generation_failed' }); } catch { /* keep original */ }
      }
      throw error;
    }
  }
  async function getVersion(reader, projectId, versionId) {
    const project = await loadProject(projectId);
    if (!project) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
    const record = store.getProjectReportVersion(projectId, versionId);
    if (!record) throw Object.assign(new Error('项目报告版本不存在。'), { code: 'project_report_version_missing' });
    const currentAuthorization = authorizationVersion(project);
    if (text(record.snapshot.authorizationVersion) !== text(currentAuthorization)) {
      throw Object.assign(new Error('项目授权已变化，历史版本不可按旧授权展示。'), { code: 'subject_scope_forbidden' });
    }
    const versions = store.listProjectReportVersions(projectId);
    const index = versions.findIndex((item) => item.versionId === versionId);
    return { ...projectReportProjection({ ...reader, authorizationVersion: currentAuthorization }, record.snapshot, record.version.report, record.version),
      status: 'ready', authorizationNotice: '',
      previousVersionId: index >= 0 ? versions[index + 1]?.versionId || '' : '', changes: record.version.report.changes,
      versions };
  }
  async function listVersions(reader, projectId) {
    const project = await loadProject(projectId);
    if (!project) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
    if (!reader?.role) throw Object.assign(new Error('报告读者身份无效。'), { code: 'subject_scope_forbidden' });
    return store.listProjectReportVersions(projectId);
  }
  async function compareVersions(reader, projectId, fromVersionId, toVersionId) {
    const from = store.getProjectReportVersion(projectId, fromVersionId), to = store.getProjectReportVersion(projectId, toVersionId);
    if (!from || !to) throw Object.assign(new Error('项目报告比较版本不存在。'), { code: 'project_report_version_missing' });
    await getVersion(reader, projectId, fromVersionId); await getVersion(reader, projectId, toVersionId);
    return { projectId, fromVersionId, toVersionId, ...compareReportClaims(from.version.report, to.version.report.claims || []) };
  }
  return { get, refresh, citation, requestUpdate, settleUpdate, getVersion, listVersions, compareVersions };
}

module.exports = { createProjectReportService, emptyProjection };

