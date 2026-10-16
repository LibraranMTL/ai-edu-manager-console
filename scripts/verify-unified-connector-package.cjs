'use strict';
// Electron/asar + real PowerShell + HTTP verification; isolated synthetic home,
// never rewrites the user's actual MCP configs or student data.
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict');
const http = require('node:http'), { spawn } = require('node:child_process'), readline = require('node:readline');
const resources = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-unified-package-'));
app.setPath('userData', root); app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const report = { syntheticOnly: true, actualUserConfigsModified: false, packageSha256: require('node:crypto').createHash('sha256').update(require('original-fs').readFileSync(path.join(resources, 'app.asar'))).digest('hex'), checks: [], passed: false };
  let server, child;
  try {
    const electronDir = process.env.EDU_SOURCE_RUNTIME === '1' ? path.resolve(__dirname, '../electron') : path.join(resources, 'app.asar/electron'), load = name => require(path.join(electronDir, name));
    report.runtime = process.env.EDU_SOURCE_RUNTIME === '1' ? 'source' : 'packaged';
    const students = [{ id: 's1', name: '合成学生甲' }, { id: 's2', name: '合成学生乙' }];
    const projects = [{ id: 'p1', studentIds: ['s1'] }];
    const proofCode = 'report-proof-' + require('node:crypto').randomUUID();
    const reportText = `# 合成学生甲整体画像\n只用于连接器验收，不是真实学情。\n${'已有编程项目交付证据，长期学习习惯仍需观察。\n'.repeat(8)}最后验收码：${proofCode}`;
    const reportFile = path.join(root, 'host-private-report.md'); fs.writeFileSync(reportFile, reportText);
    const bridgePath = path.join(root, 'agent-knowledge-active/agent-knowledge-mcp.ps1'), descriptorPath = path.join(root, 'agent-knowledge-active/agent-knowledge-access.json');
    for (const dir of ['.codex', '.workbuddy', '.codebuddy']) fs.mkdirSync(path.join(root, dir));
    fs.writeFileSync(path.join(root, '.codex/config.toml'), '# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:START\n[mcp_servers.edu-manager-knowledge]\ncommand = "powershell.exe"\nargs = []\n# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:END\n');
    for (const file of ['.workbuddy/mcp.json', '.codebuddy/.mcp.json']) fs.writeFileSync(path.join(root, file), JSON.stringify({ mcpServers: { 'edu-manager-knowledge': { command: 'powershell.exe', args: ['agent-knowledge-mcp.ps1'] }, unrelated: { command: 'untouched' } } }));
    const ctx = vm.createContext({ fs, path, os: { homedir: () => root }, app: { getPath: () => root }, process: { execPath: path.join(resources, '../AI Education Manager Console.exe'), env: {} }, __dirname: electronDir,
      readStudentsIndex: () => students, readProjects: () => projects, normalizeProject: p => p, getStudentRootDir: name => path.join(root, name),
      agentAccessGrantStorePath: () => path.join(root, 'grants.json'), agentWriteIntentPath: () => path.join(root, 'writes.json'), readAgentWriteIntents: () => ({ intents: [] }),
      activeAgentKnowledgeDescriptorPath: () => descriptorPath, activeAgentKnowledgeMcpBridgePath: () => bridgePath,
      writeJsonAtomic: load('digest-batch.cjs').writeJsonAtomic, require: load, getHostServicePort: () => server.address().port,
      findStudent: id => students.find(s => s.id === id), projectAllowed: () => true,
      authorizeCapability: load('agent-capability-contract.cjs').authorizeCapability, CONTRACT_VERSION: load('agent-capability-contract.cjs').CONTRACT_VERSION,
      LEARNING_REPORTS: [{ id: 'profile', title: '整体画像' }], learningReportPathForStudent: () => reportFile,
    });
    vm.runInContext('let externalConnectorRuntime; let hostServer = true; let externalHostActionBusy = false;', ctx);
    const source = fs.readFileSync(path.join(electronDir, 'main.cjs'), 'utf8');
    for (const name of ['agentCapabilityReceipt', 'invokeAgentCapability', 'externalConnectorStore', 'externalConnectionDirectory', 'unifiedKnowledgeRegistrations', 'unifiedKnowledgeArgs', 'unifiedKnowledgeServer', 'externalHostInstallOptions', 'externalHostStatuses', 'externalHostLifecycleAction', 'writeExternalConnectionRuntimeConfig', 'refreshExternalConnectionRuntimeConfigs', 'externalConnectorAction']) {
      const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
      assert.ok(start >= 0, name); vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), ctx);
    }
    const connectors = ctx.externalConnectorStore();
    const ledger = { schema: load('agent-write-intents.cjs').WRITE_INTENT_SCHEMA, intents: [] };
    let saved = ledger, writes = 0;
    const writer = load('external-agent-writes.cjs').createExternalWriter({ load: () => structuredClone(saved), save: async value => { saved = value; },
      authenticate: (token, body, intent, readOnly) => intent ? connectors.resolveOperation(token, body, intent, readOnly) : connectors.resolve(token, body.sessionId, body.contextRevision, body.targetStudentId),
      project: id => projects.find(p => p.id === id), apply: async intent => { writes++; return { materialId: intent.id, studentId: intent.studentId }; } });
    const gateway = load('external-agent-host.cjs').createExternalGateway({ connectors, writer, memory: () => { throw Error('multi-student memory must not run'); }, projects: () => projects,
      invoke: async (request, name, input) => ['student.overview', 'report.list', 'report.read'].includes(name) ? ctx.invokeAgentCapability(request, name, input) : ({ ...load('agent-capability-contract.cjs').authorizeCapability(request.authContext, name, input), studentId: input.studentId, sources: [`edu://student/${input.studentId}/synthetic`] }) });
    let liveOnly = false; const liveReceipts = [];
    server = http.createServer(async (req, res) => { try {
      let raw = ''; for await (const b of req) raw += b; const body = JSON.parse(raw);
      if (liveOnly && (!['health', 'describe', 'open', 'students', 'invoke', 'queryMany'].includes(body.action) || ['invoke', 'queryMany'].includes(body.action) && !['student.overview', 'report.list', 'report.read'].includes(body.name))) throw Error('PROBE_READ_ONLY');
      const result = await gateway(req.headers.authorization?.replace('Bearer ', ''), body);
      if (liveOnly && body.action === 'describe') result.capabilities = ['student:read', 'report:read'];
      if (liveOnly && body.action === 'health' && result.ok) liveReceipts.push({ nonce: result.nonce, connectionId: result.connectionId });
      if (liveOnly && result.ok) liveReceipts.push({ connectionId: connectors.auth(req.headers.authorization?.replace('Bearer ', '')).connectionId, action: body.action, name: body.name, targetStudentId: body.targetStudentId, omittedInput: body.input === undefined, offset: body.input?.offset || 0, complete: body.name === 'report.read' && !result.result?.truncated });
      res.end(JSON.stringify(result));
    } catch (e) { res.end(JSON.stringify({ ok: false, code: e.code || 'FAILED' })); } });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    await connectors.action('savePolicy', { preset: 'full', accessMode: 'all_authorized_students', revision: 0, confirmed: true });
    for (const hostType of ['codex', 'workbuddy']) {
      const result = await ctx.externalConnectorAction('upgradeInstalled', { hostType, confirmed: true });
      assert.equal(result.status, 'bridge_verified', result.message);
    }
    const installed = ctx.unifiedKnowledgeRegistrations();
    assert.notEqual(installed.codex.connectionId, installed.workbuddy.connectionId);
    assert.equal(ctx.refreshExternalConnectionRuntimeConfigs().failed.length, 0);
    report.checks.push('packaged host upgrades same identity with independent credentials; portable paths refreshed');
    for (const hostType of ['codex', 'workbuddy']) {
      const configFile = path.join(ctx.externalConnectionDirectory(installed[hostType].connectionId), 'connection.json');
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', bridgePath, '-Descriptor', descriptorPath, '-ConnectorConfig', configFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stderr.resume(); const waiting = new Map(); let seq = 0;
      const lines = readline.createInterface({ input: child.stdout }); lines.on('line', line => { const value = JSON.parse(line); waiting.get(value.id)?.(value); waiting.delete(value.id); });
      const rpc = (method, params) => new Promise((resolve, reject) => { const id = ++seq, timer = setTimeout(() => reject(Error('MCP timeout')), 15000); waiting.set(id, value => { clearTimeout(timer); resolve(value); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
      const call = async (name, args) => { const response = await rpc('tools/call', { name, arguments: args }); assert.ok(response.result, JSON.stringify(response)); return JSON.parse(response.result.content[0].text); };
      assert.equal((await rpc('initialize')).result.serverInfo.name, 'edu-manager-knowledge');
      const tools = (await rpc('tools/list')).result.tools;
      assert.ok(tools.some(t => t.name === 'education_open_session')); assert.ok(tools.some(t => t.name === 'query_education_knowledge'));
      const session = await call('education_open_session', { sessionId: 'synthetic-conversation' });
      const base = { sessionId: session.sessionId, contextRevision: session.contextRevision };
      assert.equal((await call('list_authorized_students', base)).students.length, 2);
      const grouped = await call('education_query_students', { ...base, name: 'knowledge.query', studentIds: 'all', input: { question: 'synthetic' } });
      assert.deepEqual(grouped.results.map(r => r.studentId), ['s1', 's2']);
      assert.equal((await call('query_education_knowledge', { ...base, targetStudentId: 's2', input: { question: 'synthetic' } })).studentId, 's2');
      assert.equal((await call('education_student_overview', { ...base, targetStudentId: 's1' })).result.id, 's1');
      assert.equal((await call('education_query_students', { ...base, name: 'student.overview', studentIds: 'all' })).results.length, 2);
      assert.equal((await call('education_report_list', { ...base, targetStudentId: 's1' })).result.reports[0].id, 'profile');
      let offset = 0, contentHash, reconstructed = '';
      do {
        const page = await call('education_report_read', { ...base, targetStudentId: 's1', input: { reportId: 'profile', offset, limit: 101, ...(contentHash ? { contentHash } : {}) } });
        assert.equal(page.ok, true, JSON.stringify(page)); contentHash ||= page.result.contentHash;
        reconstructed += page.result.content; offset = page.result.nextOffset;
      } while (offset !== null);
      assert.equal(reconstructed, reportText);
      const before = writes;
      for (const targetStudentId of ['s1', 's2']) {
        const args = { ...base, targetStudentId, idempotencyKey: 'same-event', input: { filename: 'synthetic.txt', contentBase64: 'c3ludGhldGlj' } };
        const result = await call('education_material_upload', args); assert.equal(result.intent.receipt.studentId, targetStudentId);
        await call('education_material_upload', args);
      }
      assert.equal(writes - before, 2);
      assert.equal((await call('education_material_upload', { ...base, idempotencyKey: 'bad', input: {} })).code, 'TARGET_STUDENT_REQUIRED');
      report.checks.push(`${hostType}: actual PowerShell -> packaged Electron Node -> MCP -> HTTP, aliases, grouped query, isolated idempotent writes`);
      child.stdin.end(); await new Promise(r => child.on('close', r)); child = null;
    }
    // Actual vendor Agents, optional and explicit; isolated MCP configuration,
    // real account login kept vendor-owned, no student data or production edits.
    if (process.env.EDU_LIVE_MCP === '1') {
      liveOnly = true; report.realAgentChecks = [];
      const runAgent = (exe, args, env, timeoutMs = 180000) => new Promise(resolve => {
        let output = '', pendingLine = ''; const toolCalls = [];
        const observe = line => { try {
          const e = JSON.parse(line);
          if (e.type === 'assistant') for (const c of e.message?.content || []) if (c.type === 'tool_use') {
            toolCalls.push(c.name);
            if (c.name === 'DeferExecuteTool') toolCalls.push(c.input?.toolName || 'unknown_deferred_target');
          }
          if (e.type === 'item.completed' && e.item?.type === 'mcp_tool_call') toolCalls.push('mcp__' + e.item.server + '__' + e.item.tool);
          if (e.type === 'item.completed' && ['command_execution', 'file_change', 'web_search'].includes(e.item?.type)) toolCalls.push(e.item.type);
        } catch { /* Diagnostic output is not an Agent instruction. */ } };
        const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', b => { output = (output + b).slice(-50000); pendingLine += b; const lines = pendingLine.split(/\r?\n/); pendingLine = lines.pop(); lines.forEach(observe); }); child.stderr.on('data', b => { output = (output + b).slice(-50000); });
        const timer = setTimeout(() => { spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); resolve({ code: -1, timeout: true }); }, timeoutMs);
        child.on('error', () => { clearTimeout(timer); resolve({ code: -2 }); });
        child.on('exit', code => { clearTimeout(timer);
          const summarize = e => Array.isArray(e) ? e.flatMap(summarize) : e?.type === 'system' && e.subtype === 'init' ? [JSON.stringify({ healthToolDiscovered: e.tools?.includes('mcp__edu-manager-knowledge__education_connector_health'), mcp_servers: e.mcp_servers })] : e?.type === 'error' ? [e.message] : e?.type === 'turn.failed' ? [e.error?.message] : e?.type === 'result' ? [e.result || e.error || ''] : e?.type === 'assistant' ? (e.message?.content || []).filter(c => c.type === 'text').map(c => c.text) : e?.type === 'item.completed' && ['agent_message', 'mcp_tool_call'].includes(e.item?.type) ? [JSON.stringify(e.item)] : [];
          let messages;
          try { messages = summarize(JSON.parse(output)); } catch { messages = output.split(/\r?\n/).flatMap(line => { try { return summarize(JSON.parse(line)); } catch { return /^mcp:.*(?:fail|error)/i.test(line) ? [line] : []; } }); }
          if (pendingLine) observe(pendingLine);
          resolve({ code, toolCalls, authenticationRequired: /Authentication required|not logged in/i.test(output), nonceInOutput: output.includes('edu-probe-'), proofInOutput: messages.join('\n').includes(proofCode), diagnostic: messages.join('\n').slice(-1800).replace(/(?:eak_r21_|sk-)[A-Za-z0-9_-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]') }); });
      });
      for (const host of (process.env.EDU_LIVE_HOST ? [process.env.EDU_LIVE_HOST] : ['codex', 'workbuddy'])) {
        const nonce = 'edu-probe-' + require('node:crypto').randomUUID(), at = Date.now();
        const opt = ctx.externalHostInstallOptions(host, installed[host].connectionId);
        const mcpArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', opt.bridgePath, '-Descriptor', opt.descriptorPath, '-ConnectorConfig', opt.connectionConfig];
        const prompt = `这是用户授权的只读 MCP 查询验收。仅使用 edu-manager-knowledge MCP（可用 ToolSearch 发现延迟工具），不要使用本地文件、终端、网络搜索或其他工具。打开独立会话 ${nonce}，列出授权学生，查询合成学生甲的完整整体画像，并通过跨学生概览比较甲乙的基本信息。本次必须实际调用 education_query_students，name="student.overview"、studentIds="all"，带当前 sessionId/contextRevision 且省略 input；分别调用两次 education_student_overview 不算覆盖跨学生工具验收。无业务条件的概览与报告列表省略 input，跨学生概览不得添加 question。报告用报告列表和报告读取接口；第一段用 limit=101，后续根据返回的 nextOffset 和 contentHash 继续，直到完整。最后给出简要画像、报告末尾验收码和 edu:// 来源。不得以你自己的文件读取能力兜底。`;
        const allowed = ['education_open_session', 'list_authorized_students', 'education_student_overview', 'education_query_students', 'education_report_list', 'education_report_read'];
        let result;
        if (host === 'codex') {
          // Explicit user-requested read-only acceptance: approve only these
          // test tools in this ephemeral process, never the user's global config.
          const approvals = allowed.map(n => `${n} = { approval_mode = "approve" }`).join(', ');
          const config = `mcp_servers = { "edu-manager-knowledge" = { command = "powershell.exe", args = ${JSON.stringify(mcpArgs)}, startup_timeout_sec = 30, tool_timeout_sec = 30, enabled_tools = ${JSON.stringify(allowed)}, tools = { ${approvals} } } }`;
          const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
          result = await runAgent(process.argv[4], ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--json', '-s', 'read-only', '-m', 'gpt-5.6-sol', '-c', 'features.shell_tool=false', '-c', 'web_search="disabled"', '-c', config, prompt], env);
        } else {
          const auth = load('classification-auth.cjs').createClassificationAuth({ directory: path.join(process.env.APPDATA, 'edu-manager-launcher', 'classification-auth') });
          const state = await auth.read('workbuddy'), wr = load('workbuddy-runtime.cjs');
          const runtime = auth.apply(wr.discoverWorkBuddyRuntime(process.argv[5], { findExecutable: () => process.argv[6] }), state);
          const configFile = path.join(root, 'live-workbuddy-mcp.json');
          fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { 'edu-manager-knowledge': { command: 'powershell.exe', args: mcpArgs } } }));
          const invocation = wr.buildControlledWorkBuddyInvocation(runtime, { cwd: root, command: prompt });
          invocation.args[invocation.args.indexOf('--mcp-config') + 1] = configFile;
          invocation.args[invocation.args.indexOf('--max-turns') + 1] = '16';
          // DeferExecuteTool is allowed only after explicit user consent for
          // this isolated, read-only MCP acceptance process (2026-10-16).
          invocation.args[invocation.args.indexOf('--tools') + 1] = 'ToolSearch,DeferExecuteTool';
          invocation.args[invocation.args.indexOf('--output-format') + 1] = 'stream-json';
          invocation.args.push('--verbose');
          invocation.args.push('--allowedTools', ['ToolSearch', 'DeferExecuteTool', ...allowed.map(n => 'mcp__edu-manager-knowledge__' + n)].join(','));
          invocation.args.push('--disallowedTools', 'Read,Write,Edit,Bash,PowerShell,Glob,Grep,WebFetch,WebSearch,Agent');
          // WorkBuddy's deferred dispatcher also checks settings permissions.
          // Inline settings live only in this child; never persist user grants.
          const settingsIndex = invocation.args.indexOf('--settings') + 1;
          invocation.args[settingsIndex] = JSON.stringify({ ...JSON.parse(invocation.args[settingsIndex]), permissions: {
            allow: ['ToolSearch', 'DeferExecuteTool', ...allowed.map(n => 'mcp__edu-manager-knowledge__' + n)],
            deny: ['Read', 'Write', 'Edit', 'Bash', 'PowerShell', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent'],
          } });
          result = await runAgent(invocation.executable, [...invocation.args, '--', prompt], invocation.env);
        }
        const receipts = liveReceipts.filter(r => r.connectionId === installed[host].connectionId);
        const allowedCalls = new Set(['ToolSearch', 'DeferExecuteTool', ...allowed.map(n => 'mcp__edu-manager-knowledge__' + n)]);
        const noFileFallback = result.toolCalls?.length > 0 && result.toolCalls.every(n => allowedCalls.has(n));
        const passed = result.code === 0 && noFileFallback && result.proofInOutput && receipts.some(r => r.action === 'students') && receipts.some(r => r.action === 'queryMany' && r.omittedInput) && receipts.some(r => r.name === 'report.list' && r.omittedInput) && receipts.some(r => r.name === 'report.read' && r.offset > 0 && r.complete);
        if (passed) delete result.diagnostic;
        report.realAgentChecks.push({ host, passed, durationMs: Date.now() - at, ...result, noFileFallback, authenticatedMcpRoundTrip: passed, queryReceipts: receipts });
        console.log(JSON.stringify(report.realAgentChecks.at(-1)));
      }
      liveOnly = false;
    }
    // Packaged uninstall/reinstall and revocation, without touching user configs.
    for (const hostType of ['codex', 'workbuddy']) {
      const id = installed[hostType].connectionId;
      const token = fs.readFileSync(path.join(ctx.externalConnectionDirectory(id), 'credential'), 'utf8');
      if (hostType === 'codex') {
        const file = path.join(root, '.codex/config.toml');
        fs.writeFileSync(file, '[mcp_servers.edu-manager-knowledge]\ncommand="unrecognized"\n');
        await assert.rejects(ctx.externalConnectorAction('uninstallInstalled', { hostType, confirmed: true }));
        fs.writeFileSync(file, '# keep\n# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:END\n');
        assert.equal(ctx.externalHostStatuses().codex.status, 'uninstalled');
        report.checks.push('codex: pending uninstall refresh detects manually removed MCP with orphan marker, without reauthorization');
      }
      await ctx.externalConnectorAction('uninstallInstalled', { hostType, confirmed: true });
      assert.throws(() => connectors.auth(token));
      const receiptsBefore = JSON.stringify(saved);
      await ctx.externalConnectorAction('deleteConnection', { connectionId: id, confirmed: true });
      assert.equal(connectors.auth(token), null);
      assert.ok(!connectors.snapshot().sessions.some(s => s.connectionId === id));
      assert.equal(JSON.stringify(saved), receiptsBefore);
      assert.ok(ctx.unifiedKnowledgeRegistrations()[hostType], 'legacy registration tombstone retained');
      const result = await ctx.externalConnectorAction('installHost', { hostType, confirmed: true });
      assert.equal(result.status, 'bridge_verified', result.message);
      assert.notEqual(ctx.unifiedKnowledgeRegistrations()[hostType].connectionId, id);
      report.checks.push(`${hostType}: packaged uninstall/delete preserves write receipts and old-token invalidity; fresh reinstall and health pass`);
    }
    report.passed = !report.realAgentChecks || report.realAgentChecks.every(c => c.passed);
  } catch (e) { report.error = e.message; }
  finally { child?.kill(); server?.close(); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); app.exit(report.passed ? 0 : 1); }
}).catch(error => { console.error(error.message); app.exit(1); });
