const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { KnowledgeEngineContractError, assertPortableId } = require('./knowledge-engine-contract.cjs');

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseJsonOutput(stdout, operation) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch (error) {
    throw new KnowledgeEngineContractError('GBRAIN_INVALID_JSON', `GBrain ${operation} 未返回有效 JSON。`, { operation, output: text.slice(0, 2000), cause: error.message });
  }
}

function createGbrainCliEvaluationTransport(options = {}) {
  const workspaceRoot = path.resolve(String(options.workspaceRoot || process.cwd()));
  const gbrainHome = path.resolve(String(options.gbrainHome || path.join(workspaceRoot, '.gbrain-evaluation', 'runtime')));
  const evaluationRoot = path.resolve(String(options.evaluationRoot || path.join(workspaceRoot, '.gbrain-evaluation')));
  const gbrainPath = path.resolve(String(options.gbrainPath || process.env.GBRAIN_BIN || 'C:\\Users\\bxw00\\.bun\\bin\\gbrain.exe'));
  if (!inside(evaluationRoot, gbrainHome)) {
    throw new KnowledgeEngineContractError('UNSAFE_GBRAIN_HOME', 'P0 GBrain home 必须位于 .gbrain-evaluation 隔离目录内。', { gbrainHome, evaluationRoot });
  }
  if (!fs.existsSync(gbrainPath)) {
    throw new KnowledgeEngineContractError('GBRAIN_NOT_INSTALLED', '未找到 GBrain CLI。', { gbrainPath });
  }
  fs.mkdirSync(evaluationRoot, { recursive: true });
  fs.mkdirSync(gbrainHome, { recursive: true });

  const environment = { ...process.env, GBRAIN_HOME: gbrainHome, GBRAIN_NO_ONBOARD_NUDGE: '1' };
  for (const key of ['OPENAI_API_KEY', 'ZEROENTROPY_API_KEY', 'VOYAGE_API_KEY', 'ANTHROPIC_API_KEY']) delete environment[key];

  function run(args, runOptions = {}) {
    const startedAt = Date.now();
    const result = spawnSync(gbrainPath, args.map(String), {
      cwd: workspaceRoot,
      env: environment,
      encoding: 'utf8',
      timeout: Number(runOptions.timeoutMs || 60000),
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    const receipt = {
      ok: result.status === 0,
      status: result.status,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
      durationMs: Date.now() - startedAt,
      command: ['gbrain', ...args.map(String)],
    };
    if (result.error) receipt.error = result.error.message;
    if (!receipt.ok && runOptions.allowFailure !== true) {
      throw new KnowledgeEngineContractError('GBRAIN_COMMAND_FAILED', `GBrain 命令失败：${args[0] || ''}。`, receipt);
    }
    return receipt;
  }

  function call(operation, payload = {}, callOptions = {}) {
    const receipt = run(['call', operation, JSON.stringify(payload)], callOptions);
    if (!receipt.ok) return { receipt, value: null };
    return { receipt, value: parseJsonOutput(receipt.stdout, operation) };
  }

  function assertScopedSlug(slug, namespace) {
    const safeNamespace = assertPortableId(namespace, 'namespace');
    const text = String(slug || '');
    if (!text.startsWith(`${safeNamespace}/`) || text.includes('..') || path.isAbsolute(text)) {
      throw new KnowledgeEngineContractError('GBRAIN_SCOPE_VIOLATION', 'GBrain 页面超出隔离 namespace。', { slug: text, namespace: safeNamespace });
    }
    return text;
  }

  function getPage(slug) {
    const { receipt, value } = call('get_page', { slug }, { allowFailure: true });
    if (receipt.ok) return value;
    if (/not found|no page|missing/i.test(`${receipt.stderr}\n${receipt.stdout}`)) return null;
    throw new KnowledgeEngineContractError('GBRAIN_READ_FAILED', `无法读取 GBrain 页面：${slug}。`, receipt);
  }

  function capture(payload) {
    const slug = assertScopedSlug(payload.slug, payload.namespace);
    if (payload.synthetic !== true || !/synthetic:\s*true/i.test(String(payload.content || ''))) {
      throw new KnowledgeEngineContractError('REAL_DATA_BLOCKED', 'GBrain CLI transport 只接受标记为 synthetic 的内容。', { slug });
    }
    const stagingRoot = path.join(evaluationRoot, 'staging');
    fs.mkdirSync(stagingRoot, { recursive: true });
    const name = `${crypto.createHash('sha256').update(slug).digest('hex').slice(0, 24)}-${process.pid}.md`;
    const filePath = path.join(stagingRoot, name);
    fs.writeFileSync(filePath, String(payload.content || ''), 'utf8');
    try {
      const relativePath = path.relative(workspaceRoot, filePath);
      const receipt = run(['capture', '--file', relativePath, '--slug', slug]);
      return { ok: true, slug, receipt };
    } finally {
      try { fs.unlinkSync(filePath); } catch { /* best-effort staging cleanup */ }
    }
  }

  function appendEvent(payload) {
    const page = capture(payload);
    const event = payload.event || {};
    const date = String(event.occurredAt || '').slice(0, 10);
    const timeline = call('add_timeline_entry', {
      slug: payload.slug,
      date,
      summary: String(event.summary || event.type || event.id || ''),
      detail: String(event.detail || ''),
      source: String(event.actorId || event.source || 'edu-manager-evaluation'),
    });
    return { ok: true, page, timeline: timeline.value, timelineReceipt: timeline.receipt };
  }

  function upsertRelationship(payload) {
    const page = capture(payload);
    const link = call('add_link', {
      from: assertScopedSlug(payload.fromSlug, payload.namespace),
      to: assertScopedSlug(payload.toSlug, payload.namespace),
      link_type: String(payload.relationship?.type || 'related_to'),
      context: String(payload.relationship?.context || payload.relationship?.id || ''),
      link_source: 'edu-manager-eval',
    });
    return { ok: true, page, link: link.value, linkReceipt: link.receipt };
  }

  function exportSnapshot(payload) {
    const namespace = assertPortableId(payload.namespace, 'namespace');
    const exportId = assertPortableId(payload.exportId, 'export.id');
    const exportRoot = path.join(evaluationRoot, 'exports');
    const exportDir = path.join(exportRoot, exportId);
    if (!inside(exportRoot, exportDir)) throw new KnowledgeEngineContractError('UNSAFE_EXPORT_PATH', 'GBrain 导出路径超出隔离目录。', { exportDir });
    if (fs.existsSync(exportDir)) throw new KnowledgeEngineContractError('EXPORT_ALREADY_EXISTS', 'GBrain 评估导出 ID 已存在，请使用新的 exportId。', { exportId });
    fs.mkdirSync(exportDir, { recursive: true });
    const receipt = run(['export', '--dir', exportDir, '--slug-prefix', `${namespace}/`], { timeoutMs: 120000 });
    const listed = call('list_pages', { limit: 100000, sort: 'slug' }).value;
    const pages = (Array.isArray(listed) ? listed : []).filter((item) => String(item.slug || '').startsWith(`${namespace}/`)).map((item) => getPage(item.slug));
    const snapshot = {
      schema: 'edu-manager.gbrain-evaluation-export.v1',
      namespace,
      exportedAt: new Date().toISOString(),
      gbrainVersion: version(),
      pageCount: pages.length,
      pages,
    };
    const jsonPath = path.join(exportDir, 'snapshot.json');
    fs.writeFileSync(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return { ok: true, exportId, exportDir, jsonPath, markdownFiles: pages.length, snapshot, receipt };
  }

  function version() {
    const receipt = run(['--version']);
    return receipt.stdout.trim();
  }

  function initialize() {
    const configPath = path.join(gbrainHome, '.gbrain', 'config.json');
    const created = !fs.existsSync(configPath);
    const receipts = [];
    if (created) receipts.push(run(['init', '--pglite', '--no-embedding'], { timeoutMs: 120000 }));
    receipts.push(run(['config', 'set', 'search.mode', 'conservative']));
    const modes = run(['search', 'modes']);
    if (!/Search mode \(active\): conservative/.test(modes.stdout)) {
      throw new KnowledgeEngineContractError('GBRAIN_SEARCH_MODE_MISMATCH', '隔离 GBrain 未启用 conservative 检索模式。', { output: modes.stdout });
    }
    return { ok: true, created, configPath, mode: 'conservative', receipts: receipts.map((item) => ({ status: item.status, durationMs: item.durationMs })) };
  }

  return {
    gbrainHome,
    evaluationRoot,
    gbrainPath,
    initialize,
    version,
    execute(operation, payload = {}) {
      switch (operation) {
        case 'doctor': {
          const receipt = run(['doctor', '--json'], { timeoutMs: 120000 });
          return { ...parseJsonOutput(receipt.stdout, 'doctor'), receipt: { durationMs: receipt.durationMs, status: receipt.status } };
        }
        case 'capture': return capture(payload);
        case 'get_page': return getPage(assertScopedSlug(payload.slug, payload.namespace));
        case 'search': {
          // GBrain 0.42.63.0 can serve a cached result set created before new
          // namespace pages were written. P0 clears only this isolated brain's
          // cache before evaluating visibility/isolation semantics.
          run(['cache', 'clear', '--yes']);
          const result = call('search', { query: String(payload.query || ''), limit: Number(payload.limit || 20), mode: 'conservative' }).value;
          const prefix = String(payload.filters?.pathPrefix || `${payload.namespace}/`);
          return (Array.isArray(result) ? result : []).filter((item) => String(item.slug || '').startsWith(prefix));
        }
        case 'append_event': return appendEvent(payload);
        case 'upsert_relationship': return upsertRelationship(payload);
        case 'get_links': return call('get_links', { slug: assertScopedSlug(payload.slug, payload.namespace) }).value;
        case 'traverse_graph': return call('traverse_graph', { slug: assertScopedSlug(payload.slug, payload.namespace), depth: Number(payload.depth || 2), direction: payload.direction || 'both' }).value;
        case 'get_timeline': return call('get_timeline', { slug: assertScopedSlug(payload.slug, payload.namespace), limit: Number(payload.limit || 100) }).value;
        case 'list_pages': {
          const listed = call('list_pages', { limit: Number(payload.limit || 100000), sort: 'slug' }).value;
          const prefix = String(payload.pathPrefix || `${payload.namespace}/`);
          return (Array.isArray(listed) ? listed : []).filter((item) => String(item.slug || '').startsWith(prefix));
        }
        case 'export': return exportSnapshot(payload);
        default: throw new KnowledgeEngineContractError('UNSUPPORTED_GBRAIN_OPERATION', `GBrain CLI transport 不支持操作：${operation}。`, { operation });
      }
    },
  };
}

module.exports = { createGbrainCliEvaluationTransport, inside };
