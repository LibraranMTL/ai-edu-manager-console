'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const str = { type: 'string' };
const CONTENT_SCHEMA = { type: 'object', additionalProperties: false, required: ['title', 'subject', 'knowledgePoint', 'rationale', 'minutes', 'sourceRefs', 'prompt', 'hint', 'answer', 'explanation'], properties: {
  title: str, subject: str, knowledgePoint: str, rationale: str, minutes: { type: 'integer' }, sourceRefs: { type: 'array', items: str }, prompt: str, hint: str, answer: str, explanation: str,
} };
const REVIEW_SCHEMA = { type: 'object', additionalProperties: false, required: ['passed', 'reason'], properties: { passed: { type: 'boolean' }, reason: str } };
const subjects = ['自动', '数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理'];
const date = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function checkedPlan(input, previous = {}) {
  if (!subjects.includes(input.subject) || !['today', 'week', 'month', 'auto'].includes(input.range) || !Number.isInteger(input.minutes) || input.minutes < 5 || input.minutes > 15 ||
      !['clear', 'warm', 'mono'].includes(input.template) || typeof input.focus !== 'string' || input.focus.length > 200) throw Error('练习计划格式无效');
  const value = { subject: input.subject, range: input.range, minutes: input.minutes, template: input.template, focus: input.focus.trim(), autoEnabled: input.autoEnabled === true };
  return { ...value, revision: digest(value) === digest(Object.fromEntries(Object.keys(value).map(key => [key, previous[key]]))) ? previous.revision : Number(previous.revision || 0) + 1 };
}
function checkedContent(value, evidence) {
  for (const field of ['title', 'subject', 'knowledgePoint', 'rationale', 'prompt', 'answer', 'explanation']) if (typeof value?.[field] !== 'string' || !value[field].trim() || value[field].length > 5000) throw Error(`卡片 ${field} 无效`);
  if (typeof value.hint !== 'string' || value.hint.length > 1000 || !Number.isInteger(value.minutes) || value.minutes < 5 || value.minutes > 15 || !Array.isArray(value.sourceRefs) || !value.sourceRefs.length || value.sourceRefs.length > 10 || value.sourceRefs.some(ref => !evidence.some(item => item.ref === ref))) throw Error('卡片时长或引用依据无效');
  return Object.fromEntries(Object.keys(CONTENT_SCHEMA.properties).map(key => [key, value[key]]));
}
function publicCard(card) {
  if (!card) return null;
  const { answer, explanation, ...content } = card.content;
  return { ...card, content: card.status === 'completed' ? card.content : content };
}
function createPracticeCards({ resolveStudentDir, snapshot, generate, now = () => new Date() }) {
  const queues = new Map(), pending = new Map();
  async function load(id) {
    const root = path.join(await resolveStudentDir(id), 'practice-cards'); await fs.mkdir(root, { recursive: true });
    if ((await fs.lstat(root)).isSymbolicLink()) throw Error('卡片目录不能使用符号链接');
    const file = path.join(root, 'store.json');
    let value;
    try { if ((await fs.lstat(file)).isSymbolicLink()) throw Error('卡片索引不能使用符号链接'); value = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; value = { schema: 'edu-manager.practice-store.v1', studentId: id, plan: null, cards: [], attempts: [], records: [] }; }
    if (value.studentId !== id || !Array.isArray(value.cards) || !Array.isArray(value.attempts)) throw Error('卡片学生归属或索引无效');
    return { root, value };
  }
  async function save(root, value) { const temp = path.join(root, `${crypto.randomUUID()}.tmp`); try { await fs.writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await fs.rename(temp, path.join(root, 'store.json')); } finally { await fs.rm(temp, { force: true }); } }
  function change(id, operation) { const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(async () => { const { root, value } = await load(id); const result = await operation(value, root); await save(root, value); return result; }); queues.set(id, next); next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => {}); return next; }
  async function dashboard(id) { const { value } = await load(id); return { plan: value.plan, current: publicCard(value.cards.find(card => card.status === 'started') || value.cards.filter(card => card.status === 'ready').at(-1) || value.cards[0]), history: value.cards.map(publicCard), records: value.records }; }
  async function create(id, trigger = 'manual', signal) {
    const first = await load(id), initial = await snapshot(id), plan = first.value.plan;
    if (!plan) throw Error('请先保存练习计划');
    const key = digest([id, date(), initial.inputFingerprint, plan.revision]);
    if (pending.has(key)) return pending.get(key);
    const promise = (async () => {
      const existing = first.value.cards.find(card => card.generationKey === key); if (existing) return { unchanged: true, card: publicCard(existing) };
      if (first.value.cards.filter(card => ['ready', 'started'].includes(card.status)).length >= 2) return { unchanged: true, message: '已有当前与下一张待练卡，不再堆积新题。' };
      const evidence = [...initial.learningSignals, ...initial.confirmedGrowthSignals].slice(0, 12).map((text, index) => ({ ref: `E${index}`, text }));
      if (!evidence.length) throw Error('当前没有正式报告或可追溯的已确认学习证据，不生成通用练习');
      try {
        const input = { profile: initial.profile, plan, evidence };
        const content = checkedContent(await generate({ schema: CONTENT_SCHEMA, input,
          instruction: '只围绕一个知识点生成一张 5—15 分钟提分练习卡。依据薄弱处或近期目标适配年级，信息不足时不猜测掌握程度。rationale 说明学生依据。prompt 只放题目，不包含答案；hint 为可选引导。必须可解、有唯一可解释答案或明确评价标准；sourceRefs 仅引用输入 E 编号。', signal }), evidence);
        const review = await generate({ schema: REVIEW_SCHEMA, input: { profile: initial.profile, evidence, content },
          instruction: '独立审核练习是否符合证据和年级、时长是否合理、题目是否可解、答案与解释是否正确、有无提前泄露答案或不安全内容。有任何疑问 passed=false；不能因生成器声称正确就通过。', signal });
        if (review?.passed !== true || typeof review.reason !== 'string') throw Error(`独立复核未通过：${String(review?.reason || '复核结果无效').slice(0, 200)}`);
        if ((await snapshot(id)).inputFingerprint !== initial.inputFingerprint) throw Error('学情证据已变化，请重试');
        return change(id, value => {
          if (value.plan?.revision !== plan.revision) throw Error('练习计划已变化，请重试');
          const duplicate = value.cards.find(card => card.generationKey === key); if (duplicate) return { unchanged: true, card: publicCard(duplicate) };
          if (value.cards.filter(card => ['ready', 'started'].includes(card.status)).length >= 2) return { unchanged: true, message: '待练卡达到上限' };
          const card = { id: crypto.randomUUID(), studentId: id, generationKey: key, inputFingerprint: initial.inputFingerprint, planRevision: plan.revision, status: 'ready', content, template: plan.template,
            createdAt: now().toISOString(), sourceIds: initial.sourceIds, review: { passed: true, reason: review.reason.slice(0, 500), mode: 'independent-agent-check' } };
          value.cards.unshift(card); value.records.unshift({ id: crypto.randomUUID(), trigger, status: 'generated', at: now().toISOString(), cardId: card.id }); value.records = value.records.slice(0, 200);
          return { card: publicCard(card) };
        });
      } catch (error) { await change(id, value => { value.records.unshift({ id: crypto.randomUUID(), trigger, status: 'failed', at: now().toISOString(), message: error.message.slice(0, 300) }); value.records = value.records.slice(0, 200); }); throw error; }
    })().finally(() => pending.delete(key)); pending.set(key, promise); return promise;
  }
  return { dashboard, exportCard: async (id, cardId) => { const { value } = await load(id); const card = value.cards.find(item => item.id === cardId); if (!card) throw Error('卡片不属于当前学生'); return publicCard(card); }, generate: create, savePlan: (id, input) => change(id, value => { value.plan = checkedPlan(input, value.plan || {}); return value.plan; }),
    start: (id, cardId) => change(id, value => { const card = value.cards.find(card => card.id === cardId); if (!card || !['ready', 'started'].includes(card.status)) throw Error('卡片不存在或不可开始'); card.status = 'started'; card.startedAt ||= now().toISOString(); return publicCard(card); }),
    submit: (id, cardId, input) => change(id, async (value, root) => {
      let attachment, bytes;
      if (input?.attachment) {
        const name = String(input.attachment.name || ''), encoded = input.attachment.base64;
        const ext = path.extname(name).toLowerCase();
        if (!/^[^\\/\x00-\x1f]{1,150}$/.test(name) || !['.png','.jpg','.jpeg','.pdf','.txt','.md','.docx'].includes(ext) || typeof encoded !== 'string' || encoded.length > 14*1024*1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw Error('作答文件格式无效；支持图片、PDF、DOCX、TXT、Markdown，最大10 MiB');
        bytes = Buffer.from(encoded, 'base64');
        if (!bytes.length || bytes.length > 10*1024*1024 || bytes.toString('base64') !== encoded || (ext === '.pdf' && !bytes.subarray(0,5).equals(Buffer.from('%PDF-'))) || (ext === '.png' && !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || (['.jpg','.jpeg'].includes(ext) && !bytes.subarray(0,3).equals(Buffer.from([255,216,255]))) || (ext === '.docx' && !bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])))) throw Error('作答文件内容或大小与格式不符');
        attachment = { name, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, extension: ext };
      }
      const old = value.attempts.find(attempt => attempt.attemptId === input.attemptId); if (old) { if (old.cardId !== cardId || old.answer !== input.answer || old.attachment?.sha256 !== attachment?.sha256 || old.attachment?.name !== attachment?.name || old.difficulty !== input.difficulty || old.confidence !== input.confidence) throw Error('提交编号已用于不同内容'); return { duplicate: true, attempt: old }; }
      const card = value.cards.find(card => card.id === cardId);
      if (!card || card.status !== 'started' || typeof input.attemptId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.attemptId) || (!attachment && (typeof input.answer !== 'string' || !input.answer.trim() || input.answer.length > 10000)) || !['easy', 'right', 'hard'].includes(input.difficulty) || !Number.isInteger(input.confidence) || input.confidence < 1 || input.confidence > 5) throw Error('作答或反馈格式无效，请先开始练习');
      if (attachment) {
        const folder = path.join(root, 'answers'); await fs.mkdir(folder, { recursive: true }); if ((await fs.lstat(folder)).isSymbolicLink()) throw Error('作答目录不能使用链接');
        attachment.objectId = attachment.sha256 + attachment.extension; const target = path.join(folder, attachment.objectId);
        try { await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 }); } catch(error) { if(error.code !== 'EEXIST') throw error; if((await fs.lstat(target)).isSymbolicLink() || crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex') !== attachment.sha256) throw Error('已有作答文件校验失败'); }
      }
      const attempt = { attemptId: input.attemptId, ...(attachment ? { attachment } : { answer: input.answer }), difficulty: input.difficulty, confidence: input.confidence, cardId, studentId: id, submittedAt: now().toISOString(), evidenceStatus: 'pending_review', masteryConclusion: null };
      value.attempts.unshift(attempt); card.status = 'completed'; card.completedAt = attempt.submittedAt; value.records.unshift({ id: crypto.randomUUID(), status: 'completed', cardId, at: attempt.submittedAt });
      return { attempt, card: publicCard(card) };
    }),
  };
}
module.exports = { createPracticeCards, checkedPlan, checkedContent, publicCard, CONTENT_SCHEMA, REVIEW_SCHEMA };
