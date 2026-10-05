import React from 'react';
import labels from '../electron/practice-language-labels.json';
export type PracticeLanguageProfile = { primaryLanguage: '' | 'zh-CN' | 'en'; supportLanguage: '' | 'zh-CN' | 'en' };
export type PracticeLanguagePolicy = { version: number; instructionLanguage: 'zh-CN' | 'en'; supportLanguage: 'zh-CN' | 'en' | null; targetLanguage: 'zh-CN' | 'en' | null; resolvedFrom: string; fingerprint: string };
export const practiceLabels = labels;
export function PracticeLanguageFields({ value, onChange }: { value?: PracticeLanguageProfile; onChange: (value: PracticeLanguageProfile) => void }) {
  const primary = value?.primaryLanguage || '', support = value?.supportLanguage || '';
  return <fieldset className="wide planning-route-fieldset"><legend>学习语言（可选）</legend><div className="field-grid">
    <label>主要学习语言<select value={primary} onChange={event => {
      const next = event.target.value as PracticeLanguageProfile['primaryLanguage'];
      onChange({ primaryLanguage: next, supportLanguage: !next || support === next ? '' : support });
    }}><option value="">沿用已确认卡片语言（首次为简体中文）</option>{Object.entries(labels).map(([code, entry]) => <option key={code} value={code}>{entry.name}</option>)}</select></label>
    <label>辅助解释语言<select value={support === primary ? '' : support} disabled={!primary} onChange={event => onChange({ primaryLanguage: primary, supportLanguage: event.target.value as PracticeLanguageProfile['supportLanguage'] })}><option value="">无需辅助</option>{Object.entries(labels).filter(([code]) => code !== primary).map(([code, entry]) => <option key={code} value={code}>{entry.name}</option>)}</select></label>
  </div><p className="inline-hint">保存后卡片自动沿用。语言科目保留练习目标语言；辅助语言只用于简短关键词、提示和解析。已开始的卡片保持原语言。</p></fieldset>;
}
