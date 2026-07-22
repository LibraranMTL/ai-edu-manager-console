function parseJsonText(value) {
  return JSON.parse(String(value ?? '').replace(/^\uFEFF/, ''));
}

module.exports = { parseJsonText };
