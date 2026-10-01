const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { parentPort, workerData } = require('node:worker_threads');
const { MaterialError, invariant } = require('./project-material-contract.cjs');

const PDF_LIMITS = Object.freeze({ pages: 200, text: 2 * 1024 * 1024, imagePixels: 16000000,
  renderEdge: 2400, input: 32 * 1024 * 1024 });

function runtimePaths(runtimeRoot) {
  if (runtimeRoot) {
    invariant(path.isAbsolute(runtimeRoot), 'pdf_runtime_missing', 'PDF运行时路径无效。');
    return { pdf: path.join(runtimeRoot, 'pdfjs'), canvas: path.join(runtimeRoot, 'canvas') };
  }
  return { pdf: path.dirname(require.resolve('pdfjs-dist/package.json')), canvas: require.resolve('@napi-rs/canvas') };
}

async function extractPdf({ input, runtimeRoot, limits = PDF_LIMITS }, recognizePage) {
  const source = await fs.open(input.path, 'r');
  let bytes;
  try {
    const stat = await source.stat();
    invariant(stat.isFile() && stat.size === input.size && stat.size <= limits.input, 'input_limit', 'PDF大小变化或超过限制。');
    bytes = await source.readFile();
  } finally { await source.close(); }
  invariant(bytes.length <= limits.input && crypto.createHash('sha256').update(bytes).digest('hex') === input.sha256,
    'source_changed', 'PDF固定版本校验失败。');
  const runtime = runtimePaths(runtimeRoot);
  // Explicit imports and local asset factories. Document URLs, launch actions,
  // embedded JavaScript and remote fonts are never opened/executed.
  const canvasApi = require(runtime.canvas);
  // PDF.js normally discovers these through Node's package resolver. The
  // release runtime is deliberately isolated from node_modules so seed the
  // two required geometry globals from the exact audited canvas copy before
  // importing PDF.js. Rendering itself still uses BoundedCanvasFactory below.
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = canvasApi.DOMMatrix;
  if (!globalThis.Path2D) globalThis.Path2D = canvasApi.Path2D;
  const pdfjs = await import(pathToFileURL(path.join(runtime.pdf, 'legacy', 'build', 'pdf.mjs')).href);
  class BoundedCanvasFactory {
    create(width, height) {
      invariant(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        && width * height <= limits.imagePixels, 'extraction_limit', 'PDF画布容量超过限制。');
      const canvas = canvasApi.createCanvas(Math.ceil(width), Math.ceil(height));
      return { canvas, context: canvas.getContext('2d') };
    }
    reset(holder, width, height) { const next = this.create(width, height); this.destroy(holder); Object.assign(holder, next); }
    destroy(holder) { if (holder.canvas) { holder.canvas.width = 1; holder.canvas.height = 1; } holder.canvas = null; holder.context = null; }
  }
  class LocalBinaryFactory {
    async fetch({ kind, filename }) {
      const folder = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' }[kind];
      invariant(folder && typeof filename === 'string' && /^[A-Za-z0-9_.-]+$/.test(filename)
        && filename !== '.' && filename !== '..', 'unsafe_document', 'PDF请求了不允许的外部资源。');
      return new Uint8Array(await fs.readFile(path.join(runtime.pdf, folder, filename)));
    }
  }
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), stopAtErrors: true,
    maxImageSize: limits.imagePixels, useWorkerFetch: false, useSystemFonts: false,
    enableXfa: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    CanvasFactory: BoundedCanvasFactory, BinaryDataFactory: LocalBinaryFactory,
    cMapUrl: `${pathToFileURL(path.join(runtime.pdf, 'cmaps')).href}/`, cMapPacked: true,
    standardFontDataUrl: `${pathToFileURL(path.join(runtime.pdf, 'standard_fonts')).href}/`,
    wasmUrl: `${pathToFileURL(path.join(runtime.pdf, 'wasm')).href}/`, verbosity: 0 });
  try {
    const document = await loading.promise;
    invariant(!document.isPureXfa, 'unsupported', '动态XFA表单尚不支持自动消化。');
    invariant(document.numPages > 0 && document.numPages <= limits.pages, 'extraction_limit', 'PDF页数超过单次处理限制，请拆分资料。');
    const imageOps = new Set(Object.entries(pdfjs.OPS).filter(([name]) => /paint.*Image/.test(name)).map(([, value]) => value));
    const chunks = [], pages = []; let textBytes = 0, hasContent = false;
    function add(text) {
      textBytes += Buffer.byteLength(text);
      invariant(textBytes <= limits.text, 'extraction_limit', 'PDF提取正文超过限制，未截断为成功。');
      chunks.push(text);
    }
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        let embedded = '', embeddedBytes = 0;
        for (const item of content.items) {
          if (typeof item.str !== 'string') continue;
          const part = `${item.str}${item.hasEOL ? '\n' : ' '}`;
          embeddedBytes += Buffer.byteLength(part);
          invariant(embeddedBytes <= limits.text, 'extraction_limit', 'PDF单页正文超过限制。');
          embedded += part;
        }
        embedded = embedded.trim();
        // Inspect image-bearing pages even when a header has embedded text.
        // Otherwise hybrid scanned PDFs would silently lose their main body.
        const operators = await page.getOperatorList();
        const hasImages = operators.fnArray.some((op) => imageOps.has(op));
        let recognized = '', method = 'embedded', blank = false;
        if (!embedded || hasImages) {
          const natural = page.getViewport({ scale: 1 });
          invariant(natural.width > 0 && natural.height > 0 && Number.isFinite(natural.width + natural.height), 'invalid_document', 'PDF页面尺寸无效。');
          const scale = Math.min(2, limits.renderEdge / Math.max(natural.width, natural.height));
          const viewport = page.getViewport({ scale });
          const factory = new BoundedCanvasFactory(), holder = factory.create(viewport.width, viewport.height);
          try {
            await page.render({ canvasContext: holder.context, viewport, background: 'rgb(255,255,255)' }).promise;
            const pixels = holder.context.getImageData(0, 0, holder.canvas.width, holder.canvas.height).data;
            blank = true;
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) { blank = false; break; }
            }
            if (!blank) {
              const png = await holder.canvas.encode('png');
              invariant(png.length <= 16 * 1024 * 1024, 'extraction_limit', 'PDF页面预览超过容量限制。');
              recognized = String(await recognizePage({ pageNumber, png })).trim();
              invariant(recognized, 'pdf_ocr_empty', `PDF第${pageNumber}页有可见内容但未识别出文字，需要复核或视觉处理。`);
            }
          } finally { factory.destroy(holder); }
          method = blank ? 'blank' : embedded ? 'embedded+ocr' : 'ocr';
        }
        if (embedded || recognized) hasContent = true;
        add(`\n[PDF 第${pageNumber}页；${method}]\n`);
        if (embedded) add(`${embedded}\n`);
        if (recognized && recognized.replace(/\s/g, '') !== embedded.replace(/\s/g, '')) add(`[页面OCR，可能与嵌入正文重叠]\n${recognized}\n`);
        pages.push({ pageNumber, method, textBytes: Buffer.byteLength(embedded) + Buffer.byteLength(recognized) });
      } finally { page.cleanup(); }
    }
    invariant(hasContent, 'empty_source', 'PDF没有可消化正文。');
    return { format: 'pdf', text: chunks.join('').trim(), pages,
      warnings: ['PDF按页提取；扫描/混合页使用OCR，可能误识别，图表、版式和阅读顺序仍需结合原页复核。',
        '页面OCR和嵌入正文分别标注；重叠内容不是两份独立证据。表单动作、脚本、附件和外部链接均未执行。'] };
  } catch (error) {
    if (error.name === 'PasswordException') throw new MaterialError('unsupported_encryption', 'PDF需要密码，请先提供已解密的可读副本。');
    if (error instanceof MaterialError) throw error;
    if (/maximum allowed size/.test(error.message)) throw new MaterialError('extraction_limit', 'PDF包含超过安全像素限制的图像，未跳过内容后冒充成功。');
    throw new MaterialError('invalid_document', 'PDF解析或渲染失败，不能以部分正文标记完成。', { diagnostic: error.message });
  } finally { await loading.destroy(); }
}

if (parentPort && workerData?.kind === 'project-material-pdf') {
  const recognize = ({ pageNumber, png }) => new Promise((resolve, reject) => {
    parentPort.once('message', (message) => {
      if (message?.type !== 'ocr-result' || message.pageNumber !== pageNumber) { reject(new MaterialError('invalid_extraction', '页面OCR回执不匹配。')); return; }
      if (message.error) reject(new MaterialError(message.error.code, message.error.message)); else resolve(message.text);
    });
    parentPort.postMessage({ type: 'ocr-page', pageNumber, png });
  });
  extractPdf(workerData, recognize).then((result) => parentPort.postMessage({ ok: true, result }),
    (error) => parentPort.postMessage({ ok: false, error: { code: error.code || 'extraction_failed', message: error.message } }));
}
module.exports = { extractPdf, PDF_LIMITS };
