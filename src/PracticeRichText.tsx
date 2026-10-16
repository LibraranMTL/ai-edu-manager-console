import React, { memo } from 'react';
import 'katex/dist/katex.min.css';
import { renderPracticeMarkdown, practiceRichCss } from '../electron/practice-rich-text.mjs';
export const PracticeRichText = memo(function PracticeRichText({ value }: { value?: string }) {
  return <><style>{practiceRichCss}</style><div className="card-rich" dangerouslySetInnerHTML={{ __html: renderPracticeMarkdown(value || '') }} />{(value?.length||0)>60000&&<p className="muted">正文较长，当前仅预览前 60,000 字符；完整内容请另存原件查看。</p>}</>;
});
