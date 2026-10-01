'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createAudioTranscription, endpoint } = require('../electron/audio-transcription.cjs');
const { createObsidianVaults } = require('../electron/obsidian-vault.cjs');
const { createCaptureInbox } = require('../electron/capture-inbox.cjs');
const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'edu-audio-vault-test-'));
const codec = { protect: value => `encrypted:${Buffer.from(value).toString('base64')}`, unprotect: value => Buffer.from(value.slice(10), 'base64').toString() };
test('transcription endpoints restrict local/cloud routes, credentials and redirects', () => {
  assert.equal(endpoint('http://127.0.0.1:8000/v1/', 'local'), 'http://127.0.0.1:8000/v1');
  for (const [url, mode] of [['http://asr.example.com/v1','cloud'], ['https://127.0.0.1/v1','cloud'], ['http://192.168.1.1/v1','local'], ['https://user:pass@example.com/v1','cloud'], ['https://example.com/v1?token=x','cloud'], ['https://example.com/v1#x','cloud']]) assert.throws(() => endpoint(url, mode));
});
test('engine profiles persist independently; renderer never receives secrets; changing address needs new key', async () => {
  const root = await temp(); try {
    const engine = createAudioTranscription({ directory: root, ...codec });
    await engine.save({ mode: 'cloud', baseUrl: 'https://asr.example.com/v1', model: 'asr', language: 'zh', apiKey: 'synthetic-private-key' });
    assert.doesNotMatch(JSON.stringify(await engine.get()), /synthetic-private-key|encrypted:/);
    assert.doesNotMatch(await fs.readFile(path.join(root,'audio-transcription.json'),'utf8'), /synthetic-private-key/);
    await assert.rejects(engine.save({ mode: 'cloud', baseUrl: 'https://another.example.com/v1', model: 'asr', language: 'zh' }), /重新输入/);
    await engine.save({ mode: 'local', baseUrl: 'http://localhost:8000/v1', model: 'local-asr', language: '' });
    const reloaded = await createAudioTranscription({ directory: root, ...codec }).get(); assert.equal(reloaded.profiles.cloud.hasApiKey,true); assert.equal(reloaded.mode,'local');
    await engine.save({ mode: 'cloud', baseUrl: 'https://another.example.com/v1', model: 'asr', language: '', clearApiKey:true });
    assert.equal((await engine.get()).profiles.cloud.hasApiKey,false);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
test('model-only probe sends no audio; cloud transcription requires consent and omits original name/student identifiers', async () => {
  const root = await temp(); const calls=[];
  try { const engine = createAudioTranscription({ directory: root, ...codec, request: async (url, options) => {
    calls.push({url,options}); return new Response(JSON.stringify(url.endsWith('/models') ? {data:[{id:'asr'}]} : {text:'合成转写文本'}));
  }});
    await engine.save({mode:'cloud',baseUrl:'https://asr.example.com/v1',model:'asr',language:'zh',apiKey:'synthetic-key'});
    await engine.test(); assert.equal(calls[0].options.body,undefined); assert.equal(calls[0].options.redirect,'error');
    await assert.rejects(engine.transcribe({bytes:Buffer.from('audio'),filename:'学生姓名.mp3',consent:false}),/授权/); assert.equal(calls.length,1);
    const result=await engine.transcribe({bytes:Buffer.from('audio'),filename:'学生姓名.mp3',consent:true}); assert.equal(result.text,'合成转写文本'); assert.equal(calls[1].options.body.get('file').name,'recording.mp3'); assert.equal(calls[1].options.body.get('student_id'),null);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
test('local connector reports HTTP, model, JSON and empty transcription failures instead of invented text', async () => {
  const root=await temp(); try {
    for(const body of [{data:[]},{text:''},'not json']) {
      const engine=createAudioTranscription({directory:root,...codec,request:async()=>new Response(typeof body==='string'?body:JSON.stringify(body))});
      if(body.data) await assert.rejects(engine.test(),/模型/); else await assert.rejects(engine.transcribe({bytes:Buffer.from('audio'),filename:'audio.webm'}),/有效文本|JSON/);
    }
    const engine=createAudioTranscription({directory:root,...codec,request:async()=>new Response('',{status:401})}); await assert.rejects(engine.test(),/HTTP 401/);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
test('controlled audio creates an unconfirmed derivative once, preserves original and rejects other student/trash items', async () => {
  const root=await temp();let calls=0;
  try { const inbox=createCaptureInbox({resolveStudentDir:async id=>{if(!['a','b'].includes(id))throw Error('student');return path.join(root,id);},deliver:async()=>({ok:true})});
    const item=(await inbox.receive('a',{name:'录音.webm',sourceChannel:'audio',bytes:Buffer.from('synthetic-audio')})).item;
    const engine={transcribe:async()=>{calls++;return{text:'合成机器文本',mode:'local',model:'asr'};}};
    await assert.rejects(inbox.transcribe('b',item.itemId,engine,false),/当前学生/);
    const derived=await inbox.transcribe('a',item.itemId,engine,false); assert.equal((await inbox.transcribe('a',item.itemId,engine,false)).duplicate,true);assert.equal(calls,1);
    const index=JSON.parse(await fs.readFile(path.join(root,'a','capture-inbox','index.json'),'utf8'));const derivative=index.items.find(x=>x.itemId===derived.itemId);
    const content=await fs.readFile(path.join(root,'a','capture-inbox','objects',derivative.controlledObjectId),'utf8');assert.match(content,/pending_review/);assert.match(content,/machine_observed/);assert.match(content,/source_sha256/);
    assert.equal((await fs.readFile(path.join(root,'a','capture-inbox','objects',item.controlledObjectId))).toString(),'synthetic-audio');
    await inbox.change('a',[item.itemId],'trash');await assert.rejects(inbox.transcribe('a',item.itemId,engine,false),/未回收/);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
test('Obsidian registers selected folder without copying notes, backs up registry and preserves existing settings', async()=>{
  const root=await temp();try{
    const dir=path.join(root,'学生 汇总 & #');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'note.md'),'original');const registry=path.join(root,'obsidian.json');const original=JSON.stringify({vaults:{old:{path:path.join(root,'other'),ts:1,open:false}},cli:true});await fs.writeFile(registry,original);
    let uri='',active=false;const vaults=createObsidianVaults({registryPath:registry,installed:async()=>true,running:async()=>active,open:async value=>{uri=value;}});
    assert.equal((await vaults.open(dir)).created,true);assert.match(uri,/^obsidian:\/\/open\?vault=[a-f0-9]{16}$/);assert.equal(await fs.readFile(path.join(dir,'note.md'),'utf8'),'original');
    const state=JSON.parse(await fs.readFile(registry,'utf8'));assert.equal(state.cli,true);assert.deepEqual(state.vaults.old,{path:path.join(root,'other'),ts:1,open:false});assert.equal(Object.keys(state.vaults).length,2);assert.ok((await fs.readdir(root)).some(x=>x.startsWith('obsidian.json.edu-backup-')));
    await fs.writeFile(path.join(dir,'.obsidian','app.json'),'keep settings');active=true;assert.equal((await vaults.open(dir)).created,false);assert.equal(await fs.readFile(path.join(dir,'.obsidian','app.json'),'utf8'),'keep settings');assert.equal(await fs.readFile(registry,'utf8'),JSON.stringify(state));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('Obsidian rejects first registration while running, missing handler, corrupt registry and redirected vaults',async()=>{
  const root=await temp();try{const dir=path.join(root,'vault');await fs.mkdir(dir);const registry=path.join(root,'obsidian.json');
    const make=opts=>createObsidianVaults({registryPath:registry,installed:async()=>true,running:async()=>false,open:async()=>{},...opts});
    await assert.rejects(make({running:async()=>true}).open(dir),/保存并退出/);await assert.rejects(fs.stat(path.join(dir,'.obsidian')));
    await assert.rejects(make({installed:async()=>false}).open(dir),/安装/);
    await fs.writeFile(registry,'bad json');await assert.rejects(make().open(dir));assert.equal(await fs.readFile(registry,'utf8'),'bad json');await fs.unlink(registry);
    const link=path.join(root,'linked');await fs.symlink(dir,link,'junction');await assert.rejects(make().open(link),/目录链接/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('report-local cloud entry retains route and independent component; vault and audio APIs are async/licensed',async()=>{
  const read=file=>fs.readFile(path.join(__dirname,'..',file),'utf8');const main=await read('src/main.tsx'),host=await read('electron/main.cjs'),preload=await read('electron/preload.cjs');
  const learning=main.slice(main.indexOf('    learning: ['),main.indexOf('    projects: ['));assert.doesNotMatch(learning,/cloud-documents/);assert.match(main,/查看全部档案[\s\S]{0,230}setActiveSection\('cloud-documents'\)/);assert.match(main,/返回学情报告/);assert.match(main,/openKnowledgeObsidian\('student'\)/);assert.match(main,/openKnowledgeObsidian\('project'\)/);
  for(const method of ['getAudioTranscriptionSettings','saveAudioTranscriptionSettings','testAudioTranscription','transcribeCaptureAudio','openKnowledgeObsidian']){assert.match(host,new RegExp(`ipcMain\\.handle\\('bridge:${method}'[\\s\\S]{0,100}licensedInvoke`));assert.match(preload,new RegExp(`${method}\\([^)]*\\)[\\s\\S]{0,100}ipcRenderer\\.invoke`));}
});
