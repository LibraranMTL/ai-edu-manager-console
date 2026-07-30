const { evidenceMarkers } = require('./report-auto-publication.cjs');

function splitEvidenceSources(evidence = {}) {
  const sources = [
    ...(Array.isArray(evidence.sourcePaths) ? evidence.sourcePaths : []),
    evidence.sourceUri,
    evidence.sourceURI,
    evidence.sourcePath,
  ];
  return [...new Set(sources
    .flatMap((value) => String(value || '').split(/[；;]/u))
    .map((value) => value.trim())
    .filter(Boolean))];
}

function resolveReportEvidence(options = {}) {
  const content = String(options.content || '');
  const evidence = Array.isArray(options.growthIndex?.evidence) ? options.growthIndex.evidence : [];
  const byId = new Map(evidence.map((item) => [String(item.id || ''), item]));
  const citedIds = [...new Set(evidenceMarkers(content).flatMap((marker) => marker.ids))];
  const cards = [];
  const missingIds = [];

  for (const evidenceId of citedIds) {
    const item = byId.get(evidenceId);
    if (!item) {
      missingIds.push(evidenceId);
      continue;
    }
    const sources = splitEvidenceSources(item).map((source, sourceIndex) => {
      const resolved = typeof options.resolveSource === 'function'
        ? options.resolveSource(source, item)
        : { available: false, location: source };
      return {
        id: `${evidenceId}:${sourceIndex}`,
        title: String(resolved?.title || source.split(/[\\/]/u).pop() || '来源资料'),
        location: String(resolved?.location || source),
        uri: String(resolved?.uri || (source.startsWith('edu://') ? source : '')),
        available: Boolean(resolved?.available),
        kind: String(resolved?.kind || (source.startsWith('edu://') ? 'archive' : 'file')),
      };
    });
    cards.push({
      evidenceId,
      title: String(item.title || '成长依据'),
      summary: String(item.content || item.note || '该结论引用了一条成长证据。'),
      observedAt: String(item.updatedAt || item.createdAt || ''),
      projectId: String(item.projectId || ''),
      projectName: String(item.projectName || ''),
      ability: String(item.ability || ''),
      status: String(item.status || ''),
      sources,
      sourceAvailable: sources.some((source) => source.available),
    });
  }

  return {
    ok: missingIds.length === 0 && cards.every((card) => card.sourceAvailable),
    legacy: citedIds.length === 0,
    citedCount: citedIds.length,
    cards,
    missingIds,
    unavailableCount: cards.filter((card) => !card.sourceAvailable).length,
    message: citedIds.length === 0
      ? '这是一份历史报告，尚未包含可下钻的证据 ID。报告仍可正常阅读。'
      : missingIds.length || cards.some((card) => !card.sourceAvailable)
        ? '部分依据暂时无法定位，正式报告保持不变；系统已将其视为需要补充。'
        : `已定位 ${cards.length} 条报告依据。`,
  };
}

module.exports = {
  resolveReportEvidence,
  splitEvidenceSources,
};
