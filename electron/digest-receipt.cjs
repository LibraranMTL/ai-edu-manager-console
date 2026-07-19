function nextNonWhitespace(source, start) {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return { index, char: source[index] || '' };
}

function isLikelyClosingQuote(source, quoteIndex) {
  const next = nextNonWhitespace(source, quoteIndex + 1);
  if (!next.char || next.char === ':' || next.char === '}' || next.char === ']') return true;
  if (next.char !== ',') return false;
  const afterComma = nextNonWhitespace(source, next.index + 1);
  return !afterComma.char || ['"', '}', ']'].includes(afterComma.char);
}

function repairUnescapedJsonStringQuotes(source) {
  let output = '';
  let inString = false;
  let escaped = false;
  let changed = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      if (isLikelyClosingQuote(source, index)) {
        output += char;
        inString = false;
      } else {
        output += '\\"';
        changed = true;
      }
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\n') output += '\\n';
      changed = true;
      continue;
    }
    output += char;
  }
  return { text: output, changed };
}

function parseDigestReceipt(source) {
  try {
    return { ok: true, value: JSON.parse(source), repaired: false, originalError: '' };
  } catch (error) {
    const repaired = repairUnescapedJsonStringQuotes(source);
    if (!repaired.changed) return { ok: false, value: null, repaired: false, originalError: error.message };
    try {
      return { ok: true, value: JSON.parse(repaired.text), repaired: true, originalError: error.message };
    } catch (repairError) {
      return {
        ok: false,
        value: null,
        repaired: false,
        originalError: error.message,
        repairError: repairError.message,
      };
    }
  }
}

module.exports = {
  parseDigestReceipt,
  repairUnescapedJsonStringQuotes,
};
