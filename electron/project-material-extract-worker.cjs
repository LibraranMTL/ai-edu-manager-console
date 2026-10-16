// Runs only in a bounded worker. It never executes macros, formulas, document
// instructions or external relationships and never writes into source files.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');
const { crc32 } = require('node:zlib');
const yauzl = require('yauzl');
const { SaxesParser } = require('saxes');
const { MaterialError, invariant } = require('./project-material-contract.cjs');

const LIMITS = Object.freeze({ input: 32 * 1024 * 1024, expanded: 96 * 1024 * 1024,
  entry: 16 * 1024 * 1024, entries: 3000, text: 2 * 1024 * 1024, xmlDepth: 128, sheets: 100, cells: 100000 });
const TEXT_FORMATS = new Set(['txt', 'md', 'csv', 'json', 'jsonl', 'yaml', 'yml', 'xml', 'html', 'htm', 'log']);

function textCollector(limit = LIMITS.text) {
  let size = 0; const parts = [];
  return { add(value) { const text = String(value); size += Buffer.byteLength(text);
    invariant(size <= limit, 'extraction_limit', '提取正文超过容量限制，需要分段处理，未截断为成功。'); parts.push(text); },
  value() { return parts.join('').trim(); } };
}

function decodeText(bytes) {
  let encoding = 'utf-8', offset = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; offset = 2; }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; offset = 2; }
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset)); }
  catch { throw new MaterialError('unsupported_encoding', '无法可靠识别文本编码，请转为UTF-8或带BOM的UTF-16。'); }
}

function parseXml(bytes, handlers = {}) {
  invariant(bytes, 'invalid_document', 'Office文档缺少必需的内容部件。');
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  parser.on('doctype', () => { throw new MaterialError('unsafe_document', '拒绝含DTD声明的文档部件。'); });
  parser.on('opentag', (tag) => {
    invariant(++depth <= LIMITS.xmlDepth, 'extraction_limit', '文档XML嵌套超过限制。'); handlers.open?.(tag);
  });
  parser.on('closetag', (tag) => { handlers.close?.(tag); depth--; });
  parser.on('text', (value) => handlers.text?.(value));
  parser.on('cdata', (value) => handlers.text?.(value));
  parser.on('error', () => { throw new MaterialError('invalid_document', '文档XML结构无效。'); });
  parser.write(decodeText(bytes)).close();
}
const attribute = (tag, local) => Object.values(tag.attributes).find((value) => value.local === local)?.value;

async function officeArchive(bytes, format) {
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(bytes,
    { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolve(value)));
  const files = new Map(); let declared = 0, actual = 0, count = 0;
  // Drain and validate ALL members, including ignored media, before ExcelJS
  // receives the archive. No extraction to disk and no unbounded ZIP.load().
  return new Promise((resolve, reject) => {
    let ended = false, stream;
    const finish = (error) => { if (ended) return; ended = true; stream?.destroy(); zip.close(); error ? reject(error) : resolve(files); };
    zip.on('error', (error) => finish(new MaterialError('invalid_document', 'Office压缩包损坏。', { diagnostic: error.message })));
    zip.on('end', () => finish());
    zip.on('entry', (entry) => {
      (async () => {
        const name = entry.fileName;
        invariant(++count <= LIMITS.entries && !files.has(name), 'extraction_limit', 'Office部件过多或名称重复。');
        invariant(!name.includes('\\') && !name.split('/').includes('..') && !name.startsWith('/') && !name.includes(':'),
          'unsafe_document', 'Office部件路径无效。');
        invariant(!(entry.generalPurposeBitFlag & 1), 'unsupported_encryption', '加密Office文档需要先解密。');
        declared += entry.uncompressedSize;
        invariant(entry.uncompressedSize <= LIMITS.entry && declared <= LIMITS.expanded, 'extraction_limit', 'Office展开容量超过限制。');
        invariant(!/vbaProject\.bin$/i.test(name), 'unsupported', '含宏文档仅保存，不执行或自动消化。');
        files.set(name, null);
        stream = await new Promise((res, rej) => zip.openReadStream(entry, (error, value) => error ? rej(error) : res(value)));
        const xml = /\.xml(?:\.rels)?$|\.rels$/i.test(name);
        const keep = format !== 'xlsx' && xml;
        const chunks = []; let memberSize = 0, checksum = 0;
        for await (const chunk of stream) {
          memberSize += chunk.length; actual += chunk.length;
          invariant(memberSize <= LIMITS.entry && actual <= LIMITS.expanded, 'extraction_limit', 'Office实际展开容量超过限制。');
          checksum = crc32(chunk, checksum);
          if (xml) chunks.push(chunk);
        }
        invariant(memberSize === entry.uncompressedSize && checksum === entry.crc32, 'invalid_document', 'Office部件长度或校验失败。');
        if (xml) {
          const content = Buffer.concat(chunks);
          parseXml(content); // Reject malformed XML/DTD even in unused parts.
          if (keep) files.set(name, content);
        }
        stream = null;
        if (!ended) zip.readEntry();
      })().catch(finish);
    });
    zip.readEntry();
  });
}

