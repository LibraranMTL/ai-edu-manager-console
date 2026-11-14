'use strict';

// Cloud indexing is intentionally isolated from the HTTP process. It reads one
// immutable content-addressed object, extracts bounded text, and never opens
// links, executes document instructions, or writes back to the source object.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parentPort, workerData } = require('node:worker_threads');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const yauzl = require('yauzl');
const { SaxesParser } = require('saxes');
const execFileAsync = promisify(execFile);

const LIMITS = Object.freeze({ input: 20 * 1024 * 1024, expanded: 64 * 1024 * 1024,
  entry: 16 * 1024 * 1024, entries: 3000, text: 4 * 1024 * 1024, xmlDepth: 128, pdfPages: 300 });

function problem(code, message) { const error = new Error(message); error.code = code; return error; }
function ensure(value, code, message) { if (!value) throw problem(code, message); }
function addText(state, value) {
  const text = String(value || ''); state.bytes += Buffer.byteLength(text);
  ensure(state.bytes <= LIMITS.text, 'extraction_limit', '云端索引正文超过容量限制。'); state.parts.push(text);
}
function decode(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw problem('unsupported_encoding', '资料不是有效UTF-8文本。'); }
}
function parseXml(bytes, handlers = {}) {
  const parser = new SaxesParser({ xmlns: true }); let depth = 0;
  parser.on('doctype', () => { throw problem('unsafe_document', '拒绝含DTD声明的Office部件。'); });
  parser.on('opentag', tag => { ensure(++depth <= LIMITS.xmlDepth, 'extraction_limit', 'Office XML嵌套超过限制。'); handlers.open?.(tag); });
  parser.on('closetag', tag => { handlers.close?.(tag); depth--; });
  parser.on('text', value => handlers.text?.(value)); parser.on('cdata', value => handlers.text?.(value));
  parser.on('error', () => { throw problem('invalid_document', 'Office XML结构无效。'); });
  parser.write(decode(bytes)).close();
}
function paragraphText(bytes) {
  ensure(bytes, 'invalid_document', 'DOCX缺少word/document.xml。');
  const state = { bytes: 0, parts: [] }; let inText = 0, deleted = 0;
  parseXml(bytes, { open(tag) {
    if (tag.local === 'del') deleted++; if (tag.local === 't') inText++;
    if (!deleted && ['tab', 'br', 'cr'].includes(tag.local)) addText(state, tag.local === 'tab' ? '\t' : '\n');
  }, text(value) { if (inText && !deleted) addText(state, value); }, close(tag) {
    if (tag.local === 't') inText--; if (!deleted && ['p', 'tr'].includes(tag.local)) addText(state, '\n');
    if (!deleted && tag.local === 'tc') addText(state, '\t'); if (tag.local === 'del') deleted--;
  } });
  return state.parts.join('').trim();
}
async function docxParts(bytes) {
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(bytes,
    { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolve(value)));
  const kept = new Map(); const seen = new Set(); let entries = 0, expanded = 0, ended = false, active;
  return new Promise((resolve, reject) => {
    const finish = (error) => { if (ended) return; ended = true; active?.destroy(); zip.close(); error ? reject(error) : resolve(kept); };
    zip.on('error', () => finish(problem('invalid_document', 'DOCX压缩包损坏。')));
    zip.on('end', () => finish());
    zip.on('entry', entry => { (async () => {
      const name = entry.fileName;
      ensure(++entries <= LIMITS.entries && !seen.has(name), 'extraction_limit', 'DOCX部件过多或重复。');
      seen.add(name);
      ensure(!name.includes('\\') && !name.startsWith('/') && !name.includes(':') && !name.split('/').includes('..'),
        'unsafe_document', 'DOCX部件路径无效。');
      ensure(!(entry.generalPurposeBitFlag & 1), 'unsupported_encryption', '加密DOCX不能建立索引。');
      ensure(!/vbaProject\.bin$/i.test(name), 'unsafe_document', '含宏Office文档不进入云端索引。');
      expanded += entry.uncompressedSize;
      ensure(entry.uncompressedSize <= LIMITS.entry && expanded <= LIMITS.expanded, 'extraction_limit', 'DOCX展开容量超过限制。');
      active = await new Promise((res, rej) => zip.openReadStream(entry, (error, stream) => error ? rej(error) : res(stream)));
      const xml = /\.xml(?:\.rels)?$|\.rels$/i.test(name); const chunks = []; let actual = 0;
      for await (const chunk of active) { actual += chunk.length; ensure(actual <= LIMITS.entry, 'extraction_limit', 'DOCX部件过大。'); if (xml) chunks.push(chunk); }
      ensure(actual === entry.uncompressedSize, 'invalid_document', 'DOCX部件长度不符。');
      if (xml) { const content = Buffer.concat(chunks); parseXml(content); if (/^word\/(?:document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/.test(name)) kept.set(name, content); }
      active = null; if (!ended) zip.readEntry();
    })().catch(finish); });
    zip.readEntry();
  });
}
async function extractDocx(bytes) {
  const files = await docxParts(bytes); const parts = [];
  const body = paragraphText(files.get('word/document.xml')); if (body) parts.push(body);
  for (const name of [...files.keys()].filter(name => name !== 'word/document.xml').sort()) {
    const text = paragraphText(files.get(name)); if (text) parts.push(`[附加部件 ${name}]\n${text}`);
  }
  const text = parts.join('\n\n').trim(); ensure(text, 'empty_source', 'DOCX没有可索引正文。');
  ensure(Buffer.byteLength(text) <= LIMITS.text, 'extraction_limit', 'DOCX正文超过索引限制。');
  return { text, status: files.size > 1 ? 'partial' : 'complete', pageCount: 0 };
}
async function extractWithOcr(job) {
  const command = String(job.ocrCommand || '');
  const args = Array.isArray(job.ocrArgs) ? job.ocrArgs.map(value => String(value).replaceAll('{input}', job.objectPath)) : [];
  ensure(command && path.isAbsolute(command) && args.length <= 12 && args.every(value => value.length <= 2048),
    'ocr_unavailable', 'PDF没有嵌入式正文；云端尚未配置扫描件OCR适配器。');
  const { stdout } = await execFileAsync(command, args, { windowsHide: true, timeout: 180000,
    maxBuffer: LIMITS.text, encoding: 'utf8', env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '' } });
  const text = String(stdout || '').trim();
  ensure(text, 'ocr_empty', '扫描件OCR未返回可索引正文。');
  ensure(Buffer.byteLength(text) <= LIMITS.text, 'extraction_limit', 'OCR正文超过索引限制。');
  return { text, status: 'ocr_complete', pageCount: 0 };
}
async function extractPdf(bytes, job) {
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const pdfjs = await import(pathToFileURL(path.join(root, 'legacy', 'build', 'pdf.mjs')).href);
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), stopAtErrors: true, useSystemFonts: false,
    disableFontFace: true, enableXfa: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, verbosity: 0 });
  try {
    const document = await loading.promise;
    ensure(!document.isPureXfa && document.numPages > 0 && document.numPages <= LIMITS.pdfPages,
      'extraction_limit', 'PDF页数无效、超过限制或属于动态XFA。');
    const state = { bytes: 0, parts: [] }; let emptyPages = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const pageText = content.items.filter(item => typeof item.str === 'string')
          .map(item => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('').trim();
        if (!pageText) emptyPages++; else addText(state, `\n[PDF 第${pageNumber}页]\n${pageText}\n`);
      } finally { page.cleanup(); }
    }
    const text = state.parts.join('').trim();
    if (!text) return extractWithOcr(job);
    return { text, status: emptyPages ? 'partial' : 'complete', pageCount: document.numPages };
  } catch (error) {
    if (error?.name === 'PasswordException') throw problem('unsupported_encryption', 'PDF需要密码，不能建立索引。');
    throw error;
  } finally { await loading.destroy(); }
}
async function extract(job) {
  const stat = await fs.stat(job.objectPath);
  ensure(stat.isFile() && stat.size === Number(job.byteSize) && stat.size <= LIMITS.input, 'source_changed', '云端对象大小不符。');
  const bytes = await fs.readFile(job.objectPath);
  ensure(crypto.createHash('sha256').update(bytes).digest('hex') === job.contentSha256, 'source_changed', '云端对象指纹不符。');
  if (job.contentType === 'text/markdown' || job.contentType === 'text/plain') {
    const text = decode(bytes).trim(); ensure(text && !text.includes('\0'), 'empty_source', '文本没有可索引正文。');
    return { text, status: 'complete', pageCount: 0 };
  }
  if (job.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return extractDocx(bytes);
  if (job.contentType === 'application/pdf') return extractPdf(bytes, job);
  throw problem('unsupported', '该云端资料类型不支持建立全文索引。');
}

if (parentPort) extract(workerData).then(result => parentPort.postMessage({ ok: true, result }),
  error => parentPort.postMessage({ ok: false, error: { code: error.code || 'extraction_failed', message: error.message } }));

module.exports = { extract, extractWithOcr, LIMITS };
