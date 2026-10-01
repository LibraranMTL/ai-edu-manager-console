import React, { useEffect, useState } from 'react';
type Mode = 'cloud' | 'local';
type Profile = { baseUrl: string; model: string; language: string; hasApiKey: boolean };
type State = { mode: Mode; profiles: Record<Mode, Profile> };
export type AudioApi = { getAudioTranscriptionSettings?: () => Promise<string>; saveAudioTranscriptionSettings?: (input: unknown) => Promise<string>; testAudioTranscription?: () => Promise<string>; transcribeCaptureAudio?: (id: string, itemId: string, consent: boolean) => Promise<string> };
async function result<T>(value?: Promise<string>): Promise<T> { if (!value) throw Error('转写配置需要 Windows 主机'); const parsed = JSON.parse(await value); if (!parsed.ok) throw Error(parsed.message); return parsed.data; }
export function AudioTranscriptionSettings({ api, onMode }: { api?: AudioApi; onMode: (mode: Mode) => void }) {
  const [state, setState] = useState<State | null>(null), [mode, setMode] = useState<Mode>('local');
  const [profile, setProfile] = useState<Profile>({ baseUrl: '', model: '', language: 'zh', hasApiKey: false });
  const [apiKey, setApiKey] = useState(''), [clearApiKey, setClearApiKey] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { let active = true; void result<State>(api?.getAudioTranscriptionSettings?.()).then(value => { if (!active) return; setState(value); setMode(value.mode); setProfile(value.profiles[value.mode]); onMode(value.mode); }).catch(error => { if (active) setMessage(error.message); }); return () => { active = false; }; }, [api, onMode]);
  async function run(work: () => Promise<void>) { setBusy(true); try { await work(); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } }
  return <details className="cloud-setup" open><summary>录音转写引擎接入配置</summary>
    <p>支持 OpenAI 兼容音频转写接口。云端使用 HTTPS；本地需先启动兼容 ASR 服务，不会自动下载模型或执行安装脚本。</p>
    <div className="field-grid">
      <label>引擎位置<select disabled={busy || !state} value={mode} onChange={event => { const next = event.target.value as Mode; setMode(next); setProfile(state!.profiles[next]); setApiKey(''); setClearApiKey(false); setMessage('尚未保存；转写与测试使用最后保存的配置。'); }}><option value="local">本地引擎</option><option value="cloud">云端引擎</option></select></label>
      <label>服务基础地址<input disabled={busy || !state} value={profile.baseUrl} onChange={event => setProfile(current => ({ ...current, baseUrl: event.target.value }))} placeholder={mode === 'local' ? 'http://127.0.0.1:8000/v1' : 'https://服务地址/v1'} /></label>
      <label>转写模型<input disabled={busy || !state} value={profile.model} onChange={event => setProfile(current => ({ ...current, model: event.target.value }))} /></label>
      <label>语言代码（留空自动识别）<input disabled={busy || !state} value={profile.language} onChange={event => setProfile(current => ({ ...current, language: event.target.value }))} placeholder="zh / en" /></label>
      <label>API 密钥<input type="password" autoComplete="off" disabled={busy || !state} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={profile.hasApiKey ? '已有密钥；留空保留' : mode === 'local' ? '本地无认证服务可留空' : '填写云端服务密钥（若需要认证）'} /></label>
      <label className="student-checkbox"><input type="checkbox" disabled={busy || !state} checked={clearApiKey} onChange={event => setClearApiKey(event.target.checked)} />清除当前引擎密钥</label>
    </div>
    <div className="actions compact-actions">
      <button className="primary" disabled={busy || !state} onClick={() => void run(async () => { const value = await result<State>(api?.saveAudioTranscriptionSettings?.({ mode, ...profile, apiKey, clearApiKey })); setState(value); setProfile(value.profiles[value.mode]); onMode(value.mode); setApiKey(''); setClearApiKey(false); setMessage('配置已保存；保存不代表连接或转写成功。'); })}>保存转写配置</button>
      <button className="secondary" disabled={busy || !state} onClick={() => void run(async () => { const value = await result<{ message: string }>(api?.testAudioTranscription?.()); setMessage(value.message); })}>测试已保存配置（不发音频）</button>
    </div>
    <p>密钥仅加密保存在主机端，不回传页面。云端转写可能收费，每次发送须另行授权；转写文本需人工校核。</p>
    {message && <p role="status">{message}</p>}
  </details>;
}
