'use strict';
const fs = require('node:fs/promises');
const { hash, scopedFile } = require('./practice-files.cjs');
const { runDocumentWorker, runImageOcr, acquireExtractionSlot, EXTRACTOR_VERSION } = require('./project-material-extract.cjs');
const { runPdfWorker } = require('./project-material-pdf.cjs');
async function extractPracticeAnswer({ root, studentId, attachment, path, language, signal }) {
  const key = hash([studentId, attachment.sha256, attachment.extension, EXTRACTOR_VERSION, language, 'practice.v2-language-fallback']);
  const file = await scopedFile(root, 'extraction-cache', `${key}.json`, true);
  try { const cached = JSON.parse(await fs.readFile(file, 'utf8')); if (cached.key === key && hash(cached.result) === cached.hash) return cached.result; }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  const release = await acquireExtractionSlot(signal);
  try {
    const input = { path, size: attachment.bytes, sha256: attachment.sha256 }, format = attachment.extension.slice(1);
    const result = format === 'pdf' ? await runPdfWorker(input, { signal, imageRunner: runImageOcr, language })
      : ['png','jpg','jpeg'].includes(format) ? await runImageOcr(input, { signal, language })
        : await runDocumentWorker(input, format, { signal });
    if (typeof result.text !== 'string' || result.text.length > 60000) throw Error('作答正文超过评阅限制，请分段提交');
    // Existing parsers surface images/formula/OCR limitations. These are not
    // erased to make the job look successful; uncertain extraction stays draft.
    const complete = result.text.trim() && (result.coverage === 'complete' || !(result.warnings || []).length
      || (format === 'pdf' && result.pages?.length && result.pages.every(page => page.method === 'embedded' || page.method === 'blank')));
    const text = format === 'pdf' ? result.text.replace(/^\[PDF 第\d+页；(?:embedded|blank)\]\s*$/gm,'').trim() : result.text;
    const checked = { text, warnings: result.warnings || [], quality: complete ? 'complete' : 'partial', extractorVersion: EXTRACTOR_VERSION };
    try { await fs.writeFile(file, JSON.stringify({ key, hash: hash(checked), result: checked }), { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    return checked;
  } finally { release(); }
}
module.exports = { extractPracticeAnswer };
