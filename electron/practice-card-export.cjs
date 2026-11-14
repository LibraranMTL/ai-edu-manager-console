'use strict';
const labels = require('./practice-language-labels.json');
const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function legacyPracticeCardHtml(card) {
  if (!card?.id || !card.content?.prompt || !['ready', 'started', 'completed', 'superseded'].includes(card.status)) throw Error('没有可导出的审核通过卡片');
  const c = card.content;
  const language = card.languagePolicy?.instructionLanguage || 'zh-CN';
  const text = labels[language];
  if (!text) throw Error('当前导出尚不支持该卡片语言');
  const targetLanguage = ['en', 'zh-CN'].includes(card.languagePolicy?.targetLanguage) ? card.languagePolicy.targetLanguage : language;
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(c.title)}</title><style>
  @page{size:A4;margin:15mm}*{box-sizing:border-box}body{margin:0;background:white;color:#172b37;font-family:'Segoe UI','Microsoft YaHei','Noto Sans',sans-serif;line-height:1.7}.page{padding:28px;max-width:100%;background:white}h1{font-size:28px;line-height:1.4;margin:10px 0}h2{font-size:18px;margin:24px 0 8px}.meta{color:#53666c;font-size:14px}.prompt{white-space:pre-wrap;overflow-wrap:anywhere;font-size:19px}.box{border:1px solid #bdc9cb;padding:18px;border-radius:12px;break-inside:avoid}.writing{height:180px;background:repeating-linear-gradient(white,white 35px,#d9e0e1 36px);border:1px solid #d9e0e1;margin:18px 0}.foot{font-size:12px;color:#607379;margin-top:25px}p{overflow-wrap:anywhere}@media print{.page{padding:0}}</style></head><body><main class="page"><div class="meta">${escape(text.brand)}</div><h1>${escape(c.title)}</h1><p class="meta">${escape(text.subjects[c.subject] || c.subject)} · ${escape(c.knowledgePoint)} · ${escape(c.minutes)} ${escape(text.minutes)}</p><h2>${escape(text.prompt)}</h2><section class="box prompt" lang="${targetLanguage}">${escape(c.prompt)}</section><h2>${escape(text.writing)}</h2><div class="writing"></div><p class="foot">${escape(text.footer)}</p></main></body></html>`;
}
let mathCss;
function practiceCardHtml(card) {
  const { renderPracticeMarkdown, practiceRichCss } = require('./practice-rich-text.mjs');
  if (!mathCss) {
    const fs = require('node:fs'), path = require('node:path');
    const stagedCss = path.join(__dirname, 'practice-katex', 'katex.min.css');
    const cssFile = fs.existsSync(stagedCss) ? stagedCss : require.resolve('katex/dist/katex.min.css');
    mathCss = fs.readFileSync(cssFile, 'utf8').replace(/url\(([^)]+)\)/g, (all, url) => {
      const relative = url.replace(/["']/g, '');
      if (!/^fonts\/KaTeX_[A-Za-z0-9_-]+\.(woff2?|ttf)$/.test(relative)) return 'url()';
      const mime = relative.endsWith('.woff2') ? 'font/woff2' : relative.endsWith('.woff') ? 'font/woff' : 'font/ttf';
      return `url(data:${mime};base64,${fs.readFileSync(path.join(path.dirname(cssFile), relative)).toString('base64')})`;
    });
  }
  let html = legacyPracticeCardHtml(card).replace("style-src 'unsafe-inline'", "style-src 'unsafe-inline'; font-src data:")
    .replace('</head>', `<style>${mathCss}\n${practiceRichCss}\n.prompt{white-space:normal}@media print{.box{break-inside:auto}.card-table-scroll,.card-rich pre{overflow:visible}.card-rich table{table-layout:fixed}.card-rich thead{display:table-header-group}.card-rich pre{white-space:pre-wrap}.card-rich td,.card-rich th{overflow-wrap:anywhere}}</style></head>`)
    .replace(`>${escape(card.content.prompt)}</section>`, `><div class="card-rich">${renderPracticeMarkdown(card.content.prompt)}</div></section>`);
  if (card.purpose === 'knowledge') html=html.replace(/<h2>[^<]*<\/h2><div class="writing"><\/div>/,'');
  const themes={clear:'',warm:'.page{background:#fff9ed}.box{border-color:#d5b982}h1{color:#7d481c}',mono:'.page{color:#111}.box{border-color:#111}.meta,.foot{color:#333}'};
  const layout=card.layout||{},font=[16,18,20].includes(layout.fontSize)?layout.fontSize:18,accent=/^#[0-9a-f]{6}$/i.test(layout.accent||'')?layout.accent:'#173343';
  return html.replace('</head>',`<style>${themes[card.template]||''}.prompt{font-size:${font}px}h1{color:${card.template==='mono'?'#111':accent}}.writing{break-inside:avoid}.foot{break-before:avoid}@page{size:${layout.paper==='Letter'?'Letter':'A4'} ${layout.orientation==='landscape'?'landscape':'portrait'};margin:15mm}${layout.orientation==='landscape'?'@media print{.writing{height:120px;margin:12px 0}.foot{margin-top:12px}h2{margin-top:14px}}':''}</style></head>`);
}
async function renderPracticeCard({ card, format, BrowserWindow, dialog, parent, tempRoot, htmlOverride, printServices, assertScope = () => {} }) {
  const fs = require('node:fs/promises'), path = require('node:path');
  if (!['png','pdf','print'].includes(format)) throw Error('不支持的卡片导出格式');
  const dir = await fs.mkdtemp(path.join(tempRoot, 'edu-card-export-'));
  const source = path.join(dir, 'card.html'); let window;
  try {
    window = new BrowserWindow({ show: false, ...(parent && !parent.isDestroyed() ? {parent} : {}), title: '学习卡片 · 打印', width: format==='print'?920:card.layout?.orientation==='landscape'?1480:1080, height: format==='print'?700:card.layout?.orientation==='landscape'?1080:1500, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, ...(format==='print'?{preload:path.join(__dirname,'practice-print-preload.cjs')}:{}) } });
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    window.webContents.on('will-navigate', event => event.preventDefault());
    if(format==='print') {
      window.show();window.focus();
      await waitForWindow(window,window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"></head><body><h2>正在准备学习卡片…</h2><p>正在排版卡片与公式。准备完成后可选择打印机，也可以保存 PDF。</p></body></html>')),15000);
    }
    const html=await waitForWindow(window,Promise.resolve().then(()=>typeof htmlOverride==='function'?htmlOverride():htmlOverride||practiceCardHtml(card)),70000);
    await fs.writeFile(source,html,{flag:'wx',mode:0o600});
    await waitForWindow(window,window.loadFile(source),30000);
    await waitForWindow(window,window.webContents.executeJavaScript('Promise.all([document.fonts.ready,...Array.from(document.images,image=>image.decode())])'),15000);
    assertScope();
    if (format === 'print') {
      const services = {...(printServices || require('electron')),dialog,assertScope};
      if (typeof services.createSubmitPrint === 'function') services.submitPrint = services.createSubmitPrint(source);
      return await require('./practice-print-window.cjs').printWithControls(window, card, services);
    }
    const choice = await dialog.showSaveDialog(parent, { title: format === 'png' ? '保存卡片分享图片' : '保存卡片 PDF', defaultPath: `${labels[card.languagePolicy?.instructionLanguage || 'zh-CN'].download}-${card.id.slice(0,8)}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (choice.canceled || !choice.filePath) return { cancelled: true };
    assertScope();
    let bytes;
    if (format === 'pdf') bytes = await window.webContents.printToPDF({ printBackground: true, pageSize: card.layout?.paper==='Letter'?'Letter':'A4', landscape:card.layout?.orientation==='landscape', preferCSSPageSize: true });
    else {
      const height = await window.webContents.executeJavaScript('Math.ceil(document.querySelector(".page").getBoundingClientRect().height)');
      if (height > 12000) throw Error('卡片过长，请导出分页 PDF');
      window.setContentSize(card.layout?.orientation==='landscape'?1480:1080, Math.max(400,height));
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      bytes = (await window.webContents.capturePage()).toPNG();
    }
    assertScope();await fs.writeFile(choice.filePath, bytes);
    return { path: choice.filePath, format };
  } catch(error) { if(error.code==='PREVIEW_CLOSED')return {cancelled:true};throw error;
  } finally { if (window && !window.isDestroyed()) window.destroy(); await fs.unlink(source).catch(() => {}); await fs.rmdir(dir).catch(() => {}); }
}
function waitForWindow(window,promise,timeout) {
  return new Promise((resolve,reject)=>{
    let timer;
    const finish=(error,value)=>{clearTimeout(timer);window.removeListener('closed',closed);error?reject(error):resolve(value);};
    const closed=()=>finish(Object.assign(Error('打印预览已关闭'),{code:'PREVIEW_CLOSED'}));
    if(window.isDestroyed()){closed();return;}
    window.once('closed',closed);
    timer=setTimeout(()=>finish(Error('卡片准备超时，请重试或另存原文件后打印。')),timeout);
    Promise.resolve(promise).then(value=>finish(null,value),error=>finish(error));
  });
}
module.exports = { practiceCardHtml, renderPracticeCard };
