const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/card-verification');fs.mkdirSync(out,{recursive:true});
const files=['tests','cloud-report-service'].flatMap(folder=>fs.readdirSync(path.join(root,folder)).filter(file=>file.endsWith('.test.cjs')).map(file=>`${folder}/${file}`));
const child=spawn(process.execPath,['--test','--test-concurrency=4','--test-reporter=spec',...files],{cwd:root,windowsHide:true,env:{...process.env,FORCE_COLOR:'0',NO_COLOR:'1'}});
let output='';const stream=fs.createWriteStream(path.join(out,'full-suite.log'));
for(const source of [child.stdout,child.stderr])source.on('data',chunk=>{stream.write(chunk);output+=chunk.toString();});
child.once('error',error=>{console.error(error);process.exitCode=1;});
child.once('close',code=>{stream.end();const summary=output.split(/\r?\n/).filter(line=>/^ℹ |^✖ |^test at /.test(line));const result={at:new Date().toISOString(),version:require('../package.json').version,exitCode:code,summary};fs.writeFileSync(path.join(out,'full-suite.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=code;});
