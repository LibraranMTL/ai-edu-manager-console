const fs=require('node:fs');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const {createService}=require('../activation-service/service.cjs');
const service=createService({...config,privateKey:fs.readFileSync(config.privateKeyPath,'utf8')});
const status=service.status();service.close();
fetch('https://www.greatbg.com/edu-activation/health',{signal:AbortSignal.timeout(10000)}).then(async response=>{
  if(!response.ok || !(await response.json()).ok)throw Error('public health unavailable');
  console.log(JSON.stringify(status));if(status.alerts.length)process.exitCode=1;
}).catch(()=>{console.error('Activation HTTPS health check failed');process.exitCode=1;});
