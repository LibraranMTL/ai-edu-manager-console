import React, { useEffect, useRef, useState } from 'react';
import { PracticeRichText } from './PracticeRichText';
export function PracticeFilePreview({ file, payload, previewDocx }: { file?: File; payload?: { base64?: string; extension?: string; text?: string; warnings?: string[] }; previewDocx?: (file: File)=>Promise<any> }) {
  const [url, setUrl] = useState(''), [text, setText] = useState(''), [error, setError] = useState(''), [page, setPage] = useState(1), [pages, setPages] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null), document = useRef<any>(null);
  const extension = file ? '.' + file.name.split('.').at(-1)?.toLowerCase() : payload?.extension || '';
  useEffect(() => {
    let active = true, objectUrl = '', task: any; setPage(1); setPages(0); setError(''); setText(''); setUrl('');
    void (async () => {
      if (payload?.text !== undefined) { if (active) setText(payload.text); return; }
      if (file && extension === '.docx' && previewDocx) {const result=await previewDocx(file);if(active)setText(result.text);return;}
      const bytes = file ? new Uint8Array(await file.arrayBuffer()) : Uint8Array.from(atob(payload?.base64 || ''), c => c.charCodeAt(0));
      if (!active) return;
      if (extension === '.pdf') {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url'); pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        if (!active) return;
        task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false });
        const result = await task.promise; if (!active) { await result.destroy(); return; }
        document.current = result; setPages(result.numPages);
      } else if (['.png','.jpg','.jpeg'].includes(extension)) {
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: extension === '.png' ? 'image/png' : 'image/jpeg' })); setUrl(objectUrl);
      } else if (extension !== '.docx') setText(new TextDecoder('utf-8').decode(bytes));
    })().catch(e => { if (active) setError(e.message || '预览不可用，请另存原件查看'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); task?.destroy(); document.current = null; };
  }, [file, payload]);
  useEffect(() => {
    if (!document.current || !canvas.current) return;
    let active = true, task: any;
    void document.current.getPage(page).then((pdfPage: any) => {
      if (!active || !canvas.current) return;
      const raw = pdfPage.getViewport({ scale: 1 }), viewport = pdfPage.getViewport({ scale: Math.min(1.5, 900 / raw.width) });
      canvas.current.width = viewport.width; canvas.current.height = viewport.height;
      task = pdfPage.render({ canvasContext: canvas.current.getContext('2d'), viewport }); return task.promise;
    }).catch((e: any) => { if (active && e.name !== 'RenderingCancelledException') setError('本页无法预览，可另存原件查看。'); });
    return () => { active = false; task?.cancel(); };
  }, [page, pages]);
  return <div className="pc-file-preview">{url && <img src={url} alt="作答文件预览" />}{text && <PracticeRichText value={text} />}
    {extension === '.pdf' && <><div className="pc-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>{page} / {pages || '…'}</span><button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>下一页</button></div><canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} /></>}
    {extension === '.docx' && <p className="muted">{text?'正文只读预览；图片、图表与复杂公式请以原件为准。':previewDocx?'正在本机提取正文预览…':'文档预览不可用，可另存原件查看。'}</p>}
    {!!payload?.warnings?.length && <p className="muted">{payload.warnings.join('；')}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
