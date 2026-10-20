'use strict';
const path = require('node:path').win32;

// Return exact spans, never a URI suffix or the prose following a code span.
// Bare paths stop at whitespace; paths containing spaces must be quoted.
function detectedWindowsPaths(text) {
  const source = String(text || '');
  const starts = /[A-Za-z]:[\\/](?![\\/])|\\\\[^\\\s]+\\/g;
  const found = [];
  for (const match of source.matchAll(starts)) {
    const start = match.index;
    if (start && /[\p{L}\p{N}_:/\\]/u.test(source[start - 1])) continue;
    const quote = ['`', '"', "'"].includes(source[start - 1]) ? source[start - 1] : '';
    let end = start;
    while (end < source.length) {
      const char = source[end];
      if (/[\r\n<>|]/.test(char) || (quote ? char === quote : /[\s`"'，。；;、）)\]】}]/.test(char))) break;
      end++;
    }
    // An unterminated quote is ambiguous: report it but never auto-rewrite it.
    const repairable = !quote || source[end] === quote;
    const detectedPath = source.slice(start, end).replace(/[.,，。；;]+$/g, '');
    if (detectedPath) found.push({ detectedPath, start, end: start + detectedPath.length, repairable });
  }
  return found;
}

function logicalPathReplacement(detectedPath, pathmap, verifiedHistoricalRoots = []) {
  const value = path.normalize(String(detectedPath || ''));
  const entries = Object.entries(pathmap || {}).filter(([, target]) => target)
    .sort((a, b) => String(b[1]).length - String(a[1]).length);
  for (const [logical, target] of entries) {
    const relative = path.relative(path.normalize(target), value);
    if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\'))) {
      return logical + (relative ? '/' + relative.replace(/\\/g, '/') : '');
    }
  }
  // Historical roots must come from an identity-verified binding record.
  // A matching student name or generic raw/report segment is not proof.
  const root = pathmap?.['@KB_ROOT'];
  if (!root) return '';
  const matches = verifiedHistoricalRoots.map(oldRoot => path.relative(oldRoot, value))
    .filter(relative => !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\'));
  if (matches.length !== 1) return '';
  const rebound = path.join(root, matches[0]);
  for (const [logical, target] of entries) {
    const relative = path.relative(target, rebound);
    if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\'))) {
      return logical + (relative ? '/' + relative.replace(/\\/g, '/') : '');
    }
  }
  return '';
}

function replaceDetectedPathSpans(text, replacements) {
  const byValue = new Map(replacements.map(item => [item.detectedPath, item.replacement]));
  let next = text;
  for (const item of detectedWindowsPaths(text).reverse()) {
    const replacement = byValue.get(item.detectedPath);
    if (replacement && item.repairable) next = next.slice(0, item.start) + replacement + next.slice(item.end);
  }
  return next;
}
module.exports = { detectedWindowsPaths, logicalPathReplacement, replaceDetectedPathSpans };
