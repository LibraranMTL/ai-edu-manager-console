const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  KNOWLEDGE_ENGINE_CONTRACT_VERSION,
  KnowledgeEngineContractError,
  assertKnowledgeEngine,
  assertPortableId,
  contentHash,
  normalizeClaim,
} = require('./knowledge-engine-contract.cjs');

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function markdownValue(value) {
  return typeof value === 'string' ? value : `\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function claimMarkdown(claim) {
  const evidence = claim.evidence.length
    ? claim.evidence.map((item) => `- [${item.id}] ${item.sourceUri}${item.excerpt ? ` — ${item.excerpt}` : ''}`).join('\n')
    : '- 暂无证据；仅可保持候选状态。';
  return `---\nschema: ${claim.schema}\nid: ${claim.id}\nsubject_id: ${claim.subjectId}\npredicate: ${claim.predicate}\nstatus: ${claim.status}\nconfidence: ${claim.confidence}\nupdated_at: ${claim.updatedAt}\n---\n\n# ${claim.predicate}\n\n${markdownValue(claim.value)}\n\n## Evidence\n\n${evidence}\n`;
}

function sourceMarkdown(asset, hash) {
  return `---\nschema: edu-manager.source.v1\nid: ${asset.id}\nuri: ${asset.uri}\nmedia_type: ${asset.mediaType}\nsha256: ${hash}\nsynthetic: ${asset.synthetic === true}\n---\n\n# ${asset.title || asset.id}\n\n${String(asset.content || '')}\n`;
}

