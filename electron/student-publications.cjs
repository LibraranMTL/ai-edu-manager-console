'use strict';
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
function studentCard(card) {
  if (!card) return null;
  return { ...pick(card, ['id','status','purpose','resourceType','resourceRef','createdAt','startedAt','completedAt','layout','template','languagePolicy']),
    content: pick(card.content, ['title','subject','knowledgePoint','prompt','hint','minutes','format']) };
}
function createStudentPublications({ cards, practice }) {
  return async (studentId, action, input = {}) => {
    // Caller supplies the authenticated session subject, never an ID from JSON.
    if (input.studentId !== undefined && String(input.studentId) !== String(studentId)) throw Error('不能访问其他学生');
    if (action === 'list') { const result = await cards.list(studentId,input); return pick(result,['items','total','page','pageSize','subjects']); }
    if (action === 'detail') return cards.detail(studentId,input.key);
    if (action === 'file') return cards.file(studentId,input.key);
    if (action === 'save') return cards.save(studentId,input.key);
    if (action === 'startResource') return { card: studentCard(await cards.start(studentId,input.key)) };
    if (action === 'workspace') {
      const value = await practice.workspace(studentId,{cardId:input.cardId});
      return {current:studentCard(value.current),latestAttempt:value.latestAttempt,counts:value.counts};
    }
    if (action === 'history') return practice.cardChoices(studentId);
    if (action === 'start') return {card:studentCard(await practice.start(studentId,input.cardId))};
    if (action === 'submit') { const result=await practice.submit(studentId,input.cardId,input.submission);return {saved:true,duplicate:!!result.duplicate,attemptId:result.attempt?.attemptId}; }
    if (action === 'assistance') return practice.assistance(studentId,input.cardId,input.kind);
    if (action === 'attempts') return practice.listAttempts(studentId,input);
    if (action === 'feedback') {
      const detail=await practice.attemptDetail(studentId,input.attemptId);
      // Reference answers are visible only after a real saved submission.
      return {...pick(detail,['attemptId','cardId','title','subject','processingStatus','body','feedbackSummary','learningStatus','error','recovery','attachment']),
        recovery:{...detail.recovery,message:detail.processingStatus==='completed'?'评阅已完成。可查看原题与反馈、提交修改稿；如怀疑误读，请联系教师或家长在主机核对。':detail.recovery?.message},
        reference:pick(detail.reference,['prompt','answer','explanation']),
        reviews:detail.reviews.map(r=>pick(r,['judgement','summary','correctParts','issues','suggestions','limitations','source','reviewedAt']))};
    }
    if (action === 'retry') return practice.requestReview(studentId,input.attemptId);
    if (action === 'historicalFile') return cards.historicalFile(studentId,input.cardId);
    if (action === 'printable') {
      const source=input.cardId?await practice.exportCard(studentId,input.cardId):await cards.detail(studentId,input.key);
      const card={...studentCard(source),id:source.id||source.cardId,status:input.cardId?source.status:'ready'};
      let html;
      if(source.type==='document'||source.resourceType==='document') {
        const file=input.cardId?await cards.historicalFile(studentId,input.cardId):await cards.file(studentId,input.key);
        html=await require('./practice-document.cjs').originalCardHtml({file,card});
      } else html=require('./practice-card-export.cjs').practiceCardHtml(card);
      return {card,html};
    }
    if (action === 'attachment') {const file=await practice.attachment(studentId,input.attemptId);return {base64:file.bytes.toString('base64'),extension:file.extension,name:file.name};}
    throw Error('学生端不支持此操作');
  };
}
module.exports = { createStudentPublications, studentCard };
