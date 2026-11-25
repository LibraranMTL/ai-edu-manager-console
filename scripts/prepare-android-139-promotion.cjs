'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const repo=path.resolve(__dirname,'..'),root=path.join(repo,'artifacts/android-139-promotion'),out=path.join(root,'publish');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').toUpperCase();
const candidate=path.join(repo,'android-standalone-manager/delivery/candidates/self-activation-1.3.9-r1');
const meta=read(path.join(candidate,'AI-Education-Manager-Android-Standalone-1.3.9-device-test.json'));
const qa=read(path.join(candidate,'AI-Education-Manager-Android-Standalone-1.3.9-physical-acceptance.json'));
const apk=path.join(candidate,meta.fileName),name='AI-Education-Manager-Android-Standalone-1.3.9.apk';
assert.equal(meta.versionCode,43);assert.equal(meta.versionName,'1.3.9');assert.equal(qa.status,'passed-for-specified-scope');assert.equal(qa.apkSha256,meta.sha256);assert.equal(sha(apk),meta.sha256);
assert.equal(meta.certificateSha256,'647087C196380BED06FF285A95B29617DC5A31C4977A0C04DDBA895ADC67164F');
fs.mkdirSync(out,{recursive:true});
fs.copyFileSync(apk,path.join(out,name));
for(const dest of [path.join(repo,'release/download',name),path.join(repo,'android-standalone-manager/delivery/AI-Education-Manager-Android-Standalone-1.3.9-release.apk')]){
 fs.mkdirSync(path.dirname(dest),{recursive:true});if(fs.existsSync(dest))assert.equal(sha(dest),meta.sha256,'Refuse replacing a different formal binary');else fs.copyFileSync(apk,dest);
}
const old=read(path.join(root,'before/download-manifest.json'));
assert.equal(old.windowsVersionName,'0.24.4');assert.equal(old.windowsVersionCode,283);assert.equal(old.standaloneVersionName,'1.3.8');assert.equal(old.standaloneVersionCode,42);
const next={...old,standaloneVersionCode:43,standaloneVersionName:'1.3.9',standaloneApkUrl:'https://www.greatbg.com/download/'+name,standaloneSha256:meta.sha256,
 standaloneNotes:'新增联网自助激活，无需发送设备码；支持同设备恢复、相册与摄像头扫码，兼容原AIE3离线授权。原签名覆盖升级保留授权及资料；激活与覆盖升级真机验证通过。整机性能对比及完整模型业务回归尚未测量。',standaloneReleaseStatus:'stable'};
