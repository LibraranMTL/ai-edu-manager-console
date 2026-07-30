function normalizedHash(value) {
  return String(value || '').trim().toLowerCase();
}

function duplicateKnowledgeRawFiles({
  rawFiles = [],
  verifiedKnowledgeFiles = [],
  authoritativeRawHashes = [],
} = {}) {
  const authoritative = new Set(authoritativeRawHashes.map(normalizedHash).filter(Boolean));
  const knowledgeHashes = new Set(verifiedKnowledgeFiles.map((item) => normalizedHash(item.sha256)).filter(Boolean));
  return rawFiles.filter((item) => {
    const hash = normalizedHash(item.sha256);
    return hash && knowledgeHashes.has(hash) && !authoritative.has(hash);
  });
}

module.exports = {
  duplicateKnowledgeRawFiles,
};
