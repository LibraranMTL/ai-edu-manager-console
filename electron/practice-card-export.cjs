'use strict';
const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function practiceCardHtml(card) {
  if (!card?.id || !card.content?.prompt || !['ready', 'started', 'completed'].includes(card.status)) throw Error('没有可导出的审核通过卡片');
  const c = card.content;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(c.title)}</title><style>
  @page{size:A4;margin:15mm}*{box-sizing:border-box}body{margin:0;background:white;color:#172b37;font-family:'Microsoft YaHei',sans-serif;line-height:1.7}.page{padding:28px;max-width:100%;background:white}h1{font-size:28px;line-height:1.4;margin:10px 0}h2{font-size:18px;margin:24px 0 8px}.meta{color:#53666c;font-size:14px}.prompt{white-space:pre-wrap;overflow-wrap:anywhere;font-size:19px}.box{border:1px solid #bdc9cb;padding:18px;border-radius:12px;break-inside:avoid}.writing{height:180px;background:repeating-linear-gradient(white,white 35px,#d9e0e1 36px);border:1px solid #d9e0e1;margin:18px 0}.foot{font-size:12px;color:#607379;margin-top:25px}p{overflow-wrap:anywhere}@media print{.page{padding:0}}</style></head><body><main class="page"><div class="meta">AI教育管家 · 每天10分钟提分卡</div><h1>${escape(c.title)}</h1><p class="meta">${escape(c.subject)} · ${escape(c.knowledgePoint)} · ${escape(c.minutes)} 分钟</p><p>为什么练：${escape(c.rationale)}</p><h2>练习题目</h2><section class="box prompt">${escape(c.prompt)}</section><h2>我的作答</h2><div class="writing"></div><p class="foot">分享／打印版不含学生身份、来源路径、参考答案或已提交作答。卡片经过内容复核，练习结果仍待人工核验，不等于稳定掌握。</p></main></body></html>`;
}
async function renderPracticeCard({ card, format, BrowserWindow, dialog, parent, tempRoot }) {
  const fs = require('node:fs/promises'), path = require('node:path');
  if (!['png','pdf','print'].includes(format)) throw Error('不支持的卡片导出格式');
  const dir = await fs.mkdtemp(path.join(tempRoot, 'edu-card-export-'));
  const source = path.join(dir, 'card.html'); let window;
  try {
    await fs.writeFile(source, practiceCardHtml(card), { flag: 'wx', mode: 0o600 });
    window = new BrowserWindow({ show: false, width: 1080, height: 1500, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    await window.loadFile(source);
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    if (format === 'print') return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('等待系统打印对话框超时；请检查打印队列')), 120000);
      window.webContents.print({ silent: false, printBackground: true }, (success, reason) => { clearTimeout(timer); success ? resolve({ printed: true }) : /cancel/i.test(reason || '') ? resolve({ cancelled: true }) : reject(Error(reason || '打印未完成')); });
    });
    const choice = await dialog.showSaveDialog(parent, { title: format === 'png' ? '保存卡片分享图片' : '保存卡片 PDF', defaultPath: `学习卡片-${card.id.slice(0,8)}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (choice.canceled || !choice.filePath) return { cancelled: true };
    let bytes;
    if (format === 'pdf') bytes = await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
    else {
      const height = await window.webContents.executeJavaScript('Math.ceil(document.querySelector(".page").getBoundingClientRect().height)');
      if (height > 12000) throw Error('卡片过长，请导出分页 PDF');
      window.setContentSize(1080, Math.max(400,height));
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      bytes = (await window.webContents.capturePage()).toPNG();
    }
    await fs.writeFile(choice.filePath, bytes);
    return { path: choice.filePath, format };
  } finally { if (window && !window.isDestroyed()) window.destroy(); await fs.unlink(source).catch(() => {}); await fs.rmdir(dir).catch(() => {}); }
}
module.exports = { practiceCardHtml, renderPracticeCard };
