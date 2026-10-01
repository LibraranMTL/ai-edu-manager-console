'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createPracticeCards } = require('../electron/practice-cards.cjs');
const { practiceCardHtml } = require('../electron/practice-card-export.cjs');
const { createHttpServer } = require('../cloud-report-service/http.cjs');
const { uploadPublishedReports } = require('../electron/cloud-report-sync.cjs');
const ADMIN = 'test-private-admin-0192-1234567890';
test('answer file storage is student-scoped, hashed, idempotent and not mastery evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'answer-file-'));
  try {
    const api = createPracticeCards({ resolveStudentDir: async id => { if(!['a','b'].includes(id)) throw Error('student'); return path.join(root,id); }, snapshot: async () => ({ profile: {}, learningSignals:['正式报告：复习方程'],confirmedGrowthSignals:[],sourceIds:['r1'],inputFingerprint:'fp' }), generate: async ({schema}) => schema.required.includes('passed') ? {passed:true,reason:'通过'} : {title:'方程',subject:'数学',knowledgePoint:'一次方程',rationale:'正式报告依据',minutes:10,prompt:'2x+3=7',hint:'移项',answer:'x=2',explanation:'减3再除2',sourceRefs:['E0']} });
    await api.savePlan('a',{subject:'数学',range:'auto',minutes:10,template:'clear',focus:'',autoEnabled:false});
    const {card} = await api.generate('a'); await api.start('a',card.id);
    const input = {attemptId:'answer-file-0192',attachment:{name:'作答.txt',base64:Buffer.from('x=2').toString('base64')},difficulty:'right',confidence:3};
    await assert.rejects(api.submit('b',card.id,input));
    await assert.rejects(api.submit('a',card.id,{...input,attachment:{...input.attachment,name:'../escape.txt'}}));
    await assert.rejects(api.submit('a',card.id,{...input,attachment:{...input.attachment,name:'false.pdf'}}));
    const result = await api.submit('a',card.id,input); assert.equal(result.attempt.masteryConclusion,null);
    assert.equal((await api.submit('a',card.id,input)).duplicate,true);
    assert.equal(await fs.readFile(path.join(root,'a','practice-cards','answers',result.attempt.attachment.objectId),'utf8'),'x=2');
    assert.equal((await fs.readdir(path.join(root,'a','practice-cards','answers'))).length,1);
    assert.equal(JSON.stringify(result).includes('base64'),false);
    await assert.rejects(api.exportCard('b',card.id));
    assert.equal((await api.exportCard('a',card.id)).id,card.id);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
test('share HTML excludes answers, provenance and attempt payloads and escapes active content', () => {
  const card = {id:'test',status:'completed',studentId:'SECRET-ID',sourceIds:['SECRET-PATH'],attempt:{answer:'SECRET-SUBMISSION'},content:{title:'<script>bad</script>',subject:'数学',minutes:10,knowledgePoint:'方程',rationale:'复习',prompt:'2x+3=7',answer:'SECRET-ANSWER',explanation:'SECRET-EXPLANATION'}};
  const html = practiceCardHtml(card); assert.doesNotMatch(html,/SECRET-|<script>/); assert.match(html,/&lt;script&gt;/); assert.match(html,/@page/);
  assert.throws(()=>practiceCardHtml({...card,status:'failed'}));
});
test('local hash only becomes unchanged after cloud verifies receipt; missing recovers, withdrawal is never resurrected', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'receipt-0192-'));
  const app = createHttpServer({ dataDir:path.join(root,'cloud'),adminToken:ADMIN,allowLegacyTestCredentials:true });
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${app.server.address().port}`;
    const call=async(route,token,body)=>{const response=await fetch(base+route,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.ok,true);return response.json();};
    const student=await call('/v1/students',ADMIN,{displayName:'隔离测试'}), source=await call('/v1/devices/source',ADMIN,{});
    await call('/v1/grants/write',ADMIN,{deviceId:source.deviceId,cloudStudentId:student.id});
    const reportDir=path.join(root,'reports'); await fs.mkdir(reportDir);
    await fs.writeFile(path.join(reportDir,'整体画像.md'),'---\ntype: learning_profile\nstatus: published\nupdated: 2026-10-01\n---\n\n数学方程练习已有正式复习依据。');
    const options={serverUrl:base,deviceToken:source.deviceToken,reportDir,localStudentId:'test',cloudStudentId:student.id};
    const first=await uploadPublishedReports(options), next=await uploadPublishedReports({...options,knownHashes:first.hashes});
    assert.equal(next.unchanged.length,1); assert.ok(next.serverVerifiedAt); assert.equal(next.uploaded.length,0);
    app.service.deleteReport(ADMIN,first.uploaded[0].revisionId);
    const withdrawn=await uploadPublishedReports({...options,knownHashes:first.hashes}); assert.equal(withdrawn.uploaded.length,0);assert.match(withdrawn.skipped.map(x=>x.reason).join(),/撤回/);
    const other=await call('/v1/students',ADMIN,{displayName:'另一个学生'});
    await assert.rejects(uploadPublishedReports({...options,cloudStudentId:other.id,knownHashes:first.hashes}),/403/);
    await fs.writeFile(path.join(reportDir,'整体画像.md'),'---\ntype: learning_profile\nstatus: published\nupdated: 2026-10-01\n---\n\n数学方程练习已有新的正式复习依据。');
    const snapshot=await require('../electron/cloud-report-sync.cjs').snapshotPublishedReports({...options});
    const recovered=await uploadPublishedReports({...options,knownHashes:{learning_profile:snapshot.ready[0].contentSha256}}); assert.equal(recovered.uploaded.length,1);
  } finally {await app.close();await fs.rm(root,{recursive:true,force:true});}
});
