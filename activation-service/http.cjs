'use strict';
const http = require('node:http');
const fs = require('node:fs');
const { createService } = require('./service.cjs');
function createServer(options) {
  const service = createService(options); const limits = new Map();
  const json = (res, status, body) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(JSON.stringify(body)); };
  function limit(key, max) {
    const now = Date.now(); if (limits.size > 10000) for (const [k,v] of limits) if (v.until < now) limits.delete(k);
    let row = limits.get(key); if (!row || row.until < now) { if (limits.size > 10000) throw Object.assign(new Error('服务繁忙，请稍后重试'),{status:429,code:'RATE_LIMITED'}); row={count:0,until:now+60000}; limits.set(key,row); }
    if (++row.count > max) throw Object.assign(new Error('请求过于频繁，请稍后重试'),{status:429,code:'RATE_LIMITED'});
  }
  const server = http.createServer(async (req,res) => {
    const started=Date.now();res.on('finish',()=>{try{service.recordRequest(res.statusCode,Date.now()-started);}catch{ /* Monitor failures never expose request contents. */ }});
    try {
      const url = new URL(req.url,'http://localhost'); const route = url.pathname;
      if (req.method === 'GET' && route === '/health') return json(res,200,{ok:true,service:'edu-activation',version:'1.0.0',signingKeyId:options.keyId});
      // Apache appends the connecting client's IP with ProxyAddHeaders On.
      // Ignore attacker-controlled entries before the final proxy-added address.
      const peer = options.trustProxy ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').pop().trim().slice(0,80) : req.socket.remoteAddress;
      limit(`${peer}:${route === '/v1/admin/login' ? 'login' : 'api'}`, route === '/v1/admin/login' ? 5 : 60);
      if (route.startsWith('/v1/admin/') && route !== '/v1/admin/login') service.authorize(String(req.headers.authorization || '').replace(/^Bearer /,''));
      if(req.method==='GET'&&route==='/v1/admin/status')return json(res,200,service.status());
      if (req.method === 'GET' && ['/v1/admin/batches','/v1/admin/activations'].includes(route)) return json(res,200,service.list(route.split('/').pop(),url.searchParams.get('offset')));
      if (req.method !== 'POST') return json(res,404,{ok:false,code:'NOT_FOUND',message:'接口不存在'});
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res,415,{ok:false,code:'CONTENT_TYPE',message:'需要 JSON 请求'});
      const max = route === '/v1/admin/batches' ? 100000 : 16384;
      const chunks=[]; let size=0;
      for await (const chunk of req) { size+=chunk.length; if(size>max) throw Object.assign(new Error('请求过大'),{status:413,code:'TOO_LARGE'}); chunks.push(chunk); }
      let body; try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('JSON 格式无效'),{status:400,code:'INVALID_JSON'}); }
      if (!body || Array.isArray(body) || typeof body !== 'object') throw Object.assign(new Error('请求格式无效'),{status:400,code:'INVALID_JSON'});
      if (route === '/v1/admin/login') return json(res,200,service.login(body.password));
      if (route === '/v1/admin/batches') return json(res,200,service.register(body));
      const action=route.match(/^\/v1\/admin\/batches\/([\w-]{8,128})\/actions$/);
      if(action) return json(res,200,service.batchAction(action[1],body.action));
      if(['/v1/activations/redeem','/v1/activations/recover'].includes(route)) return json(res,200,service.exchange(route,body));
      return json(res,404,{ok:false,code:'NOT_FOUND',message:'接口不存在'});
    } catch(error) { if (!res.destroyed) json(res,error.status || 500,{ok:false,code:error.code && error.status ? error.code : 'SERVICE_UNAVAILABLE',message:error.status ? error.message : '激活服务暂不可用，请稍后重试'}); }
  });
  server.headersTimeout=10000; server.requestTimeout=20000;
  server.on('close',()=>service.close()); return {server,service};
}
if(require.main===module) {
  const config=JSON.parse(fs.readFileSync(process.env.EDU_ACTIVATION_CONFIG,'utf8'));
  const {server}=createServer({...config,privateKey:fs.readFileSync(config.privateKeyPath,'utf8'),trustProxy:true});
  server.listen(config.port || 8758,'127.0.0.1');
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));
}
module.exports={createServer};
