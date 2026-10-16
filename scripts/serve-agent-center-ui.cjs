'use strict';
// Real renderer + production IPC action and policy store. Only installation and
// login observations are synthetic; no production profile or Agent is opened.
const fs = require('node:fs/promises'), fss = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-center-ui-'));
  const students = (process.env.R20_UI_EMPTY_STUDENTS === '1' ? [] : ['test-a', 'test-b']).map((id, i) => ({ id, name: ['合成学生甲', '合成学生乙'][i], agentTool: 'workbuddy' }));
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const profiles = require('../electron/agent-invocation-service.cjs');
  const logins = new Map();
  const ctx = vm.createContext({ fs: fss, path, ...profiles, app: { getPath: () => root },
    process, __dirname: path.join(__dirname, '../electron'), getHostServicePort: () => 5189,
    agentAccessGrantStorePath: () => path.join(root, 'agent-access-grants.json'),
    agentWriteIntentPath: () => path.join(root, 'agent-write-intents.json'),
    writeJsonAtomic: require('../electron/digest-batch.cjs').writeJsonAtomic,
    crypto: require('node:crypto'), toHostStudent: value => value, ensureStudentAgentAccessToken() {},
    builtinStructuredProvider: require('../electron/builtin-structured-provider.cjs'),
    findAgentToolInstall: () => ({}), readAgentWriteIntents: () => ({ intents: [] }),
    adapterCapabilityCache: { at: 0 }, activeCaptureTarget: () => ({}), safeReadJson: () => ({}), activeAgentKnowledgeDescriptorPath: () => path.join(root, 'inactive.json'),
    getCustomOptions: () => require('../electron/custom-options.cjs').createCustomOptions({ toolsDir: path.join(root, 'custom-options') }),
    require: name => require(path.join(__dirname, '../electron', name)),
    findStudentByKey: id => students.find(s => s.id === id), readStudentsIndex: () => students,
    readProjects: () => [{ id: 'project-a', name: '甲的合成项目', studentIds: ['test-a'], status: 'active' }], normalizeProject: p => p,
    readTaskStore: () => ({ runtime: {}, tasks: [] }), smartInboxHostRuntime: null, notify() {},
    classificationAdapter: async id => ({ id, unavailable: false, executable: 'synthetic', authScope: 'synthetic' }),
    classificationAuth: () => ({ status: id => logins.get(id) || null }),
    getLlmApiProvider: () => ({ get: async () => ({ schema: 'edu-manager.llm-api.v1', revision: 0,
      protocol: 'openai-responses', protocolLabel: 'OpenAI Responses', baseUrl: 'https://api.openai.com/v1', model: '', configured: false,
      runtimeHash: '', hasApiKey: false, lastCheck: null, lastResearchCheck: null, researchSupported: true, researchReady: false }) }),
    currentStudentAgentStatus: student => ({ providerId: student.agentTool, state: student.agentTool === 'workbuddy' ? 'login_required' : 'qualification_required', message: student.agentTool === 'workbuddy' ? '合成场景：WorkBuddy 后台尚未认证。' : '合成场景：Codex 等待任务资格验证。' }),
  });
  vm.runInContext('let agentControlStoreRuntime, externalConnectorRuntime, hostServer = { synthetic: true };', ctx);
  for (const name of ['agentControlStore', 'aiExecutorRegistry', 'agentControlPolicy', 'agentClassificationRoute', 'agentControlAction', 'externalConnectorStore', 'externalConnectionDirectory', 'unifiedKnowledgeRegistrations', 'writeExternalConnectionRuntimeConfig', 'externalConnectorAction']) {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), ctx);
  }
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 5189, strictPort: true, hmr: { host: '127.0.0.1', port: 5189 } }, plugins: [{ name: 'agent-center-isolated', configureServer(vite) {
    vite.middlewares.use('/__agent_center_test', async (req, res) => {
      try {
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 20000) throw Error('oversize'); }
        const { action, input } = JSON.parse(body);
        if (action === 'syntheticOpen') {
          const c = ctx.externalConnectorStore().snapshot().connections.find(c => c.status === 'active'); if (!c) throw Error('请先建立连接');
          const token = await fs.readFile(path.join(root, 'external-connectors', c.connectionId, 'credential'), 'utf8');
          const data = await ctx.externalConnectorStore().open(token, '合成会话-1'); res.end(JSON.stringify({ ok: true, data })); return;
        }
        if (['authorize', 'verify', 'verifyResearch'].includes(action)) {
          await new Promise(resolve => setTimeout(resolve, 650));
          if (action === 'authorize') {
            logins.set(input.providerId, { state: 'running', message: '合成官方登录页已打开，请完成登录' });
            setTimeout(() => logins.set(input.providerId, { state: 'finished', message: '合成官方后台登录已确认；请点击“我已完成登录，继续”' }), 1800);
          }
          if (action === 'verify') logins.delete(input.providerId);
          const labels = { authorize: '合成授权窗口已启动', verify: '合成连接验证已完成', verifyResearch: '合成联网研究合同已通过' };
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, data: { message: labels[action] } })); return;
        }
        if (!['snapshot', 'loginStatus', 'saveGlobal', 'addTool', 'editTool', 'removeTool'].includes(action) && !['external:snapshot', 'external:savePolicy', 'external:createConnection', 'external:connection', 'external:bindSession', 'external:pause', 'external:resume', 'external:revoke'].includes(action)) throw Error('隔离验收不启动真实授权或任务');
        const data = action.startsWith('external:')
          ? await ctx.externalConnectorAction(action.slice('external:'.length), input)
          : await ctx.agentControlAction(action, input);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, data }));
      } catch (e) { res.end(JSON.stringify({ ok: false, message: e.message })); }
    });
  } }] });
  await server.listen(); console.log('http://127.0.0.1:5189/tests/fixtures/agent-center-ui.html');
})().catch(error => { console.error(error); process.exitCode = 1; });
