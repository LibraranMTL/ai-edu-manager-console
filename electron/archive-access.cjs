const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ARCHIVE_ACCESS_SCHEMA = 'edu-manager.archive-access.v1';
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv']);

function inside(candidate, root) {
  const target = path.resolve(String(candidate || ''));
  const base = path.resolve(String(root || ''));
  const relative = path.relative(base, target);
  return Boolean(base) && (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)));
}

function encodedUri(scopeType, scopeId, relativePath) {
  return `edu://${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/knowledge/${String(relativePath || '').split('/').map(encodeURIComponent).join('/')}`;
}

function searchTerms(query) {
  const terms = String(query || '')
    .toLocaleLowerCase()
    .split(/[\s，。！？；、,:;!?()[\]{}<>《》“”"'`]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return Array.from(new Set(terms)).slice(0, 12);
}

function descriptorResources(descriptor, limit) {
  const root = path.resolve(String(descriptor.root || ''));
  if (!root || !fs.existsSync(root)) return [];
  const excludedRoots = (descriptor.excludedRoots || []).filter(Boolean).map((item) => path.resolve(String(item)));
  const resources = [];
  const pending = [root];
  while (pending.length && resources.length < limit) {
    const current = pending.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (resources.length >= limit) break;
      const target = path.join(current, entry.name);
      if (excludedRoots.some((excluded) => inside(target, excluded))) continue;
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.trash' || entry.name === '.edu-manager') continue;
      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }
      if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        const stat = fs.statSync(target);
        const relativePath = path.relative(root, target).replace(/\\/g, '/');
        resources.push({
          uri: encodedUri(descriptor.scopeType, descriptor.scopeId, relativePath),
          scopeType: descriptor.scopeType,
          scopeId: descriptor.scopeId,
          scopeName: descriptor.scopeName || '',
          relativePath,
          path: target,
          title: path.basename(target),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        // Ignore files replaced while building the read-only index.
      }
    }
  }
  return resources;
}

function createArchiveAccess(options = {}) {
  const descriptors = Array.isArray(options.descriptors) ? options.descriptors : [];
  const maxResources = Math.max(1, Math.min(5000, Number(options.maxResources || 1500)));
  let index = null;
  const scopedIndexes = new Map();
  const scopeKey = (scopeType, scopeId) => `${String(scopeType || '')}:${String(scopeId || '')}`;
  const ensureIndex = () => {
    if (index) return index;
    const byPath = new Map();
    const perScopeLimit = Math.max(1, Math.ceil(maxResources / Math.max(1, descriptors.length)));
    for (const descriptor of descriptors) {
      for (const resource of descriptorResources(descriptor, Math.min(perScopeLimit, maxResources - byPath.size))) {
        if (!byPath.has(resource.path.toLowerCase())) byPath.set(resource.path.toLowerCase(), resource);
      }
      if (byPath.size >= maxResources) break;
    }
    index = Array.from(byPath.values()).sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
    return index;
  };
  const ensureScopedIndex = (scopeType, scopeId) => {
    const normalizedType = String(scopeType || '');
    const normalizedId = String(scopeId || '');
    const key = scopeKey(normalizedType, normalizedId);
    if (scopedIndexes.has(key)) return scopedIndexes.get(key);
    const byPath = new Map();
    for (const descriptor of descriptors) {
      if (descriptor.scopeType !== normalizedType || String(descriptor.scopeId) !== normalizedId) continue;
      for (const resource of descriptorResources(descriptor, maxResources - byPath.size)) {
        if (!byPath.has(resource.path.toLowerCase())) byPath.set(resource.path.toLowerCase(), resource);
      }
      if (byPath.size >= maxResources) break;
    }
    const scopedIndex = Array.from(byPath.values())
      .sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
    scopedIndexes.set(key, scopedIndex);
    while (scopedIndexes.size > 16) scopedIndexes.delete(scopedIndexes.keys().next().value);
    return scopedIndex;
  };
  const scoped = (params = {}) => {
    const hasExactScope = Boolean(params.scopeType && params.scopeId);
    const source = hasExactScope
      ? ensureScopedIndex(params.scopeType, params.scopeId)
      : ensureIndex();
    return source.filter((item) =>
      (!params.scopeType || item.scopeType === String(params.scopeType))
      && (!params.scopeId || item.scopeId === String(params.scopeId)));
  };
  const scopeFromUri = (uri) => {
    const match = String(uri || '').match(/^edu:\/\/([^/]+)\/([^/]+)\/knowledge\//);
    if (!match) return null;
    try {
      return { scopeType: decodeURIComponent(match[1]), scopeId: decodeURIComponent(match[2]) };
    } catch {
      return null;
    }
  };
  const readResource = (resource, maxChars = 20_000) => {
    if (!resource || !descriptors.some((descriptor) =>
      descriptor.scopeType === resource.scopeType
      && String(descriptor.scopeId) === String(resource.scopeId)
      && inside(resource.path, descriptor.root)
      && !(descriptor.excludedRoots || []).some((excluded) => inside(resource.path, excluded)))) return null;
    const raw = fs.readFileSync(resource.path, 'utf8');
    return {
      ...resource,
      content: raw.slice(0, maxChars),
      truncated: raw.length > maxChars,
      sha1: crypto.createHash('sha1').update(raw, 'utf8').digest('hex'),
    };
  };
  return {
    schema: ARCHIVE_ACCESS_SCHEMA,
    refresh() {
      index = null;
      scopedIndexes.clear();
      return { ok: true, resourceCount: ensureIndex().length };
    },
    primeScopes(scopes = []) {
      const requested = Array.from(new Map((Array.isArray(scopes) ? scopes : [])
        .filter((scope) => scope?.scopeType && scope?.scopeId)
        .map((scope) => [`${scope.scopeType}:${scope.scopeId}`, scope])).values());
      let resourceCount = 0;
      for (const scope of requested) resourceCount += ensureScopedIndex(scope.scopeType, scope.scopeId).length;
      return { ok: true, scopeCount: requested.length, resourceCount };
    },
    search(params = {}) {
      const query = String(params.query || '').trim().toLowerCase();
      const terms = searchTerms(query);
      const limit = Math.max(1, Math.min(50, Number(params.limit || 12)));
      const hits = [];
      for (const resource of scoped(params)) {
        let content = '';
        if (query && resource.size <= 1024 * 1024) {
          try { content = fs.readFileSync(resource.path, 'utf8'); } catch { content = ''; }
        }
        const haystack = `${resource.title}\n${resource.relativePath}\n${content}`.toLowerCase();
        const exact = Boolean(query && haystack.includes(query));
        const matchedTerms = exact ? terms : terms.filter((term) => haystack.includes(term));
        const requiredMatches = terms.length <= 1 ? 1 : Math.max(1, Math.ceil(terms.length * 0.6));
        if (query && !exact && matchedTerms.length < requiredMatches) continue;
        const firstMatch = exact ? query : matchedTerms[0] || '';
        const position = firstMatch ? haystack.indexOf(firstMatch) : 0;
        const excerptStart = Math.max(0, position - 120);
        hits.push({
          ...resource,
          excerpt: content ? content.slice(excerptStart, excerptStart + 500) : '',
          relevance: exact ? 10_000 + terms.length : matchedTerms.length,
        });
      }
      hits.sort((a, b) => b.relevance - a.relevance || String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
      const resources = hits.slice(0, limit).map(({ relevance, ...item }) => ({
        ...item,
        matchScore: relevance,
      }));
      return { ok: true, schema: ARCHIVE_ACCESS_SCHEMA, query, resources, count: resources.length };
    },
    getResource(params = {}) {
      const uri = String(params.uri || '');
      const uriScope = scopeFromUri(uri);
      const source = uriScope
        ? ensureScopedIndex(uriScope.scopeType, uriScope.scopeId)
        : ensureIndex();
      const resource = source.find((item) => item.uri === uri);
      if (!resource) return { ok: false, code: 'resource_not_found', message: '未找到该档案资源，或资源不在授权知识范围内。' };
      return { ok: true, schema: ARCHIVE_ACCESS_SCHEMA, resource: readResource(resource, Math.max(1, Math.min(100_000, Number(params.maxChars || 20_000)))) };
    },
    listChanges(params = {}) {
      const sinceMs = Date.parse(String(params.since || '')) || 0;
      const limit = Math.max(1, Math.min(100, Number(params.limit || 30)));
      const changes = scoped(params).filter((item) => !sinceMs || Date.parse(item.modifiedAt) >= sinceMs).slice(0, limit);
      return { ok: true, schema: ARCHIVE_ACCESS_SCHEMA, since: String(params.since || ''), changes, count: changes.length };
    },
    buildContextBundle(params = {}) {
      const searchResult = this.search({ ...params, limit: Math.max(1, Math.min(20, Number(params.limit || 8))) });
      const resources = searchResult.resources.map((item) => ({
        uri: item.uri,
        title: item.title,
        scopeType: item.scopeType,
        scopeId: item.scopeId,
        scopeName: item.scopeName || '',
        relativePath: item.relativePath,
        modifiedAt: item.modifiedAt,
        excerpt: item.excerpt,
      }));
      return {
        ok: true,
        schema: ARCHIVE_ACCESS_SCHEMA,
        generatedAt: new Date().toISOString(),
        scope: { type: String(params.scopeType || ''), id: String(params.scopeId || '') },
        query: String(params.query || ''),
        resources,
        citationRule: '回答或生成内容时引用 resource.uri；未在资源中找到依据的内容标记为待观察。',
      };
    },
  };
}

function handleArchiveAccessRpc(access, request = {}) {
  const id = request.id ?? null;
  if (request.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          { name: 'archive.search', description: '搜索已授权的学生或项目知识档案。' },
          { name: 'archive.get_resource', description: '按 edu:// URI 读取一个可追溯档案资源。' },
          { name: 'archive.list_changes', description: '列出指定时间后的知识档案变化。' },
          { name: 'archive.context_bundle', description: '为 Agent 任务生成带引用的最小上下文包。' },
        ],
      },
    };
  }
  if (request.method !== 'tools/call') return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  const name = String(request.params?.name || '');
  const args = request.params?.arguments || {};
  const methods = {
    'archive.search': () => access.search(args),
    'archive.get_resource': () => access.getResource(args),
    'archive.list_changes': () => access.listChanges(args),
    'archive.context_bundle': () => access.buildContextBundle(args),
  };
  if (!methods[name]) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown archive tool' } };
  return { jsonrpc: '2.0', id, result: methods[name]() };
}

module.exports = {
  ARCHIVE_ACCESS_SCHEMA,
  createArchiveAccess,
  handleArchiveAccessRpc,
  inside,
};
