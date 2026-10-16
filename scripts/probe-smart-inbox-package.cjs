'use strict';
// Synthetic, isolated ASAR probe: no credentials, user archives or model calls.
const { app } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const resources = path.resolve(process.argv[2]), reportPath = path.resolve(process.argv[3]);
const runtime = path.join(resources, 'app.asar', 'electron');
const root = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'edu-smart-package-'));
app.setPath('userData', root); app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const checks = [], hashes = {}; let error, service, taskHost;
  try {
    Object.defineProperty(process, 'resourcesPath', { value: resources });
    for (const name of ['smart-inbox.cjs', 'smart-inbox-policy.cjs', 'smart-inbox-agent.cjs', 'smart-inbox-host.cjs', 'smart-inbox-associations.cjs', 'agent-invocation-service.cjs', 'agent-authorization-detection.cjs', 'task-circuit-probe.cjs', 'task-executor-circuit.cjs', 'project-material-extract.cjs', 'workbuddy-runtime.cjs', 'workbuddy-controlled.cjs', 'workbuddy-cli-manager.cjs', 'classification-auth.cjs', 'student-controlled-material.cjs', 'project-material-host.cjs', 'project-materials.cjs', 'main.cjs', 'preload.cjs', 'capture-inbox.cjs', 'download-inbox.cjs', 'project-material-classification.cjs', 'task-protocol.cjs', 'task-store-service.cjs', 'task-progress-buffer.cjs', 'task-io-client.cjs', 'task-io-worker.cjs', 'task-store-writer.cjs', 'task-read-model.cjs']) {
      const packaged = await fs.readFile(path.join(runtime, name));
      assert.deepEqual(packaged, await fs.readFile(path.join(__dirname, '..', 'electron', name)));
      hashes[name] = crypto.createHash('sha256').update(packaged).digest('hex');
    }
    const legacyModule = await fs.readFile(path.join(runtime, 'smart-inbox-legacy.cjs'));
    assert.deepEqual(legacyModule, await fs.readFile(path.join(__dirname, '..', 'electron', 'smart-inbox-legacy.cjs')));
    hashes['smart-inbox-legacy.cjs'] = crypto.createHash('sha256').update(legacyModule).digest('hex');
    checks.push('packaged intake modules including unified legacy bridge and IPC/import dependencies exactly match current source');
    const invocation = require(path.join(runtime, 'agent-invocation-service.cjs'));
    const packagedStatus = invocation.agentProfileStatus({ providerId: 'codex', profile: invocation.CLASSIFICATION_PROFILE,
      capability: { available: true, authorized: true, exePath: 'synthetic-codex', label: 'Codex' }, circuit: { phase: 'authorization' } });
    assert.equal(packagedStatus.state, 'qualification_required'); assert.match(packagedStatus.message, /已登录/);
    checks.push('ASAR unified Agent profile status distinguishes logged-in qualification from login failure');
    const { detectCodexAuthorization } = require(path.join(runtime, 'agent-authorization-detection.cjs'));
    const authorizationStore = { runtime: { circuits: { codex: { phase: 'authorization', lastExecutionId: 'synthetic-old-run' } } } };
    let authorizationPersisted, syntheticProbeCalls = 0, syntheticReleases = 0;
    const authorizationResult = await detectCodexAuthorization({ confirmed: true, acquire: () => () => { syntheticReleases++; },
      refreshCapabilities: async () => ({ codex: { available: true, authorized: true, exePath: 'packaged-synthetic-codex' } }),
      probe: async executable => { syntheticProbeCalls++; assert.equal(executable, 'packaged-synthetic-codex'); return { passed: true }; },
      readStore: () => authorizationStore, writeStore: async value => { authorizationPersisted = value; }, now: () => '2026-10-12T08:00:00.000Z' });
    assert.equal(authorizationResult.automaticReady, true); assert.equal(authorizationPersisted.runtime.circuits.codex.phase, 'closed');
    assert.equal(authorizationStore.runtime.circuits.codex.phase, 'authorization'); assert.equal(syntheticProbeCalls, 1); assert.equal(syntheticReleases, 1);
    checks.push('ASAR Codex authorization recovery uses one synthetic probe, closes only persisted circuit and dispatches no document');
    const { createSmartInboxHost } = require(path.join(runtime, 'smart-inbox-host.cjs'));
    const { createProjectMaterialHost } = require(path.join(runtime, 'project-material-host.cjs'));
    const { createProjectMaterialExtractor } = require(path.join(runtime, 'project-material-extract.cjs'));
    const source = path.join(root, 'source'), destination = path.join(root, 'destination');
    await fs.mkdir(source); await fs.mkdir(destination);
    const file = path.join(source, 'packaged.txt'); await fs.writeFile(file, 'project-probe 合成项目实验记录');
    await fs.utimes(file, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
    const student = { id: 'probe-student', name: 'Synthetic' }; let deliveries = 0, allowSyntheticAgent = false, agentCalls = 0;
    const fakeExecutable = path.join(root, 'synthetic-agent-identity'); await fs.writeFile(fakeExecutable, 'not executable; injected test runner only');
    const p = { id: 'project-probe', name: 'Synthetic', studentIds: [student.id], materialStorageMode: 'workspace-v1',
      workspacePath: destination, managerPath: path.join(root, 'probe-manager'), rawPath: path.join(root, 'probe-raw') };
    const materialHost = createProjectMaterialHost(p);
    taskHost = await require('../tests/helpers/smart-inbox-task-host.cjs').createTaskHost(path.join(root, 'batch-ledger'), { runtime });
    service = createSmartInboxHost({ directory: path.join(root, 'state'), student: () => student, students: () => [student],
      projects: () => [p], isWorkspace: () => true, materialHost: () => materialHost,
      forbiddenRoots: () => [destination], automaticAllowed: () => true, acquire: () => () => {}, legacySettings: () => ({}),
      beginBatch: taskHost.beginBatch, endBatch: taskHost.endBatch,
      agent: {
        select: () => { if (!allowSyntheticAgent) throw Error('bound probe must not invoke Agent'); return { id: 'codex', executable: fakeExecutable }; },
        run: async (_adapter, input) => { agentCalls++; return { candidates: [{ studentId: input.context.studentId, type: 'project', id: input.context.projects[0].id,
          categoryId: '', score: .98, evidence: input.context.projects[0].id, reason: 'Synthetic project evidence' }], sensitive: false, conflict: false, reason: '' }; },
      }, validateTarget: async () => ({ project: p }),
      capture: () => ({ listStored: async () => [] }), conversations: async () => [],
      deliver: async (snapshot, _, operation, checkpoint) => {
        deliveries++; await checkpoint({ destinationPath: path.join(destination, '收件箱', `${operation.id}${path.extname(operation.name)}`) });
        await fs.mkdir(path.dirname(operation.destinationPath), { recursive: true });
        await fs.copyFile(snapshot, operation.destinationPath);
        const result = await materialHost.registerTerminalUpload(operation.destinationPath, { eventId: operation.id, studentId: student.id,
          sourceType: 'host_material_source', intakeAssociation: { itemId: operation.id, operationId: operation.operationId } });
        return { ok: true, recordId: result.material.materialId, path: operation.destinationPath };
      },
    });
    await service.initialize();
    const entry = await service.engine.updateSource({ folder: source, studentId: student.id, enabled: true, automatic: true,
      target: { studentId: student.id, type: 'project', id: 'project-probe' } });
    await service.engine.requestScan(entry.id); await service.engine.tick();
    assert.equal((await service.engine.list({ status: 'delivered' })).total, 1); assert.equal(deliveries, 1);
    assert.equal(taskHost.disk().tasks.length, 1); assert.equal(taskHost.disk().tasks[0].status, 'succeeded');
    assert.deepEqual(taskHost.events().filter(e => e.detail?.to).map(e => e.detail.to), ['approved', 'running', 'reviewing', 'succeeded']);
    checks.push('ASAR actual main batch callbacks + task protocol + storage Worker persist admitted/running/reviewing/succeeded');
    assert.equal((await service.engine.sources()).statistics.extracted, 1); await fs.access(file);
    checks.push('ASAR real extraction worker + trusted bound route + importer checkpoint + kept original');
    await service.engine.requestScan(entry.id); await service.engine.tick();
    assert.equal((await service.engine.sources()).statistics.extracted, 1); assert.equal(deliveries, 1);
    assert.equal(taskHost.disk().tasks.length, 1);
    checks.push('ASAR unchanged rescan does not extract or import again');
    const item = await service.engine.detail((await service.engine.list({ status: 'delivered' })).rows[0].id);
    assert.equal(item.extractionReuse.reused, true);
    const input = await materialHost.store.resolve(item.receipt.recordId, 1);
    const reused = await createProjectMaterialExtractor({ store: materialHost.store,
      documentRunner: () => { throw Error('packaged digest repeated extraction'); } }).extract(input);
    assert.equal(reused.cacheHit, true); assert.match(reused.text, /合成项目实验记录/);
    checks.push('ASAR authorized same-student full extraction handoff consumed by digestion without another parser');
    const sharedFolder = path.join(root, 'shared-source'); await fs.mkdir(sharedFolder);
    const JSZip = require('node:module').createRequire(require.resolve('exceljs'))('jszip'), zip = new JSZip();
    zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>project-probe 合成共享资料</w:t></w:r></w:p></w:body></w:document>');
    const sharedFile = path.join(sharedFolder, 'shared.docx'); await fs.writeFile(sharedFile, await zip.generateAsync({ type: 'nodebuffer' }));
    await fs.utimes(sharedFile, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
    const shared = await service.engine.updateSource({ folder: sharedFolder, studentId: '', enabled: true, automatic: true });
    await service.engine.requestScan(shared.id); await service.engine.tick();
    const sharedRow = (await service.engine.list({ sourceId: shared.id })).rows[0];
    assert.equal(agentCalls, 0); allowSyntheticAgent = true;
    const confirmation = { requestId: 'packaged-student-confirmation', action: 'confirm_student', items: [{ id: sharedRow.id, revision: sharedRow.revision, studentId: student.id }] };
    assert.equal((await service.engine.decide(confirmation)).results[0].ok, true); await service.engine.tick();
    assert.equal((await service.engine.list({ sourceId: shared.id, status: 'delivered' })).total, 1);
    assert.equal((await service.engine.sources()).sources.find(s => s.id === shared.id).studentId, '');
    assert.equal(agentCalls, 2, 'synthetic qualification and one synthetic classification, no external process');
    assert.equal(deliveries, 2); assert.equal((await service.engine.detail(sharedRow.id)).extractionReuse.reused, true);
    await service.engine.decide(confirmation); await service.engine.requestScan(shared.id); await service.engine.tick();
    assert.equal(agentCalls, 2); assert.equal(deliveries, 2); await fs.access(sharedFile);
    assert.ok(taskHost.disk().tasks.every(t => t.status === 'succeeded'));
    checks.push('ASAR real DOCX with parser scope notices -> shared student confirmation -> synthetic classifier -> trusted delivery, scoped extraction reuse and idempotent replay');
    const staleFile = path.join(sharedFolder, 'missing.txt'); await fs.writeFile(staleFile, 'synthetic stale original');
    await fs.utimes(staleFile, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
    await service.engine.requestScan(shared.id); await service.engine.tick(); await fs.unlink(staleFile);
    await service.engine.requestScan(shared.id); await service.engine.tick();
    const stale = (await service.engine.list()).rows.find(r => r.name === 'missing.txt'); assert.equal(stale.originalMissing, true);
    assert.equal((await service.engine.decide({ requestId: 'remove-stale', action: 'ignore', items: [stale] })).results[0].ok, true);
    assert.equal((await service.engine.list({ status: 'ignored' })).total, 1); assert.equal(deliveries, 2); assert.equal(agentCalls, 2);
    checks.push('ASAR stale original is marked and removed from pending without deleting history or dispatching Agent');
    const { createIntakeAssociations } = require(path.join(runtime, 'smart-inbox-associations.cjs'));
    const { hashStableFile } = require(path.join(runtime, 'project-materials.cjs'));
    const projects = ['old-project', 'new-project'].map(id => ({ id, name: id, studentIds: [student.id], materialStorageMode: 'workspace-v1',
      workspacePath: path.join(root, id, 'workspace'), rawPath: path.join(root, id, 'raw'), managerPath: path.join(root, id, 'manager') }));
    const hosts = new Map(projects.map(p => [p.id, createProjectMaterialHost(p)]));
    const associations = createIntakeAssociations({ student: () => student, projects: () => projects,
      isWorkspace: () => true, materialHost: p => hosts.get(p.id), externalReferences: () => [] });
    for (const referenced of [false, true]) {
      const item = { id: referenced ? 'referenced-intake' : 'unreferenced-intake', operationId: 'probe-reroute' }, entries = [];
      for (const p of projects) {
        const file = path.join(p.workspacePath, '收件箱', item.id + '.txt'); await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, 'Synthetic ' + item.id); item.fingerprint = await hashStableFile(file);
        const registered = await hosts.get(p.id).registerTerminalUpload(file, { eventId: item.id, studentId: student.id,
          sourceType: 'host_material_source', intakeAssociation: { itemId: item.id, operationId: item.operationId } });
        const entry = { target: { type: 'project', id: p.id, studentId: student.id }, receipt: { ok: true, recordId: registered.material.materialId, path: file } };
        Object.assign(item, entry); await associations.bind(item); entries.push(entry);
      }
      const oldStore = hosts.get(projects[0].id).store;
      if (referenced) await oldStore.mutate(index => { index.materials.find(m => m.materialId === entries[0].receipt.recordId).links.knowledge = [{ knowledgeId: 'synthetic-knowledge', version: 1 }]; });
      const result = await associations.withdraw(item, entries[0]); assert.equal(result.retained, referenced);
      const old = (await oldStore.read()).materials.find(m => m.materialId === entries[0].receipt.recordId);
      assert.equal(old.adoption.state, referenced ? 'accepted' : 'excluded'); await fs.access(entries[0].receipt.path);
      await fs.access((await oldStore.resolve(old.materialId, 1)).path);
      assert.deepEqual(await associations.withdraw(item, entries[0]), result);
    }
    checks.push('ASAR actual registry: unreferenced association withdrawn, referenced adoption retained, original/version snapshots preserved, replay idempotent');
  } catch (e) { error = e.stack; }
  finally { await service?.engine.close(); await taskHost?.close(); await fs.rm(root, { recursive: true, force: true }); }
  const report = { at: new Date().toISOString(), ok: !error, kind: 'isolated-packaged-runtime-not-real-agent-acceptance', resources, checks, hashes, error };
  await fs.mkdir(path.dirname(reportPath), { recursive: true }); await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); app.exit(error ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
