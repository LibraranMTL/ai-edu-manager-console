'use strict';
const crypto = require('node:crypto');
const LANGUAGES = ['zh-CN', 'en'];
function checkedLanguageProfile(input) {
  if (input == null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) throw Error('学习语言设置无效');
  const primaryLanguage = input.primaryLanguage ?? '', supportLanguage = input.supportLanguage ?? '';
  if (![...LANGUAGES, ''].includes(primaryLanguage) || ![...LANGUAGES, ''].includes(supportLanguage) || (!primaryLanguage && supportLanguage)) throw Error('请设置主要学习语言；当前支持简体中文和英语');
  return { primaryLanguage, supportLanguage: supportLanguage === primaryLanguage ? '' : supportLanguage };
}
function targetLanguageForSubject(subject) {
  return subject === '英语' ? 'en' : subject === '语文' ? 'zh-CN' : null;
}
function resolveLanguagePolicy(profile, subject, previous) {
  const checked = checkedLanguageProfile(profile);
  const historical = previous?.version === 1 && previous.resolvedFrom !== 'legacy_default'
    ? checkedLanguageProfile({ primaryLanguage: previous.instructionLanguage, supportLanguage: previous.supportLanguage }) : undefined;
  const selected = checked?.primaryLanguage ? checked : historical?.primaryLanguage ? historical : { primaryLanguage: 'zh-CN', supportLanguage: '' };
  const resolvedFrom = checked?.primaryLanguage ? 'student_profile' : historical?.primaryLanguage ? 'previous_card' : 'legacy_default';
  const core = { version: 1, instructionLanguage: selected.primaryLanguage, supportLanguage: selected.supportLanguage || null, targetLanguage: targetLanguageForSubject(subject) };
  return { ...core, resolvedFrom, fingerprint: crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex') };
}
const GENERATION_LANGUAGE_RULES = '严格遵守 languagePolicy：title、knowledgePoint、rationale 使用 instructionLanguage；subject 必须使用输入学科的中文标准名称。非语言科目的 prompt 使用 instructionLanguage。英语/语文的练习词句和待作答任务保留其目标语言（en/zh-CN），题目指令、提示和解析使用 instructionLanguage；auto 时先选定学科再遵守同一规则。supportLanguage 仅用于 hint、explanation 中简短的关键词或核心解释，禁止逐行复制整张题目，不得用翻译泄露阅读题答案。答案、公式、单位与专有名词保持准确。语言要求只影响表达，不得降低知识点难度或从语言设置推断能力。不根据姓名、地区或来源资料的语言猜测语言背景。';
const REVIEW_LANGUAGE_RULES = '还必须核对 languagePolicy：目标语言词句是否保留，题目指令/标题/说明是否使用主要学习语言，辅助语言是否只用于简短关键词/提示/解析且未泄露答案，翻译是否保持答案、公式、单位和考查目标一致。允许必要的目标语言引用与数学符号，不因混合语言直接拒绝；语言不符合、翻译改变答案或无法确认时 languagePassed=false 且 passed=false。';
module.exports = { checkedLanguageProfile, resolveLanguagePolicy, targetLanguageForSubject, GENERATION_LANGUAGE_RULES, REVIEW_LANGUAGE_RULES };