function paragraphText(bytes) {
  const output = textCollector(); let inText = 0, deleted = 0;
  parseXml(bytes, { open(tag) {
    if (tag.local === 'del') deleted++;
    if (tag.local === 't') inText++;
    if (!deleted && ['tab', 'br', 'cr'].includes(tag.local)) output.add(tag.local === 'tab' ? '\t' : '\n');
  }, text(value) { if (inText && !deleted) output.add(value); }, close(tag) {
    if (tag.local === 't') inText--;
    if (!deleted && ['p', 'tr'].includes(tag.local)) output.add('\n');
    if (!deleted && tag.local === 'tc') output.add('\t');
    if (tag.local === 'del') deleted--;
  } });
  return output.value();
}

function relationshipMap(bytes, owner) {
  const links = new Map();
  parseXml(bytes, { open(tag) {
    if (tag.local !== 'Relationship') return;
    const id = attribute(tag, 'Id'), target = attribute(tag, 'Target'), type = attribute(tag, 'Type') || '';
    invariant(id && !links.has(id), 'invalid_document', 'Office关联身份缺失或重复。');
    if (attribute(tag, 'TargetMode') === 'External') { links.set(id, { external: true, type }); return; }
    invariant(target && !/[\\:#?%]/.test(target), 'unsafe_document', 'Office内部关联路径无效。');
    const relativePath = target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(owner), target);
    invariant(relativePath && relativePath !== '..' && !relativePath.startsWith('../'), 'unsafe_document', 'Office关联越界。');
    links.set(id, { path: relativePath, type });
  } });
  return links;
}

async function extractOffice(bytes, format) {
  const files = await officeArchive(bytes, format), output = textCollector();
  let hasContent = false, coverage = 'partial';
  const warnings = ['仅提取文档可读正文；图片、图表、嵌入对象和版式不作为已完整识别的证据。'];
  if (format === 'docx') {
    const body = paragraphText(files.get('word/document.xml'));
    hasContent = Boolean(body.trim()); output.add(body);
    const extras = [...files.keys()].filter((name) => /^word\/(?:footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/.test(name)).sort();
    for (const name of extras) {
      const text = paragraphText(files.get(name));
      if (text) { hasContent = true; output.add(`\n\n[附加部件 ${name}]\n${text}`); }
    }
    warnings.push('修订删除内容不计入正文；批注与脚注单独标注，不能推断为最终定稿。');
    const xml = files.get('word/document.xml').toString('utf8');
    coverage = extras.length === 0 && !/<(?:[A-Za-z0-9]+:)?(?:drawing|pict|object|oMath|oMathPara|del|ins|altChunk|fldChar|sym|footnoteReference|endnoteReference)\b/.test(xml)
      && ![...files.keys()].some(name => /^word\/(?:media|embeddings|charts)\//.test(name)) ? 'complete' : 'partial';
  } else if (format === 'pptx') {
    const links = relationshipMap(files.get('ppt/_rels/presentation.xml.rels'), 'ppt/presentation.xml');
    const slideIds = [];
    parseXml(files.get('ppt/presentation.xml'), { open(tag) {
      if (tag.local === 'sldId') slideIds.push(Object.values(tag.attributes).find((a) => a.local === 'id' && a.prefix)?.value);
    } });
    invariant(slideIds.length && slideIds.length <= 500, 'extraction_limit', '演示文稿页数无效或超过限制。');
    for (const [index, id] of slideIds.entries()) {
      const link = links.get(id);
      invariant(link && !link.external && link.type.endsWith('/slide'), 'invalid_document', '幻灯片顺序关联无效。');
      const body = paragraphText(files.get(link.path));
      if (body) hasContent = true;
      output.add(`\n[幻灯片 ${index + 1}]\n${body}`);
      const relPath = path.posix.join(path.posix.dirname(link.path), '_rels', `${path.posix.basename(link.path)}.rels`);
      if (files.has(relPath)) {
        for (const note of relationshipMap(files.get(relPath), link.path).values()) {
          if (note.type.endsWith('/notesSlide')) {
            invariant(!note.external, 'invalid_document', '演讲备注不能引用外部内容。');
            const text = paragraphText(files.get(note.path));
            if (text) { hasContent = true; output.add(`\n[该页演讲备注]\n${text}`); }
          }
        }
      }
    }
  } else {
    invariant(files.has('xl/workbook.xml'), 'invalid_document', '缺少Excel工作簿。');
    const ExcelJS = require('exceljs');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    invariant(book.worksheets.length <= LIMITS.sheets, 'extraction_limit', '工作表数量超过限制。');
    let cells = 0;
    for (const sheet of book.worksheets) {
      output.add(`\n[工作表 ${sheet.name}${sheet.state !== 'visible' ? '（隐藏）' : ''}]\n`);
      sheet.eachRow((row) => row.eachCell((cell) => {
        invariant(++cells <= LIMITS.cells, 'extraction_limit', '非空单元格超过限制。');
        let text = cell.text;
        if (cell.value instanceof Date) text = cell.value.toISOString();
        if (cell.value && typeof cell.value === 'object' && ('formula' in cell.value || 'sharedFormula' in cell.value)) {
          const result = cell.value.result;
          text = `[公式未重算；缓存结果：${result == null ? '无' : result instanceof Date ? result.toISOString() : typeof result === 'object' ? JSON.stringify(result) : String(result)}]`;
        }
        if (String(text).trim()) hasContent = true;
        output.add(`${cell.address}: ${text}\n`);
      }));
    }
    warnings.push('公式不执行，缓存结果可能过期；隐藏表已明确标注，超链接不抓取外部内容。');
  }
  invariant(hasContent, 'empty_source', 'Office文档没有可提取正文；可能仅含图片，不能标记已消化。');
  return { text: output.value(), warnings, coverage };
}

async function extractDocument({ input, format }) {
  const handle = await fs.open(input.path, 'r');
  let bytes;
  try {
    const stat = await handle.stat();
    invariant(stat.isFile() && stat.size <= LIMITS.input && stat.size === input.size, 'input_limit', '资料大小变化或超过单次提取限制。');
    bytes = await handle.readFile();
  } finally { await handle.close(); }
  invariant(bytes.length <= LIMITS.input && crypto.createHash('sha256').update(bytes).digest('hex') === input.sha256,
    'source_changed', '提取的固定版本字节校验失败。');
  let result;
  if (TEXT_FORMATS.has(format)) {
    const text = decodeText(bytes).trim();
    invariant(!text.includes('\u0000'), 'unsupported_encoding', '文本包含二进制空字符，需要正确的解码器。');
    result = { text, warnings: [] };
  }
  else if (['docx', 'pptx', 'xlsx'].includes(format)) result = await extractOffice(bytes, format);
  else throw new MaterialError('unsupported', '此格式暂不支持自动文本提取，原文仍已保存。');
  invariant(result.text.trim(), 'empty_source', '未提取到有效正文，不能标记消化完成。');
  invariant(Buffer.byteLength(result.text) <= LIMITS.text, 'extraction_limit', '提取正文过长，需要分段处理。');
  return { ...result, format };
}

if (parentPort && workerData?.kind === 'project-material-extract') {
  extractDocument(workerData).then((result) => parentPort.postMessage({ ok: true, result }),
    (error) => parentPort.postMessage({ ok: false, error: { code: error.code || 'extraction_failed', message: error.message } }));
}
module.exports = { extractDocument, officeArchive, parseXml, LIMITS, TEXT_FORMATS };
