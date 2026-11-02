const DEFAULT_MAXIMUM_SAVE_INTERVAL_MS = 60 * 1000;

function timeOf(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoAt(milliseconds) {
  return Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds).toISOString() : '';
}

function normalizedSamples(session = {}) {
  const samples = Array.isArray(session.captureSamples)
    ? session.captureSamples
    : Array.isArray(session.samples) ? session.samples : [];
  return samples.map((sample, index) => ({
    ...sample,
    sampledAt: String(sample?.sampledAt || ''),
    time: timeOf(sample?.sampledAt),
    decision: String(sample?.decision || 'unknown'),
    difference: Number.isFinite(Number(sample?.difference)) ? Number(sample.difference) : null,
    captureItemId: String(sample?.captureItemId || ''),
    paused: Boolean(sample?.paused),
    index,
  })).filter((sample) => sample.time > 0)
    .sort((left, right) => left.time - right.time || left.index - right.index);
}

function trustedSample(sample) {
  return Boolean(sample && !sample.paused
    && !['paused', 'pause', 'source_unavailable', 'capture_error', 'invalid_timestamp'].includes(sample.decision));
}

function duplicateSample(sample) {
  return ['duplicate', 'minimum_interval', 'below_threshold'].includes(String(sample?.decision || ''));
}

function trustedEventTime(event = {}) {
  if (event.timeSource && event.timeSource !== 'captured_at') return false;
  if (event.timePrecision === 'timezone_unspecified') return false;
  if (event.clockStatus === 'suspected_future_capture') return false;
  if (['invalid', 'missing', 'timezone_unspecified'].includes(String(event.captureTimeStatus || ''))) return false;
  return true;
}

function captureMaximumSaveInterval(session = {}, options = {}) {
  return Math.max(1_000, Number(
    options.maximumSaveIntervalMs
      || session.options?.maximumSaveIntervalMs
      || session.capturePolicy?.maximumSaveIntervalMs
      || DEFAULT_MAXIMUM_SAVE_INTERVAL_MS,
  ));
}

function pauseIntervals(samples) {
  const intervals = [];
  let pausedAt = 0;
  for (const sample of samples) {
    if (sample.paused || sample.decision === 'paused' || sample.decision === 'pause') {
      if (!pausedAt) pausedAt = sample.time;
      continue;
    }
    if (pausedAt && (sample.decision === 'resumed' || trustedSample(sample))) {
      intervals.push([pausedAt, sample.time]);
      pausedAt = 0;
    }
  }
  if (pausedAt) intervals.push([pausedAt, Number.POSITIVE_INFINITY]);
  return intervals;
}

function overlapMs(start, end, intervals) {
  return intervals.reduce((sum, [left, right]) => {
    const overlapStart = Math.max(start, left);
    const overlapEnd = Math.min(end, right);
    return sum + Math.max(0, overlapEnd - overlapStart);
  }, 0);
}

function mergeIntervals(intervals = []) {
  const ordered = intervals.map(([start, end]) => [Number(start), Number(end)])
    .filter(([start, end]) => Number.isFinite(start) && (Number.isFinite(end) || end === Number.POSITIVE_INFINITY) && end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (!previous || interval[0] > previous[1]) merged.push([...interval]);
    else previous[1] = Math.max(previous[1], interval[1]);
  }
  return merged;
}

function intervalDuration(intervals = []) {
  return mergeIntervals(intervals).reduce((sum, [start, end]) => sum + end - start, 0);
}

function subtractIntervals(intervals = [], exclusions = []) {
  let remaining = mergeIntervals(intervals);
  for (const [cutStart, cutEnd] of mergeIntervals(exclusions)) {
    const next = [];
    for (const [start, end] of remaining) {
      if (cutEnd <= start || cutStart >= end) next.push([start, end]);
      else {
        if (cutStart > start) next.push([start, Math.min(cutStart, end)]);
        if (cutEnd < end) next.push([Math.max(cutEnd, start), end]);
      }
    }
    remaining = next;
  }
  return remaining;
}

