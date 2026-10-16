'use strict';
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createSmartInbox } = require('../electron/smart-inbox.cjs');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-smart-inbox-ui-'));
  const source = path.join(root, 'source'), authSource = path.join(root, 'authorization'), extra = path.join(root, 'extra'), destination = path.join(root, 'destination');
  for (const dir of [source, authSource, extra, destination]) await fs.mkdir(dir);
  for (let i = 0; i < 3; i++) await fs.writeFile(path.join(source, `实验记录${i + 1}.txt`), `物理项目第${i + 1}次测量。project-physics。`);
  await fs.writeFile(path.join(source, '已失效资料.docx'), 'synthetic missing file');
  await fs.writeFile(path.join(authSource, '授权恢复验证.txt'), 'AUTH-RECOVERY project-physics 合成授权恢复资料');
  let authorizationReady = false, fallbackEnabled = false;
  const context = id => ({ studentId: id, projects: [{ id: 'project-physics', name: '物理研究', categories: [{ categoryId: 'notes', name: '实验记录' }] }] });
  const engine = createSmartInbox({ directory: path.join(root, 'state'), stableAgeMs: 0, forbiddenRoots: () => [destination], automaticAllowed: () => true,
    context: async id => context(id), validateTarget: async target => { if (!['test-a', 'test-b'].includes(target.studentId)) throw Error('学生范围无效'); return target; },
    extract: async item => ({ text: await fs.readFile(item.snapshotPath, 'utf8'), warnings: [] }),
    classify: async input => {
      if (input.text.includes('AUTH-RECOVERY') && !authorizationReady) throw Object.assign(Error('后台未登录，资料已保留'), { code: 'AUTHENTICATION_REQUIRED',
        blockReason: { code: 'AUTHENTICATION_REQUIRED', category: 'agent', stage: 'qualifying', recoverable: true, message: '后台未登录，资料已保留' } });
      return { candidates: [{ studentId: input.context.studentId, type: 'project', id: 'project-physics', categoryId: '', score: input.text.includes('第1次') || input.text.includes('AUTH-RECOVERY') ? .98 : .8, evidence: 'project-physics', reason: input.text.includes('第1次') || input.text.includes('AUTH-RECOVERY') ? '明确项目编号，通过可信校验' : '正文介绍物理实验，建议人工确认' }], sensitive: false, conflict: false, reason: '建议确认实验归属' };
    },
    deliver: async (snapshot, target, item, checkpoint) => { const file = path.join(destination, `${target.studentId}-${item.id}.txt`); await checkpoint({ destinationPath: file }); await fs.copyFile(snapshot, file); return { ok: true, path: file, recordId: item.id }; },
    acquire: () => () => {}, events: async () => [],
  });
  await engine.init(); const initial = await engine.updateSource({ folder: source, name: '共享实验资料', studentId: '', enabled: true, automatic: true });
  await engine.requestScan(initial.id); await engine.tick();
  const authorization = await engine.updateSource({ folder: authSource, name: '授权恢复测试', studentId: 'test-a', enabled: true, automatic: false });
  await engine.requestScan(authorization.id); await engine.tick();
  await fs.unlink(path.join(source, '已失效资料.docx')); await engine.requestScan(initial.id); await engine.tick();
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 5187, strictPort: true }, plugins: [{ name: 'smart-inbox-isolated', configureServer(vite) {
    vite.middlewares.use('/__smart_inbox_test', async (req, res) => {
      try {
        let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 100000) throw Error('request too large'); }
        const { action, input = {} } = JSON.parse(text); let data;
        if (action === 'sources') data = await engine.sources();
        else if (action === 'list') data = await engine.list(input);
        else if (action === 'choose') data = { folder: extra, canceled: false };
        else if (action === 'saveSource') data = await engine.updateSource(input);
        else if (action === 'scan') data = await engine.requestScan(input.id);
        else if (action === 'decide') data = await engine.decide(input);
        else if (action === 'defaults') data = await engine.setDefaults(input);
        else if (action === 'pause') data = await engine.pause(input.id);
        else if (action === 'detach') data = await engine.detach(input.id);
        else if (action === 'detail') data = await engine.detail(input.id);
        else if (action === 'context') data = context(input.studentId);
        else if (action === 'continueAgent') { authorizationReady = true; data = await engine.resumeAgent(input.studentId, input.requestId); await engine.tick(); data.message = `已恢复 ${data.count} 项`; }
        else if (action === 'authorizeAgent') data = { message: '隔离界面测试：正式应用将自动准备官方 CLI 并打开登录页，不要求选择 JSON' };
        else if (action === 'saveFallback') { fallbackEnabled = input.enabled === true; authorizationReady = fallbackEnabled;
          data = fallbackEnabled ? await engine.resumeAgent(input.studentId, input.requestId) : { count: 0 }; if (fallbackEnabled) await engine.tick();
          data.message = fallbackEnabled ? `Codex 备用已启用并恢复 ${data.count} 项` : '备用切换已关闭'; }
        else if (action === 'agentStatus') data = authorizationReady
          ? { providerId: 'workbuddy', effectiveProviderId: 'codex', label: 'Codex', state: 'ready', automaticReady: true, message: '备用 Agent 已完成受控分类。切换学生无需重新登录。', fallback: { enabled: fallbackEnabled, version: 1, providerId: 'codex' }, fallbackStatus: { state: 'ready', providerId: 'codex', label: 'Codex', automaticReady: true } }
          : { providerId: 'workbuddy', label: 'WorkBuddy', state: 'login_required', automaticReady: false, message: 'WorkBuddy 后台尚未授权。', fallback: { enabled: fallbackEnabled, version: 0 } };
        else if (action === 'detectAgent') {
          if (input.studentId !== 'test-a' || input.confirmed !== true) throw Error('合成检测范围或确认无效');
          authorizationReady = true;
          data = { ok: true, adapterId: 'codex', authorized: true, automaticReady: true, message: 'Codex 合成检测通过；请选择资料后重新分析。' };
        }
        else if (action === 'open') data = { file: await engine.openOriginal(input.id) };
        else throw Error('unknown action');
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, data }));
      } catch (e) { res.end(JSON.stringify({ ok: false, message: e.message })); }
    });
  } }] });
  await server.listen(); console.log('Smart inbox isolated QA: http://127.0.0.1:5187/tests/fixtures/smart-inbox-ui.html');
  process.on('SIGINT', async () => { await engine.close(); await server.close(); await fs.rm(root, { recursive: true, force: true }); process.exit(0); });
})().catch(e => { console.error(e); process.exitCode = 1; });
