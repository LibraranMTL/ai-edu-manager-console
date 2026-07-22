const {
  KNOWLEDGE_ENGINE_CONTRACT_VERSION,
  KnowledgeEngineContractError,
  assertKnowledgeEngine,
  assertPortableId,
  contentHash,
  normalizeClaim,
} = require('./knowledge-engine-contract.cjs');

const PAGE_KINDS = Object.freeze(['claims', 'sources', 'events', 'relationships', 'subjects', 'projects']);

function yamlValue(value) {
  return JSON.stringify(String(value ?? ''));
}

function contractJsonBlock(value) {
  return `\n\n## Contract JSON\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

function parseContractJson(page) {
  if (!page || typeof page !== 'object') return null;
  const match = String(page.compiled_truth || '').match(/## Contract JSON\s*\n\s*```json\s*\n([\s\S]*?)\n```/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function createGbrainEvaluationAdapter(options = {}) {
  const transport = options.transport;
  if (!transport || typeof transport.execute !== 'function') {
    throw new KnowledgeEngineContractError('INVALID_TRANSPORT', 'GBrain 评估适配器需要带 execute(operation, payload) 的隔离 transport。');
  }
  const namespace = assertPortableId(options.namespace || 'edu-manager-synthetic-eval', 'namespace');
  if (!namespace.includes('synthetic') && options.allowNonSyntheticNamespace !== true) {
    throw new KnowledgeEngineContractError('UNSAFE_NAMESPACE', 'P0 GBrain namespace 必须明确包含 synthetic。', { namespace });
  }
  const syntheticOnly = true;

  function assertSynthetic(input, operation) {
    if (syntheticOnly && input?.synthetic !== true) {
      throw new KnowledgeEngineContractError(
        'REAL_DATA_BLOCKED',
        `P0 GBrain 隔离评估禁止在 ${operation} 中写入非虚构数据。`,
        { operation, namespace },
      );
    }
  }

  function pageSlug(kind, id) {
    if (!PAGE_KINDS.includes(kind)) throw new KnowledgeEngineContractError('INVALID_PAGE_KIND', `不支持的 GBrain 页面类型：${kind}。`);
    return `${namespace}/${kind}/${assertPortableId(id, `${kind}.id`)}`;
  }

  function execute(operation, payload = {}) {
    return transport.execute(operation, { namespace, ...payload });
  }

  function readPage(slug) {
    return execute('get_page', { slug });
  }

  function resolveEntitySlug(id, explicitSlug = '') {
    if (explicitSlug) {
      if (!explicitSlug.startsWith(`${namespace}/`)) {
        throw new KnowledgeEngineContractError('CROSS_NAMESPACE_REFERENCE', '关系端点必须位于当前隔离 namespace。', { explicitSlug, namespace });
      }
      return explicitSlug;
    }
    const stableId = assertPortableId(id, 'relationship.endpointId');
    for (const kind of PAGE_KINDS) {
      const candidate = pageSlug(kind, stableId);
      if (readPage(candidate)) return candidate;
    }
    throw new KnowledgeEngineContractError('RELATIONSHIP_ENDPOINT_NOT_FOUND', `未找到关系端点：${stableId}。`, { stableId });
  }

  const engine = {
    contractVersion: KNOWLEDGE_ENGINE_CONTRACT_VERSION,
    engineId: 'gbrain-evaluation',
    engineVersion: String(options.engineVersion || 'unverified'),
    namespace,
    capabilities: Object.freeze({
      humanReadable: true,
      immutableSources: true,
      claims: true,
      events: true,
      relationships: true,
      hybridSearch: true,
      synthesis: true,
      evaluationOnly: true,
      syntheticOnly,
    }),

    health() {
      return execute('doctor', { json: true, expectedContract: KNOWLEDGE_ENGINE_CONTRACT_VERSION });
    },

    importAsset(input = {}) {
      assertSynthetic(input, 'importAsset');
      const asset = {
        ...input,
        id: assertPortableId(input.id, 'asset.id'),
        uri: String(input.uri || '').trim(),
        title: String(input.title || input.id || ''),
        mediaType: String(input.mediaType || 'text/markdown'),
        content: String(input.content || ''),
        synthetic: true,
      };
      if (!asset.uri) throw new KnowledgeEngineContractError('MISSING_SOURCE_URI', 'asset.uri 不能为空。');
      const sha256 = contentHash({ uri: asset.uri, content: asset.content });
      const slug = pageSlug('sources', asset.id);
      const existing = readPage(slug);
      if (existing) {
        if (String(existing.frontmatter?.source_sha256 || '') !== sha256) {
          throw new KnowledgeEngineContractError('IMMUTABLE_SOURCE_CONFLICT', '同一来源 ID 已存在不同内容；GBrain 原始资料不可覆盖。', { id: asset.id, slug });
        }
        return { ok: true, duplicate: true, source: asset, sha256, slug, page: existing };
      }
      const content = `---\ntype: source\nschema: edu-manager.source.v1\nsource_id: ${yamlValue(asset.id)}\nsource_uri: ${yamlValue(asset.uri)}\nsource_sha256: ${yamlValue(sha256)}\nmedia_type: ${yamlValue(asset.mediaType)}\nsynthetic: true\n---\n# ${asset.title}\n\n${asset.content}\n`;
      const result = execute('capture', { slug, content, synthetic: true, sourceId: asset.id, sourceUri: asset.uri });
      return { ok: true, duplicate: false, source: asset, sha256, slug, result };
    },

    upsertClaim(input = {}) {
      assertSynthetic(input, 'upsertClaim');
      const claim = normalizeClaim(input);
      claim.synthetic = true;
      const slug = pageSlug('claims', claim.id);
      const previousPage = readPage(slug);
      const previousClaim = parseContractJson(previousPage);
      let historySlug = '';
      if (previousClaim) {
        const revision = contentHash(previousClaim);
        historySlug = `${namespace}/claim-history/${claim.id}/${revision}`;
        const historyContent = `---\ntype: note\nschema: edu-manager.claim-history.v1\nclaim_id: ${yamlValue(claim.id)}\nrevision: ${yamlValue(revision)}\nsynthetic: true\n---\n# Claim revision ${claim.id}\n${contractJsonBlock(previousClaim)}`;
        execute('capture', { slug: historySlug, content: historyContent, synthetic: true, sourceId: claim.id });
        claim.createdAt = previousClaim.createdAt || claim.createdAt;
      }
      const citations = claim.evidence.map((item) => `- [${item.id}] ${item.sourceUri}${item.excerpt ? ` — ${item.excerpt}` : ''}`).join('\n') || '- none';
      const value = typeof claim.value === 'string' ? claim.value : JSON.stringify(claim.value, null, 2);
      const content = `---\ntype: claim\nschema: ${claim.schema}\nclaim_id: ${yamlValue(claim.id)}\nsubject_id: ${yamlValue(claim.subjectId)}\npredicate: ${yamlValue(claim.predicate)}\nstatus: ${yamlValue(claim.status)}\nupdated_at: ${yamlValue(claim.updatedAt)}\nsynthetic: true\n---\n# ${claim.predicate}\n\n${value}\n\n## Evidence\n\n${citations}${contractJsonBlock(claim)}`;
      const result = execute('capture', { slug, content, synthetic: true, sourceId: claim.id });
      return { ok: true, claim, slug, historySlug, result };
    },

    getClaim(id) {
      const claimId = assertPortableId(id, 'claim.id');
      return parseContractJson(readPage(pageSlug('claims', claimId)));
    },

    search(query, searchOptions = {}) {
      const statuses = new Set(Array.isArray(searchOptions.statuses) ? searchOptions.statuses.map(String) : ['confirmed']);
      const subjectId = String(searchOptions.subjectId || '');
      const limit = Math.max(1, Math.min(100, Number(searchOptions.limit || 20)));
      const raw = execute('search', {
        query: String(query || ''),
        limit: Math.max(limit * 4, 20),
        mode: 'conservative',
        filters: { pathPrefix: `${namespace}/claims/` },
      });
      const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];
      const results = [];
      const seen = new Set();
      for (const row of rows) {
        const slug = String(row.slug || '');
        if (!slug.startsWith(`${namespace}/claims/`) || seen.has(slug)) continue;
        seen.add(slug);
        const claim = parseContractJson(readPage(slug));
        if (!claim || !statuses.has(String(claim.status))) continue;
        if (subjectId && String(claim.subjectId) !== subjectId) continue;
        results.push({
          score: Number(row.score || 0),
          claim,
          citations: Array.isArray(claim.evidence) ? claim.evidence.map((item) => ({ evidenceId: item.id, sourceUri: item.sourceUri })) : [],
          engine: { slug, chunkId: row.chunk_id || null, effectiveDate: row.effective_date || '' },
        });
        if (results.length >= limit) break;
      }
      return { query: String(query || ''), engineId: this.engineId, results };
    },

    appendEvent(input = {}) {
      assertSynthetic(input, 'appendEvent');
      const event = {
        schema: 'edu-manager.knowledge-event.v1',
        ...input,
        id: assertPortableId(input.id, 'event.id'),
        subjectId: input.subjectId ? assertPortableId(input.subjectId, 'event.subjectId') : '',
        type: String(input.type || '').trim(),
        occurredAt: String(input.occurredAt || new Date().toISOString()),
        synthetic: true,
      };
      if (!event.type) throw new KnowledgeEngineContractError('MISSING_EVENT_TYPE', 'event.type 不能为空。');
      const slug = pageSlug('events', event.id);
      const content = `---\ntype: event\nschema: ${event.schema}\nevent_id: ${yamlValue(event.id)}\nsubject_id: ${yamlValue(event.subjectId)}\nevent_type: ${yamlValue(event.type)}\nstatus: ${yamlValue(event.status || 'recorded')}\noccurred_at: ${yamlValue(event.occurredAt)}\nsynthetic: true\n---\n# ${event.type}\n\n${String(event.summary || event.detail || event.type)}${contractJsonBlock(event)}`;
      const result = execute('append_event', { slug, content, event, synthetic: true });
      return { ok: true, event, slug, result };
    },

    upsertRelationship(input = {}) {
      assertSynthetic(input, 'upsertRelationship');
      const relationship = {
        schema: 'edu-manager.relationship.v1',
        ...input,
        id: assertPortableId(input.id, 'relationship.id'),
        fromId: assertPortableId(input.fromId, 'relationship.fromId'),
        toId: assertPortableId(input.toId, 'relationship.toId'),
        type: String(input.type || '').trim(),
        synthetic: true,
      };
      if (!relationship.type) throw new KnowledgeEngineContractError('MISSING_RELATIONSHIP_TYPE', 'relationship.type 不能为空。');
      const fromSlug = resolveEntitySlug(relationship.fromId, input.fromSlug || '');
      const toSlug = resolveEntitySlug(relationship.toId, input.toSlug || '');
      const slug = pageSlug('relationships', relationship.id);
      const content = `---\ntype: note\nschema: ${relationship.schema}\nrelationship_id: ${yamlValue(relationship.id)}\nfrom_id: ${yamlValue(relationship.fromId)}\nto_id: ${yamlValue(relationship.toId)}\nlink_type: ${yamlValue(relationship.type)}\nsynthetic: true\n---\n# ${relationship.type}\n\n${fromSlug} -> ${toSlug}${contractJsonBlock(relationship)}`;
      const result = execute('upsert_relationship', { slug, content, relationship, fromSlug, toSlug, synthetic: true });
      return { ok: true, relationship, slug, fromSlug, toSlug, result };
    },

    exportSnapshot(exportOptions = {}) {
      const exportId = assertPortableId(exportOptions.exportId || `eval-${Date.now()}`, 'export.id');
      return execute('export', { exportId, pathPrefix: `${namespace}/`, format: 'json+markdown' });
    },
  };

  return assertKnowledgeEngine(engine);
}

module.exports = { createGbrainEvaluationAdapter, parseContractJson };