function intersectIntervals(intervals = [], start, end) {
  if (!(end > start)) return [];
  return mergeIntervals(intervals).map(([left, right]) => [Math.max(left, start), Math.min(right, end)])
    .filter(([left, right]) => right > left);
}

function eventCoverage(events = [], session = {}, options = {}) {
  const sorted = events.map((event, sourceIndex) => ({ event, sourceIndex }))
    .filter(({ event }) => timeOf(event?.occurredAt) > 0 && trustedEventTime(event))
    .sort((left, right) => timeOf(left.event.occurredAt) - timeOf(right.event.occurredAt) || left.sourceIndex - right.sourceIndex);
  const contextEvents = Array.isArray(options.contextEvents) ? options.contextEvents : sorted.map((item) => item.event);
  const contextTimes = [...contextEvents]
    .filter(trustedEventTime)
    .map((event) => timeOf(event?.occurredAt)).filter(Boolean).sort((left, right) => left - right);
  const sessionStart = timeOf(session.startedAt);
  const samples = normalizedSamples(session);
  const trusted = samples.filter(trustedSample);
  const hasSamples = samples.length > 0;
  const maximumSaveIntervalMs = captureMaximumSaveInterval(session, options);
  const sessionEnd = timeOf(session.endedAt || session.completedAt);
  const pauses = pauseIntervals(samples);
  return sorted.map(({ event, sourceIndex }, index) => {
    const eventAt = timeOf(event.occurredAt);
    const start = index === 0 && contextTimes[0] === eventAt && sessionStart > 0 && sessionStart <= eventAt
      ? sessionStart : eventAt;
    const nextEventAt = contextTimes.find((value) => value > eventAt) || 0;
    const naturalEnd = nextEventAt || sessionEnd || start + maximumSaveIntervalMs;
    const samplesInWindow = trusted.filter((sample) => sample.time >= start
      && (nextEventAt ? sample.time < naturalEnd : sample.time <= naturalEnd));
    const lastTrustedAt = samplesInWindow.at(-1)?.time || start;
    const cappedEnd = Math.min(naturalEnd, lastTrustedAt + maximumSaveIntervalMs);
    const end = Math.max(start, cappedEnd);
    const sessionEndInferred = !nextEventAt && sessionEnd > start && end === sessionEnd && sessionEnd <= lastTrustedAt + maximumSaveIntervalMs;
    const capped = naturalEnd > end + 1;
    const rawCoverageIntervals = end > start ? [[start, end]] : [];
    const activeIntervals = subtractIntervals(rawCoverageIntervals, pauses);
    const observedBoundary = hasSamples ? Math.max(start, Math.min(end, lastTrustedAt)) : start;
    const observedIntervals = hasSamples ? intersectIntervals(activeIntervals, start, observedBoundary) : [];
    const inferredIntervals = hasSamples
      ? intersectIntervals(activeIntervals, observedBoundary, end) : activeIntervals;
    const unobservedIntervals = subtractIntervals(naturalEnd > end ? [[end, naturalEnd]] : [], pauses);
    const pausedIntervals = subtractIntervals(rawCoverageIntervals, activeIntervals);
    const activeDurationMs = intervalDuration(activeIntervals);
    const inferredTailMs = intervalDuration(inferredIntervals);
    const observedDurationMs = intervalDuration(observedIntervals);
    const unobservedDurationMs = intervalDuration(unobservedIntervals);
    const pauseMs = intervalDuration(pausedIntervals);
    const basis = !hasSamples
      ? 'historical_reconstruction'
      : capped ? 'unobserved_capped'
        : sessionEndInferred ? 'session_end_inferred'
          : samplesInWindow.some((sample) => sample.captureItemId) ? 'duplicate_covered' : 'sample_covered';
    const result = {
      coverageStartAt: isoAt(start),
      coverageEndAt: isoAt(end),
      durationMs: activeDurationMs,
      observedDurationMs,
      inferredDurationMs: inferredTailMs,
      unobservedDurationMs,
      duplicateSampleCount: samplesInWindow.filter(duplicateSample).length,
      trustedSampleCount: samplesInWindow.length,
      durationBasis: basis,
      durationConfidence: hasSamples ? 'estimated' : 'historical_low',
      pausedDurationMs: pauseMs,
      historicalReconstruction: !hasSamples,
    };
    Object.defineProperty(result, '_coverageMeta', {
      enumerable: false,
      value: {
        sourceIndex,
        rawCoverageIntervals,
        activeIntervals,
        observedIntervals,
        inferredIntervals,
        unobservedIntervals,
        pausedIntervals,
        trustedSampleIndexes: samplesInWindow.map((sample) => sample.index),
        duplicateSampleIndexes: samplesInWindow.filter(duplicateSample).map((sample) => sample.index),
      },
    });
    return result;
  });
}