for(const key of Object.keys(old))if(!key.startsWith('standalone'))assert.deepEqual(next[key],old[key],key);
assert.equal(next.standalonePerformanceStatus,'pending_verification');
const manifestText=JSON.stringify(next,null,2)+'\n';
for(const relative of ['release/edu-manager-version.json','release/windows/edu-manager-version.json','release/网站文件/edu-manager-version.json'])fs.writeFileSync(path.join(repo,relative),manifestText);
fs.writeFileSync(path.join(out,'edu-manager-version.json'),manifestText);
const pageFile=path.join(repo,'release/网站文件/download.html');let page=fs.readFileSync(pageFile,'utf8');
const head=page.indexOf('<h2>Android 单机版</h2>'),start=page.lastIndexOf('<article',head),end=page.indexOf('</article>',head);
assert.ok(start>=0&&end>head);let card=page.slice(start,end);
assert.ok(card.includes('v1.3.8')&&card.includes('Standalone-1.3.8.apk'));
card=card.replace('v1.3.8','v1.3.9 · 联网自助激活').replace('Standalone-1.3.8.apk','Standalone-1.3.9.apk');
card=card.replace('<p style="min-height:0">','<p style="min-height:0">输入购买的激活码即可联网自助激活，无需发送设备码；支持同设备恢复，并保留原离线设备码授权。</p>\n            <p style="min-height:0">');
card+='\n            <details><summary>上一正式版 1.3.8 · 回退下载</summary><p>回退前先备份资料和授权；Android降级可能受系统限制。1.3.8不支持新的联网激活码，使用新授权的客户回退前请联系售后核验。</p><a href="../download/AI-Education-Manager-Android-Standalone-1.3.8.apk">下载1.3.8旧包</a></details>\n          ';
page=page.slice(0,start)+card+page.slice(end);page=page.replace(/[ \t]+$/gm,'');
assert.ok(!page.includes('AI-edu-license-admin-Windows-0.5.0'));assert.ok(page.includes('Windows-0.24.4-Setup.exe'));
fs.writeFileSync(pageFile,page);fs.copyFileSync(pageFile,path.join(out,'download.html'));
const manualFile=path.join(repo,'release/网站文件/android-standalone-manual.html');
// The live manual can be newer than the checkout template. Preserve its layout and
// regenerate only this product's article/TOC from the complete updated source.
const liveManual=fs.readFileSync(path.join(root,'before/android-standalone-manual.html'),'utf8');
if(/<aside class="toc">/.test(liveManual)&&/<article>/.test(liveManual)){
 fs.writeFileSync(manualFile,liveManual);
 cp.execFileSync(process.execPath,[path.join(repo,'scripts/sync-windows-host-web-manual.cjs'),'--android-standalone-only'],{cwd:repo,stdio:'pipe'});
 fs.copyFileSync(manualFile,path.join(out,'android-standalone-manual.html'));
}else{
let manual=fs.readFileSync(manualFile,'utf8');
assert.ok(manual.includes('正式版 1.3.8'));manual=manual.replaceAll('1.3.8','1.3.9').replace('工作台修订版 · versionCode 42','联网自助激活 · versionCode 43');
const begin=manual.indexOf('<h2>1. 安装、升级与首次进入</h2>'),finish=manual.indexOf('<h2>2. 学情工作台与四个主菜单</h2>');assert.ok(begin>=0&&finish>begin);
manual=manual.slice(0,begin)+`<h2>1. 安装、升级与首次进入</h2>
    <ol class="steps"><li>从下载页获取1.3.9正式签名APK。已有正式版可直接覆盖升级，保留原授权、应用数据和资料目录；升级前建议制作加密备份。</li><li>首次进入产品激活页，输入或粘贴购买的AEC1激活码，点击“激活并进入教育管家”。首次使用需联网，自动绑定本机，无需向销售或开发方发送设备码。</li><li>二维码在其他设备上时点击“扫码激活”，图片在本机时点击“从相册识别二维码”；核对后确认。二维码图片在本机识别，不上传、不保存；AEC1兑换联网完成，原AIE3设备码授权仍可在本机离线验签。</li><li>激活后创建学生档案或接管已有档案，明确授权一个长期保留的资料根目录，再开始收集资料。</li></ol>
    <p>已安装旧版时，可从<a href="download.html">产品下载页</a>下载安装包覆盖升级。正式证书与前版一致；不同签名测试版不能直接覆盖，请先核验备份和迁移方案。</p>
    <h3>恢复上次激活与离线使用</h3>
    <ul><li>激活后，本地功能可在授权有效期内离线使用；模型、课程同步等联网功能仍按各自条件使用。激活不上传学生资料。</li><li>在“系统设置 → 产品授权 → 继续”点击“恢复上次联网激活”。恢复需联网且本机原凭据仍在；重复同码激活和同设备恢复不额外消耗码，也不延长有效期。</li><li>更换授权时，新授权核验并保存成功前保留原有效授权与资料。识码后的确认框可取消，不会兑换。</li><li>网络失败时保留应用数据，恢复网络后重试或恢复。不要通过清除数据或卸载排查；换机、恢复出厂设置、改变Android用户空间或凭据丢失时请联系售后核验，资料迁移不包含许可证与设备密钥。</li></ul>
    <div class="notice warning"><strong>资料保留：</strong>升级前先在“系统设置 → 数据与存储”备份。不要手动移动、改名或删除迁移目录中的清单文件。原设备码签发方式继续兼容，首次自助激活无需使用该流程。</div>

    `+manual.slice(finish);
assert.ok(manual.includes('恢复上次联网激活')&&manual.includes('versionCode 43'));
fs.writeFileSync(manualFile,manual);fs.copyFileSync(manualFile,path.join(out,'android-standalone-manual.html'));
}
const mappings=[{name,target:'download/'+name},{name:'edu-manager-version.json',target:'download/edu-manager-version.json'},{name:'edu-manager-version.json',target:'education/edu-manager-version.json'},{name:'download.html',target:'education/download.html'},{name:'android-standalone-manual.html',target:'education/android-standalone-manual.html'}];
const inventory=mappings.map(row=>({...row,bytes:fs.statSync(path.join(out,row.name)).size,sha256:sha(path.join(out,row.name))}));
fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify(inventory,null,2));
fs.writeFileSync(path.join(out,'SHA256SUMS'),[...new Set(inventory.map(r=>r.name))].map(n=>sha(path.join(out,n)).toLowerCase()+'  '+n).join('\n')+'\n');
const expectedBefore={};for(const [target,file] of Object.entries({'download/edu-manager-version.json':'download-manifest.json','education/edu-manager-version.json':'education-manifest.json','education/download.html':'download.html','education/android-standalone-manual.html':'android-standalone-manual.html'}))expectedBefore[target]=sha(path.join(root,'before',file));
fs.writeFileSync(path.join(out,'expected-before.json'),JSON.stringify(expectedBefore,null,2));
const provenance={versionName:'1.3.9',versionCode:43,sha256:meta.sha256,bytes:meta.bytes,certificateSha256:meta.certificateSha256,fromCandidate:'self-activation-1.3.9-r1',candidateBytesUnchanged:true,implementationCommit:cp.execFileSync('git',['rev-parse','1efbc42'],{cwd:repo,encoding:'utf8'}).trim(),releaseStatus:'prepared-for-authorized-publication',published:false,physicalAcceptanceScope:qa.acceptedForScope,fullPerformanceAcceptance:false,inventory};
fs.writeFileSync(path.join(root,'promotion-audit.json'),JSON.stringify(provenance,null,2));
console.log(JSON.stringify({prepared:true,android:'1.3.9/43',windowsKept:next.windowsVersionName,performanceStatus:next.standalonePerformanceStatus,inventory},null,2));
