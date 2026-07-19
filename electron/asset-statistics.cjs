function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function recentAssetTrend(assets, nowValue = new Date(), dayCount = 7) {
  const now = validDate(nowValue) || new Date();
  const count = Math.max(1, Number(dayCount) || 7);
  const days = [];
  const buckets = new Map();

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = localDayKey(date);
    const item = {
      date: key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      added: 0,
      references: 0,
    };
    days.push(item);
    buckets.set(key, item);
  }

  let undatedAssets = 0;
  let undatedReferences = 0;
  for (const asset of Array.isArray(assets) ? assets : []) {
    const addedAt = validDate(asset?.uploadedAt || asset?.createdAt);
    if (addedAt) {
      const bucket = buckets.get(localDayKey(addedAt));
      if (bucket) bucket.added += 1;
    } else {
      undatedAssets += 1;
    }

    for (const reference of Array.isArray(asset?.references) ? asset.references : []) {
      const linkedAt = validDate(reference?.linkedAt);
      if (!linkedAt) {
        undatedReferences += 1;
        continue;
      }
      const bucket = buckets.get(localDayKey(linkedAt));
      if (bucket) bucket.references += 1;
    }
  }

  return {
    days,
    addedTotal: days.reduce((total, item) => total + item.added, 0),
    referenceTotal: days.reduce((total, item) => total + item.references, 0),
    undatedAssets,
    undatedReferences,
  };
}

function mergeAssetReferences(references) {
  const deduped = new Map();
  for (const item of Array.isArray(references) ? references : []) {
    if (!item || typeof item !== 'object') continue;
    const key = `${item.spaceType || ''}|${item.spaceId || ''}|${item.role || ''}|${item.path || ''}`;
    const previous = deduped.get(key);
    if (!previous) {
      deduped.set(key, item);
      continue;
    }
    deduped.set(key, {
      ...previous,
      ...item,
      linkedAt: previous.linkedAt || item.linkedAt,
    });
  }
  return Array.from(deduped.values());
}

module.exports = { mergeAssetReferences, recentAssetTrend };