function attachEventCoverage(events = [], session = {}, options = {}) {
  const coverage = eventCoverage(events, session, options);
  const bySourceIndex = new Map(coverage.map((item) => [item._coverageMeta?.sourceIndex, item]));
  return [...events].map((event, index) => ({ ...event, ...(bySourceIndex.get(index) || {}) }));
}

function aggregateCoverage(events = [], session = {}, options = {}) {
  const items = eventCoverage(events, session, options);
  const metadata = items.map((item) => item._coverageMeta).filter(Boolean);
  const rawCoverageIntervals = mergeIntervals(metadata.flatMap((item) => item.rawCoverageIntervals));
  const activeIntervals = mergeIntervals(metadata.flatMap((item) => item.activeIntervals));
  const observedIntervals = mergeIntervals(metadata.flatMap((item) => item.observedIntervals));
  const unobservedIntervals = subtractIntervals(metadata.flatMap((item) => item.unobservedIntervals), activeIntervals);
  const pausedIntervals = mergeIntervals(metadata.flatMap((item) => item.pausedIntervals));
  const duplicateSampleIndexes = new Set(metadata.flatMap((item) => item.duplicateSampleIndexes));
  const trustedSampleIndexes = new Set(metadata.flatMap((item) => item.trustedSampleIndexes));
  const coveredDurationMs = intervalDuration(activeIntervals);
  const observedDurationMs = intervalDuration(observedIntervals);
  return {
    coverageStartAt: isoAt(rawCoverageIntervals[0]?.[0]),
    coverageEndAt: isoAt(rawCoverageIntervals.at(-1)?.[1]),
    durationMs: coveredDurationMs,
    observedDurationMs,
    inferredDurationMs: Math.max(0, coveredDurationMs - observedDurationMs),
    unobservedDurationMs: intervalDuration(unobservedIntervals),
    duplicateSampleCount: duplicateSampleIndexes.size,
    trustedSampleCount: trustedSampleIndexes.size,
    pausedDurationMs: intervalDuration(pausedIntervals),
    durationBasis: items.some((item) => item.durationBasis === 'historical_reconstruction')
      ? 'historical_reconstruction'
      : items.some((item) => item.durationBasis === 'unobserved_capped')
        ? 'unobserved_capped'
        : items.some((item) => item.durationBasis === 'session_end_inferred')
          ? 'session_end_inferred' : 'duplicate_covered',
    durationConfidence: items.some((item) => item.durationConfidence === 'historical_low') ? 'historical_low' : 'estimated',
    historicalReconstruction: items.some((item) => item.historicalReconstruction),
  };
}

module.exports = {
  DEFAULT_MAXIMUM_SAVE_INTERVAL_MS,
  aggregateCoverage,
  attachEventCoverage,
  captureMaximumSaveInterval,
  eventCoverage,
  normalizedSamples,
};
