const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createPracticeCards, publicCard } = require('../electron/practice-cards.cjs');
const { applyPracticeLearningReview, queryLearningTrajectory } = require('../electron/learning-analytics.cjs');
const { readObject } = require('../electron/practice-files.cjs');
const template = { subject:'数学',range:'auto',minutes:10,template:'clear',focus:'',autoEnabled:false };
async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'card-feedback-')); t.after(() => fs.rm(root,{recursive:true,force:true}));
  let calls = 0, applications = 0;
  const api = createPracticeCards({ resolveStudentDir: async id => { if (!['a','b'].includes(id)) throw Error('学生不存在'); return path.join(root,id); },
    snapshot: async () => ({ inputFingerprint:'test',profile:{},learningSignals:['真实报告'],confirmedGrowthSignals:[],sourceIds:[] }),
    generate: async ({ schema, input }) => {
      calls++;
      if (schema.required.includes('passed')) return { passed:true,languagePassed:true,reason:'已复核' };
      if (schema.required.includes('judgement')) return { judgement:'correct',summary:'最终答案正确。',correctParts:['答案正确'],issues:[],suggestions:['再做一次独立练习。'],limitations:[],answerQuotes:[input.studentAnswer],readable:true,consistent:true };
      return { title:'平均数',subject:'数学',knowledgePoint:'平均数',rationale:'报告提示复习',minutes:10,sourceRefs:['E0'],prompt:'求 $1$ 与 $3$ 的平均数，记为 $x$。',hint:'先求和',answer:'x=2',explanation:'和除以数量。', ...options.cardContent };
    },
    applyLearning: async (id,input) => { applications++; return applyPracticeLearningReview(path.join(root,id),id,input); }, ...options });
  return { root, api, calls:()=>calls, applications:()=>applications, card:async () => { const {card}=await api.generate('a');await api.start('a',card.id);return card; } };
}
test('defaults allow first generation; optional feedback remains unknown; snapshots and originals are isolated', async t => {
  const env=await setup(t), card=await env.card();
  assert.equal((await env.api.workspace('a')).plan.minutes,10);
  const receipt=await env.api.submit('a',card.id,{attemptId:'first-answer',answer:'x=2'});
  assert.equal(receipt.attempt.confidence,null);assert.equal(receipt.attempt.difficulty,null);
  assert.equal(receipt.attempt.processingStatus,'submitted');assert.equal(env.calls(),2);
  assert.equal(receipt.attempt.answer,undefined);
  const detail=await env.api.attemptDetail('a','first-answer');assert.equal(detail.body.answer,'x=2');
  await assert.rejects(env.api.attemptDetail('b','first-answer'));
  assert.equal((await env.api.listAttempts('a')).items[0].snapshotRef,undefined);
  assert.equal((await env.api.submit('a',card.id,{attemptId:'first-answer',answer:'x=2'})).duplicate,true);
  await assert.rejects(env.api.submit('a',card.id,{attemptId:'first-answer',answer:'x=3'}));
});
test('legacy attempts have next steps and superseded cards remain readable without automatic review',async t=>{
 const e=await setup(t),card=await e.card();await e.api.submit('a',card.id,{attemptId:'legacy-answer',answer:'x=2'});
 const file=path.join(e.root,'a','practice-cards','store.json'),store=JSON.parse(await fs.readFile(file,'utf8'));
 store.cards[0].status='superseded';store.attempts[0]={attemptId:'legacy-answer',cardId:card.id,studentId:'a',answer:'x=2',submittedAt:'2026-10-01T00:00:00Z',evidenceStatus:'pending_review'};
 await fs.writeFile(file,JSON.stringify(store));
 assert.equal((await e.api.cardChoices('a'))[0].status,'superseded');assert.equal((await e.api.workspace('a',{cardId:card.id})).current.content.title,'平均数');
 let detail=await e.api.attemptDetail('a','legacy-answer');assert.equal(detail.title,'平均数');assert.equal(detail.processingStatus,'legacy');assert.equal(detail.recovery.canReview,true);assert.match(detail.recovery.message,/开始评阅/);assert.equal(e.calls(),2);
 await e.api.requestReview('a','legacy-answer');await e.api.reviewAttempt('a','legacy-answer');assert.equal(e.calls(),3);
 const missing=JSON.parse(await fs.readFile(file,'utf8'));missing.cards=[];missing.attempts.push({attemptId:'orphan',cardId:'missing',answer:'2'});await fs.writeFile(file,JSON.stringify(missing));
 detail=await e.api.attemptDetail('a','orphan');assert.equal(detail.recovery.canReview,false);assert.equal(detail.recovery.canRevise,false);assert.match(detail.recovery.message,/补建原题/);
 await assert.rejects(e.api.requestReview('a','orphan'),/历史题目已缺失/);
 assert.equal((await e.api.attemptDetail('a','legacy-answer')).reference.title,'平均数');
});
test('AI auto feedback writes correctness only, replay does not duplicate learning episodes', async t => {
  const env=await setup(t),card=await env.card();await env.api.submit('a',card.id,{attemptId:'first-answer',answer:'x=2'});
  await env.api.reviewAttempt('a','first-answer');await env.api.reviewAttempt('a','first-answer');
  const result=queryLearningTrajectory(path.join(env.root,'a'),{studentId:'a'});
  assert.equal(result.events.length,1);assert.equal(result.states[0].evidenceCount,1);
  assert.equal(result.events[0].performance.conceptualUnderstanding,null);
  assert.notEqual(result.states[0].state,'mastered');assert.notEqual(result.states[0].state,'mostly_mastered');
  assert.equal(env.calls(),3);assert.equal((await env.api.attemptDetail('a','first-answer')).learningStatus,'applied');
});
test('manual policy is snapshotted, corrections preserve AI result and replace effective episode',async t=>{
  const env=await setup(t);await env.api.savePlan('a',{...template,reviewPolicy:'human_confirm'});const card=await env.card();
  await env.api.submit('a',card.id,{attemptId:'first-answer',answer:'x=2'});
  await env.api.savePlan('a',{...template,reviewPolicy:'agent_auto'});
  await env.api.reviewAttempt('a','first-answer');assert.equal(env.applications(),0);
  await env.api.confirmReview('a','first-answer',{judgement:'needs_correction',note:'核对原稿，需修正。'});
  const detail=await env.api.attemptDetail('a','first-answer');assert.equal(detail.reviews.length,2);assert.equal(detail.reviews[0].judgement,'correct');
  await env.api.assistance('a',card.id,'answer');
  await env.api.submit('a',card.id,{attemptId:'revised-answer',parentAttemptId:'first-answer',answer:'x=2'});
  await env.api.reviewAttempt('a','revised-answer');
  const result=queryLearningTrajectory(path.join(env.root,'a'),{studentId:'a'});assert.equal(result.events.length,1);assert.equal(result.events[0].practiceReview.attemptId,'revised-answer');
  assert.equal(result.events[0].practiceReview.assistance.status,'revised');
  assert.equal((await env.api.attemptDetail('a','first-answer')).body.answer,'x=2');
});
test('automatic practice mapping rejects unknown IDs, label conflicts and cross-subject aliases', async t => {
  const { registeredPracticePoint } = require('../electron/practice-feedback.cjs');
  assert.equal(registeredPracticePoint({ knowledgePoint:'平均数',subject:'Maths' }).id,'MATH.STAT.MEAN');
  for (const content of [
    {knowledgePointId:'ENGLISH.CUSTOM',knowledgePoint:'Mean',subject:'英语'},
    {knowledgePointId:'MATH.UNKNOWN',knowledgePoint:'平均数',subject:'数学'},
    {knowledgePointId:'MATH.STAT.MEAN',knowledgePoint:'链式法则',subject:'数学'},
    {knowledgePoint:'平均数',subject:'英语'},
  ]) assert.equal(registeredPracticePoint(content),null);
  const env=await setup(t,{cardContent:{knowledgePoint:'尚未注册的知识点'}}),card=await env.card();
  await env.api.submit('a',card.id,{attemptId:'unmapped-answer',answer:'x=2'});
  await env.api.reviewAttempt('a','unmapped-answer');
  const detail=await env.api.attemptDetail('a','unmapped-answer');
  assert.equal(detail.learningStatus,'unmapped');assert.equal(detail.processingStatus,'completed');
  assert.equal(detail.reviews[0].judgement,'correct');assert.equal(env.applications(),0);
});
test('unreadable extraction never calls Agent or produces a definitive result',async t=>{
  const env=await setup(t,{extractAnswer:async()=>({text:'x?',quality:'partial',warnings:['图片模糊']})}),card=await env.card();
  await env.api.submit('a',card.id,{attemptId:'image-answer',attachment:{name:'answer.png',base64:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}});
  await env.api.reviewAttempt('a','image-answer');assert.equal(env.calls(),2);assert.equal(env.applications(),0);
  assert.equal((await env.api.attemptDetail('a','image-answer')).processingStatus,'needs_attention');
});
test('durable apply recovery reuses original AI result after a ledger failure',async t=>{
  let fail=true;const env=await setup(t,{applyLearning:async()=>{if(fail)throw Error('disk full');return {ok:true};}}),card=await env.card();
  await env.api.submit('a',card.id,{attemptId:'first-answer',answer:'x=2'});await assert.rejects(env.api.reviewAttempt('a','first-answer'));
  fail=false;await env.api.reviewAttempt('a','first-answer');assert.equal(env.calls(),3);
  assert.equal((await env.api.attemptDetail('a','first-answer')).learningStatus,'applied');
});
test('new public card projection never exposes snapshot, rubric, assessment or private source paths',()=>{
  const result=publicCard({id:'c',status:'started',snapshotRef:'private',sourceIds:['privatepath'],content:{title:'t',prompt:'q',answer:'secret',rubric:'secret',assessment:{acceptedAnswers:['secret']}}});
  assert(!JSON.stringify(result).includes('secret'));assert(!JSON.stringify(result).includes('private'));
});
test('same rendering supports math, tables, safe HTML fallback and offline export without answers',()=>{
  const {renderPracticeMarkdown}=require('../electron/practice-rich-text.mjs');
  const html=renderPracticeMarkdown('$$\\frac{1}{2}+\\sqrt{x}$$\n\n| a | b |\n| --- | --- |\n| x | y |\n<script>alert(1)</script>');
  assert.match(html,/katex/);assert.match(html,/<table>/);assert(!html.includes('<script>'));
  const exported=require('../electron/practice-card-export.cjs').practiceCardHtml({id:'test',status:'completed',content:{title:'公式',prompt:'$x^2$',answer:'SECRET',rationale:'PRIVATE_LEARNING_BASIS'}});
  assert.match(exported,/font\/woff2;base64/);assert(!exported.includes('SECRET'));
  assert(!exported.includes('PRIVATE_LEARNING_BASIS'));
  assert.match(renderPracticeMarkdown('```\n$$x^2$$\n```'),/\$\$x\^2\$\$/);
});
