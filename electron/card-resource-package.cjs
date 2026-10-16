'use strict';
const { canonicalize } = require('./course-catalog.cjs');
const { sha256Buffer, imageExtension } = require('./course-package-v2.cjs');
const SCHEMA = 'edu-manager.card-package.v1';
const MAX_BYTES = 64 * 1024 * 1024;
const digest = value => sha256Buffer(Buffer.from(canonicalize(value)));
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value);
function teachingContent(input = {}) {
  const content = {};
  for (const field of ['title','subject','knowledgePoint','knowledgePointId','prompt','hint','answer','explanation','rubric']) {
    if (input[field] !== undefined) { if (typeof input[field] !== 'string' || input[field].length > 15000) throw Error(`教学内容 ${field} 无效`); content[field] = input[field]; }
  }
  content.minutes = Number(input.minutes || 10);
  if (!Number.isInteger(content.minutes) || content.minutes < 1 || content.minutes > 60) throw Error('卡片时长无效');
  content.format = 'markdown-math';
  // No rationale/sourceRefs/student identity is copied from personalized cards.
  if (input.assessment?.kind === 'exact') {
    const answers = input.assessment.acceptedAnswers;
    if (!Array.isArray(answers) || !answers.length || answers.length > 20 || answers.some(a => typeof a !== 'string' || !a.trim() || a.length > 500)) throw Error('客观答案规则无效');
    content.assessment = { kind:'exact',acceptedAnswers:answers };
  }
  return content;
}
function checkResource(value) {
  if (!value || !id(value.publisherId) || !id(value.cardId) || !Number.isSafeInteger(value.version) || value.version < 1
    || !['platform','institution','personal','builtin'].includes(value.scope) || !['practice','knowledge','blank'].includes(value.purpose)
    || !['structured','document'].includes(value.type) || !['published','withdrawn'].includes(value.status)
    || !['clear','warm','mono'].includes(value.template)) throw Error('卡片资源身份、版本或类型无效');
  const content = teachingContent(value.content);
  if (!content.title?.trim() || !content.subject?.trim()) throw Error('请填写标题和学科');
  if (value.type === 'structured' && !content.prompt?.trim()) throw Error('请填写题目／卡片正文');
  if (value.purpose === 'practice' && value.type === 'structured' && !content.answer?.trim() && !content.rubric?.trim()) throw Error('练习卡需要参考答案或评价量规');
  if (!['zh-CN','en'].includes(value.languagePolicy?.instructionLanguage)) throw Error('卡片语言无效');
  let asset = null;
  if (value.type === 'document') {
    if (!/^[a-f0-9]{64}$/.test(value.asset?.sha256 || '') || !['.png','.jpg','.pdf'].includes(value.asset?.extension)
      || !Number.isSafeInteger(value.asset?.bytes) || value.asset.bytes <= 0 || value.asset.bytes > 10 * 1024 * 1024) throw Error('原版卡片文件引用无效');
    asset = { sha256:value.asset.sha256,extension:value.asset.extension,bytes:value.asset.bytes };
  }
  const normalized = { publisherId:value.publisherId,publisherName:String(value.publisherName || '').slice(0,100),cardId:value.cardId,version:value.version,
    scope:value.scope,purpose:value.purpose,type:value.type,status:value.status,template:value.template,content,asset,
    languagePolicy:{instructionLanguage:value.languagePolicy.instructionLanguage,supportLanguage:['zh-CN','en'].includes(value.languagePolicy.supportLanguage)?value.languagePolicy.supportLanguage:null,targetLanguage:content.subject==='英语'?'en':null},
    grade:String(value.grade || '').slice(0,60),licenseNote:String(value.licenseNote || '').slice(0,500),publishedAt:String(value.publishedAt || '').slice(0,40) };
  if(value.layout){const {fontSize,accent,paper,orientation}=value.layout;if(![16,18,20].includes(fontSize)||!/^#[0-9a-fA-F]{6}$/.test(accent)||!['A4','Letter'].includes(paper)||(orientation!==undefined&&!['portrait','landscape'].includes(orientation)))throw Error('卡片排版设置无效');normalized.layout={fontSize,accent,paper,...(orientation!==undefined?{orientation}:{})};}
  const key = `${normalized.publisherId}:${normalized.cardId}:${normalized.version}`;
  return { ...normalized, key, contentHash:digest(normalized) };
}
function validateAsset(asset) {
  if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256 || '') || typeof asset.base64 !== 'string' || asset.base64.length > 14 * 1024 * 1024) throw Error('资源文件无效');
  const bytes=Buffer.from(asset.base64,'base64');
  if (!bytes.length || bytes.length>10*1024*1024 || bytes.toString('base64')!==asset.base64 || sha256Buffer(bytes)!==asset.sha256) throw Error('资源文件完整性校验失败');
  const extension = bytes.subarray(0,5).toString() === '%PDF-' ? '.pdf' : imageExtension(bytes);
  if (!['.png','.jpg','.pdf'].includes(extension) || extension!==asset.extension) throw Error('资源文件格式与声明不符');
  return { sha256:asset.sha256,extension,bytes:bytes.length,base64:asset.base64 };
}
function encodeCardPackage(resources, assets = []) {
  const cards=resources.map(checkResource), files=assets.map(validateAsset);
  const manifest={schema:SCHEMA,cards:cards.map(c=>({key:c.key,sha256:c.contentHash})),files:files.map(a=>({sha256:a.sha256,extension:a.extension,bytes:a.bytes}))};
  const document={manifest,resources:cards,assets:files,checksum:digest({manifest,resources:cards,assets:files})};
  const bytes=Buffer.from(JSON.stringify(document));if(bytes.length>MAX_BYTES)throw Error('卡片包超过 64 MiB');
  decodeCardPackage(bytes);return bytes;
}
function decodeCardPackage(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length>MAX_BYTES)throw Error('卡片包为空或超过 64 MiB');
  const document=JSON.parse(bytes.toString('utf8'));
  if(document.manifest?.schema!==SCHEMA || !Array.isArray(document.resources)||!document.resources.length||document.resources.length>200||!Array.isArray(document.assets)||document.assets.length>200)throw Error('卡片包格式不受支持');
  const {manifest,resources,assets}=document;
  if(digest({manifest,resources,assets})!==document.checksum)throw Error('卡片包完整性校验失败');
  const cards=resources.map(checkResource),files=assets.map(validateAsset);
  if(new Set(cards.map(c=>c.key)).size!==cards.length || new Set(files.map(a=>a.sha256)).size!==files.length)throw Error('卡片包包含重复条目');
  if(cards.some(c=>['personal','builtin'].includes(c.scope)))throw Error('卡片包发布范围无效');
  if(digest(manifest.cards)!==digest(cards.map(c=>({key:c.key,sha256:c.contentHash})))||digest(manifest.files)!==digest(files.map(a=>({sha256:a.sha256,extension:a.extension,bytes:a.bytes}))))throw Error('卡片包清单不匹配');
  for(const card of cards)if(card.asset&&!files.some(file=>file.sha256===card.asset.sha256&&file.bytes===card.asset.bytes&&file.extension===card.asset.extension))throw Error('卡片原版文件缺失');
  if(files.some(file=>!cards.some(card=>card.asset?.sha256===file.sha256)))throw Error('卡片包包含未引用的文件');
  return {resources:cards,assets:files,checksum:document.checksum,identityVerified:false};
}
module.exports={SCHEMA,MAX_BYTES,digest,teachingContent,checkResource,validateAsset,encodeCardPackage,decodeCardPackage};