function createLlmWikiKnowledgeEngine(options = {}) {
  const rootPath = path.resolve(String(options.rootPath || ''));
  if (!String(options.rootPath || '').trim()) throw new KnowledgeEngineContractError('MISSING_ROOT', 'LLM Wiki 引擎必须指定 rootPath。');
  const readOnly = options.readOnly === true;
  const engineRoot = path.join(rootPath, '.edu-manager', 'knowledge-engine-v1');
  const paths = {
    sources: path.join(engineRoot, 'sources'),
    claims: path.join(engineRoot, 'claims'),
    claimHistory: path.join(engineRoot, 'claim-history'),
    relationships: path.join(engineRoot, 'relationships'),
    events: path.join(engineRoot, 'events.jsonl'),
    exports: path.join(engineRoot, 'exports'),
  };

  function ensureWritable() {
    if (readOnly) throw new KnowledgeEngineContractError('READ_ONLY', '当前 KnowledgeEngine 为只读模式。');
    fs.mkdirSync(engineRoot, { recursive: true });
  }

  function jsonFiles(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort().map((name) => path.join(directory, name));
  }

  const engine = {
    contractVersion: KNOWLEDGE_ENGINE_CONTRACT_VERSION,
    engineId: 'llm-wiki-local',
    engineVersion: '1.0.0',
    capabilities: Object.freeze({
      humanReadable: true,
      immutableSources: true,
      claims: true,
      events: true,
      relationships: true,
      hybridSearch: false,
      synthesis: false,
    }),

    health() {
      const exists = fs.existsSync(rootPath);
      let writable = false;
      if (exists && !readOnly) {
        try { fs.accessSync(rootPath, fs.constants.W_OK); writable = true; } catch { writable = false; }
      }
      return {
        ok: exists && (readOnly || writable),
        contractVersion: KNOWLEDGE_ENGINE_CONTRACT_VERSION,
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        rootPath,
        engineRoot,
        readOnly,
        writable,
        counts: {
          sources: jsonFiles(paths.sources).length,
          claims: jsonFiles(paths.claims).length,
          relationships: jsonFiles(paths.relationships).length,
        },
      };
    },

    importAsset(input = {}) {
      ensureWritable();
      const asset = {
        ...input,
        id: assertPortableId(input.id, 'asset.id'),
        uri: String(input.uri || '').trim(),
        title: String(input.title || input.id || ''),
        mediaType: String(input.mediaType || 'text/markdown'),
        content: String(input.content || ''),
        importedAt: String(input.importedAt || new Date().toISOString()),
        synthetic: input.synthetic === true,
      };
      if (!asset.uri) throw new KnowledgeEngineContractError('MISSING_SOURCE_URI', 'asset.uri 不能为空。');
      const sha256 = contentHash({ uri: asset.uri, content: asset.content });
      const metadataPath = path.join(paths.sources, `${asset.id}.json`);
      const markdownPath = path.join(paths.sources, `${asset.id}.md`);
      if (fs.existsSync(metadataPath)) {
        const existing = readJson(metadataPath);
        if (existing.sha256 !== sha256) {
          throw new KnowledgeEngineContractError('IMMUTABLE_SOURCE_CONFLICT', '同一来源 ID 已存在不同内容；原始资料不可覆盖。', { id: asset.id });
        }
        return { ok: true, duplicate: true, source: existing, markdownPath };
      }
      const source = { schema: 'edu-manager.source.v1', ...asset, sha256 };
      atomicWrite(metadataPath, `${JSON.stringify(source, null, 2)}\n`);
      atomicWrite(markdownPath, sourceMarkdown(asset, sha256));
      return { ok: true, duplicate: false, source, markdownPath };
    },

    upsertClaim(input = {}) {
      ensureWritable();
      const claim = normalizeClaim(input);
      const claimPath = path.join(paths.claims, `${claim.id}.json`);
      if (fs.existsSync(claimPath)) {
        const previous = readJson(claimPath);
        const revision = contentHash(previous);
        const historyPath = path.join(paths.claimHistory, claim.id, `${revision}.json`);
        if (!fs.existsSync(historyPath)) atomicWrite(historyPath, `${JSON.stringify(previous, null, 2)}\n`);
        claim.createdAt = previous.createdAt || claim.createdAt;
      }
      claim.revision = contentHash({ ...claim, revision: undefined });
      atomicWrite(claimPath, `${JSON.stringify(claim, null, 2)}\n`);
      atomicWrite(path.join(paths.claims, `${claim.id}.md`), claimMarkdown(claim));
      return { ok: true, claim, path: claimPath };
    },

    getClaim(id) {
      const claimId = assertPortableId(id, 'claim.id');
      const claimPath = path.join(paths.claims, `${claimId}.json`);
      return fs.existsSync(claimPath) ? readJson(claimPath) : null;
    },

    search(query, searchOptions = {}) {
      const text = String(query || '').trim().toLocaleLowerCase('zh-CN');
      const statuses = new Set(Array.isArray(searchOptions.statuses) ? searchOptions.statuses.map(String) : ['confirmed']);
      const subjectId = String(searchOptions.subjectId || '');
      const limit = Math.max(1, Math.min(100, Number(searchOptions.limit || 20)));
      const results = jsonFiles(paths.claims).map(readJson).filter((claim) => {
        if (!statuses.has(String(claim.status))) return false;
        if (subjectId && String(claim.subjectId) !== subjectId) return false;
        return true;
      }).map((claim) => {
        const haystack = `${claim.predicate}\n${typeof claim.value === 'string' ? claim.value : JSON.stringify(claim.value)}\n${claim.evidence.map((item) => item.excerpt || '').join('\n')}`.toLocaleLowerCase('zh-CN');
        const score = !text ? 1 : haystack.includes(text) ? 10 + haystack.split(text).length - 1 : 0;
        return { score, claim, citations: claim.evidence.map((item) => ({ evidenceId: item.id, sourceUri: item.sourceUri })) };
      }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || String(right.claim.updatedAt).localeCompare(String(left.claim.updatedAt))).slice(0, limit);
      return { query: String(query || ''), engineId: this.engineId, results };
    },

    appendEvent(input = {}) {
      ensureWritable();
      const event = {
        schema: 'edu-manager.knowledge-event.v1',
        ...input,
        id: assertPortableId(input.id, 'event.id'),
        type: String(input.type || '').trim(),
        occurredAt: String(input.occurredAt || new Date().toISOString()),
      };
      if (!event.type) throw new KnowledgeEngineContractError('MISSING_EVENT_TYPE', 'event.type 不能为空。');
      fs.mkdirSync(path.dirname(paths.events), { recursive: true });
      fs.appendFileSync(paths.events, `${JSON.stringify(event)}\n`, 'utf8');
      return { ok: true, event };
    },

    upsertRelationship(input = {}) {
      ensureWritable();
      const relationship = {
        schema: 'edu-manager.relationship.v1',
        ...input,
        id: assertPortableId(input.id, 'relationship.id'),
        fromId: assertPortableId(input.fromId, 'relationship.fromId'),
        toId: assertPortableId(input.toId, 'relationship.toId'),
        type: String(input.type || '').trim(),
        updatedAt: String(input.updatedAt || new Date().toISOString()),
      };
      if (!relationship.type) throw new KnowledgeEngineContractError('MISSING_RELATIONSHIP_TYPE', 'relationship.type 不能为空。');
      const relationshipPath = path.join(paths.relationships, `${relationship.id}.json`);
      atomicWrite(relationshipPath, `${JSON.stringify(relationship, null, 2)}\n`);
      return { ok: true, relationship, path: relationshipPath };
    },

    exportSnapshot(exportOptions = {}) {
      ensureWritable();
      const exportId = assertPortableId(exportOptions.exportId || `snapshot-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`, 'export.id');
      const exportDir = path.join(paths.exports, exportId);
      const snapshot = {
        schema: 'edu-manager.knowledge-export.v1',
        contractVersion: KNOWLEDGE_ENGINE_CONTRACT_VERSION,
        engineId: this.engineId,
        exportedAt: new Date().toISOString(),
        sources: jsonFiles(paths.sources).map(readJson),
        claims: jsonFiles(paths.claims).map(readJson),
        relationships: jsonFiles(paths.relationships).map(readJson),
        events: fs.existsSync(paths.events) ? fs.readFileSync(paths.events, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [],
      };
      atomicWrite(path.join(exportDir, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
      const summary = `# KnowledgeEngine Export\n\n- Contract: ${snapshot.contractVersion}\n- Engine: ${snapshot.engineId}\n- Sources: ${snapshot.sources.length}\n- Claims: ${snapshot.claims.length}\n- Relationships: ${snapshot.relationships.length}\n- Events: ${snapshot.events.length}\n\n该导出使用稳定业务 ID，脱离原引擎后仍可审计。\n`;
      atomicWrite(path.join(exportDir, 'README.md'), summary);
      return { ok: true, exportId, exportDir, snapshot };
    },
  };

  return assertKnowledgeEngine(engine);
}

module.exports = { createLlmWikiKnowledgeEngine };
