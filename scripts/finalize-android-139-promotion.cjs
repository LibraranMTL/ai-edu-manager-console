'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),root=path.join(repo,'artifacts/android-139-promotion');
const read=n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8').replace(/^\uFEFF/,''));
const checks=read('public-verification.json'),roundTrip=read('public-apk-sha256.json'),ui=read('public-ui-verification.json'),cleanup=read('remote-cleanup.json'),audit=read('promotion-audit.json');
assert.equal(checks.passed,true);assert.equal(roundTrip.passed,true);assert.equal(ui.passed,true);assert.equal(cleanup.passed,true);assert.equal(cleanup.stagingRemoved,true);assert.equal(cleanup.oldApkUnchanged,true);
assert.equal(roundTrip.sha256,audit.sha256);assert.equal(roundTrip.bytes,69160643);
const before=read('before/download-manifest.json'),current=read('public/download-edu-manager-version.json');
for(const key of Object.keys(before))if(!key.startsWith('standalone'))assert.deepEqual(current[key],before[key],key);
assert.equal(current.standaloneVersionCode,43);assert.equal(current.windowsVersionName,'0.24.4');assert.equal(current.standalonePerformanceStatus,'pending_verification');
Object.assign(audit,{published:true,publishedAt:new Date().toISOString(),instanceId:'i-m5e6r68cl11nbh2y0o6z',region:'cn-qingdao',backup:cleanup.backupKept,stagingRemoved:true,publicResponseHashesVerified:true,publicApkRoundTrip:roundTrip,publicUiVerified:true});
fs.writeFileSync(path.join(root,'promotion-audit.json'),JSON.stringify(audit,null,2));
const recordPath=path.join(repo,'android-standalone-manager/delivery/AI-Education-Manager-Android-Standalone-1.3.9-release.json');
const record=JSON.parse(fs.readFileSync(recordPath,'utf8'));Object.assign(record,{published:true,publishedAt:audit.publishedAt,implementationCommit:audit.implementationCommit,backup:audit.backup});fs.writeFileSync(recordPath,JSON.stringify(record,null,2)+'\n');
const unique=[...new Map(audit.inventory.map(r=>[r.target.startsWith('download/AI-')?r.target:r.name,r])).values()];
const report=`# Android单机版1.3.9正式发布记录

发布日期：2026年11月25日（北京时间）。状态：已发布1.3.9/code43，原证书签名；综合性能状态保持pending_verification。

## 正式地址

- APK：https://www.greatbg.com/download/AI-Education-Manager-Android-Standalone-1.3.9.apk
- 下载页：https://www.greatbg.com/education/download.html
- 使用手册：https://www.greatbg.com/education/android-standalone-manual.html
- 客户端清单：https://www.greatbg.com/download/edu-manager-version.json
- 产品站清单：https://www.greatbg.com/education/edu-manager-version.json
- 旧1.3.8包：https://www.greatbg.com/download/AI-Education-Manager-Android-Standalone-1.3.8.apk

本次仅更新安卓单机版发布单元。Windows0.24.4/code283、Windows学生端0.19.3、安卓学生端0.6.34、教师端0.1.5及其他非standalone清单字段与发布前逐项相同。授权管理工具0.5.0未上传公开下载区，继续仅内部使用；激活服务与云文档服务仍正常运行。

## 冻结包、签名与源码

直接将已完成真机验收的self-activation-1.3.9-r1候选复制为正式命名，没有重编译、重签或修改APK字节。包名com.qxmatrix.edumanager.standalone，版本1.3.9/code43，大小69,160,643字节，SHA-256为${audit.sha256}。

v1/v2签名验证通过；证书SHA-256为${audit.certificateSha256}，与原1.3.8正式安装包一致。实际真机安装后的APK指纹也与该冻结包一致。原候选、构建登记和独立真机验收记录继续保留。

实现源码已归档于提交${audit.implementationCommit}。该提交包含此前已验收的收件箱与自助激活实现；与本次安卓发布文档/清单提交分开。归档发生在候选构建之后，不将其表述成原APK构建时的干净Git提交。本次发布修正旧candidate.json的1.3.7登记为实际1.3.9，并让更新合同测试按正式发布记录验证版本、包名与SHA，而不是沿用旧的固定文件名。

## 交付文件指纹

| 服务器目标 | 字节数 | SHA-256 |
| --- | ---: | --- |
${audit.inventory.map(r=>'| '+r.target+' | '+r.bytes+' | '+r.sha256+' |').join('\n')}

手册使用线上完整页面模板，仅按更新后的Android单机版Markdown源文件生成对应文章与目录，保留原导航、样式和其他功能章节；补充购买码自助激活、扫码确认、同设备恢复、有效期内离线使用与原AIE3兼容说明。源手册为docs/delivery/Android单机版操作手册.md，其他端手册未重新生成。

## 验证与实际边界

- 真机：华为NAM-AL00、Android12/API31。本轮首次激活、重复、恢复、非法码保护、断网冷启动、两个隔离身份的绑定拒绝、相册和摄像头识码均通过；机主原永久授权100席位、1个档案、75份资料和2个项目保持。详见[真机验收记录](Android单机版-1.3.9-激活真机验收-2026-11-25.md)。
- 本次发布相关Node合同37项通过；非目标安卓学生端版本完整性和站点一致性检查通过。既有Debug JVM308项通过记录沿用；本次没有修改已验收Kotlin业务代码。
- 暂存及上线后逐文件SHA-256、大小与0644 root:root验证；服务器本机HTTPS/SNI路由通过。公网页面、完整手册、两份清单完整响应体哈希与本地一致。
- 从本Windows管理电脑完整下载公网APK，69,160,643字节，SHA-256与冻结包一致。新旧APK均HTTP200，长度正确。
- Edge实际打开下载页与手册，验证1.3.9及1.3.8回退入口、Windows0.24.4保持；中文手册桌面1440px和手机390px宽度无水平溢出，完整原章节和新激活章节可读。
- 未运行整机综合性能/长时间稳定性基准、完整真实资料模型处理回归、全部原件逐字节审计或第二台物理手机测试；这些项目没有被标为通过。清单standalonePerformanceStatus仍为pending_verification，网页和手册保留说明。

## 服务器备份与回退

实例i-m5e6r68cl11nbh2y0o6z，cn-qingdao。站点根/www/wwwroot/123.56.83.50。备份目录${audit.backup}保留发布前下载页、完整手册和两处清单；旧1.3.8APK继续在原地址，前后SHA-256均为AF6398AE4A2D33D7709F5E4EDBCC9838D87B2CCC7813FCA39BBAE0C3AC11730C。

需要恢复公开下载指向时，在该实例执行python3 ${audit.backup}/rollback.py，再复核公网页面、手册和两处清单。脚本通过同目录临时文件原子恢复小文件，保留新旧不可变APK；本轮未实际执行回退。Android降级可能受系统限制，1.3.8也不支持新联网码，不能据保留旧包承诺无损降级；新授权客户回退前应先核验。

暂存/tmp/edu-android-139-20261125-r1已在完整验证后核对真实路径并清理，备份保留。本轮未改写客户端资料、激活库存或其他产品二进制。

完整发布审计为artifacts/android-139-promotion/promotion-audit.json，公网验证为public-verification.json、public-apk-sha256.json和public-ui-verification.json。原始运维日志、测试库存和凭据不提交Git。
`;
fs.writeFileSync(path.join(repo,'docs/delivery/Android单机版-1.3.9正式发布记录-2026-11-25.md'),report);
const acceptance=path.join(repo,'docs/delivery/自助激活机制-开发与候选验收-2026-11-25.md');let text=fs.readFileSync(acceptance,'utf8');
text=text.replace('安卓1.3.9签名候选已完成本轮激活与覆盖升级真机验收，安卓正式下载清单仍保持1.3.8。','安卓1.3.9已在本轮真机验收后正式发布；综合性能状态仍为待验证。');
text=text.split('\n').map(line=>line.startsWith('| 安卓实体设备 |')?line.replace('未发布安卓。','已按后续发布指令上线1.3.9，综合性能仍待验证。'):line).join('\n');
if(!text.includes('## 安卓正式发布补记'))text+='\n## 安卓正式发布补记（2026-11-25）\n\n按用户指令将同一原签名1.3.9/code43验收包正式发布，APK字节不变，更新下载页、完整使用手册与两处清单，旧1.3.8包及服务器回退备份保留。Windows0.24.4和其他客户端字段保持，授权工具0.5.0继续内部使用。综合性能与完整模型处理回归没有补写为通过。详见[正式发布记录](Android单机版-1.3.9正式发布记录-2026-11-25.md)。\n';
fs.writeFileSync(acceptance,text);
const physical=path.join(repo,'docs/delivery/Android单机版-1.3.9-激活真机验收-2026-11-25.md');let physicalText=fs.readFileSync(physical,'utf8');
physicalText=physicalText.replace('安卓仍为签名候选，尚未发布。','验收结束时安卓为签名候选；随后正式发布见文末补记。').replace('本轮没有更新任何安卓公开下载包或版本清单；公网安卓单机版仍为1.3.8/code42','本轮真机验收阶段没有更新安卓公开下载包或版本清单；验收结束时公网安卓单机版仍为1.3.8/code42');
if(!physicalText.includes('## 验收后发布补记'))physicalText+='\n## 验收后发布补记（2026-11-25）\n\n用户随后明确要求发布服务器、下载页、手册并提交Git。已将同一签名验收APK按原字节发布为1.3.9/code43；正式发布并不改变上述测试范围和未测量项目。详见[正式发布记录](Android单机版-1.3.9正式发布记录-2026-11-25.md)。\n';
fs.writeFileSync(physical,physicalText);
console.log(JSON.stringify({published:true,version:'1.3.9/43',backup:audit.backup,stagingRemoved:true}));
