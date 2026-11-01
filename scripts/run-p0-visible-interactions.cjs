'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { measureInteraction } = require('./measure-p0-visible-interaction.cjs');

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.map(Number).sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarizeInteractions(samples, longTasks = []) {
  const actions = {};
  for (const action of ['refresh', 'switch', 'detail']) {
    const group = samples.filter(item => item.action === action);
    actions[action] = {
      count: group.length,
      p95Ms: percentile(group.map(item => item.durationMs), 0.95),
      maximumMs: Math.max(0, ...group.map(item => Number(item.durationMs || 0))),
      failures: group.filter(item => item.observedStatus !== 'pass').length,
    };
  }
  const failures = samples.filter(item => item.observedStatus !== 'pass').length;
  const maximumLongTaskMs = Math.max(0, ...longTasks.map(item => Number(item.duration || 0)));
  const interactionSamples = samples.length;
  return {
    interactionSamples,
    failures,
    actions,
    p95Ms: percentile(samples.map(item => item.durationMs), 0.95),
    maximumMs: Math.max(0, ...samples.map(item => Number(item.durationMs || 0))),
    maximumLongTaskMs,
    longTaskCount: longTasks.length,
    passed: interactionSamples >= 90
      && Object.values(actions).every(item => item.count >= 30 && item.p95Ms <= 150 && item.failures === 0)
      && maximumLongTaskMs <= 100,
  };
}

class CdpClient {
  constructor(url, callTimeoutMs = 10000) { this.url = url; this.callTimeoutMs = callTimeoutMs; this.id = 0; this.pending = new Map(); }
  async connect() {
    await new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(Error('cdp_connect_failed')), { once: true });
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id || !this.pending.has(message.id)) return;
        const { resolve: done, reject: fail, timer } = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(timer);
        message.error ? fail(Error(message.error.message)) : done(message.result);
      });
      this.socket.addEventListener('close', () => {
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(Error(`cdp_socket_closed:${id}`));
        }
        this.pending.clear();
      });
    });
  }
  call(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(Error(`cdp_call_timeout:${method}`));
      }, this.callTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text || 'evaluation_failed');
    return result.result?.value;
  }
  close() { this.socket?.close(); }
}

const clickText = pattern => `(function(){const re=${pattern};const nodes=[...document.querySelectorAll('button,a,[role="button"],summary')];const el=nodes.find(n=>re.test((n.textContent||'').trim())&&!n.disabled);if(!el)throw Error('control_not_found:'+re);el.click();return (el.textContent||'').trim();})()`;

async function main() {
  const port = Number(process.argv[2]);
  const outputPath = path.resolve(process.argv[3] || 'artifacts/p0-agent-0228/visible-interactions.json');
  const inspect = process.argv.includes('--inspect');
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = targets.find(item => item.type === 'page');
  if (!target) throw Error('page_target_not_found');
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.call('Runtime.enable');
    if (process.argv.includes('--task-center') || !inspect) {
      await client.evaluate(`${clickText('/^\\s*任务中心\\s*$/')}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (inspect) {
      const controls = await client.evaluate(`([...document.querySelectorAll('button,a,[role="button"],summary')]).map((n,i)=>({i,text:(n.textContent||'').trim().replace(/\\s+/g,' ').slice(0,160),tag:n.tagName,disabled:!!n.disabled})).filter(x=>x.text)`);
      console.log(JSON.stringify({ title: target.title, url: target.url, controls }, null, 2));
      return;
    }
    await client.evaluate(`window.__p0LongTasks=[];if(window.PerformanceObserver){try{window.__p0Observer?.disconnect?.();window.__p0Observer=new PerformanceObserver(list=>{for(const e of list.getEntries())window.__p0LongTasks.push({startTime:e.startTime,duration:e.duration});});window.__p0Observer.observe({entryTypes:['longtask']});}catch{}}`);
    const evaluate = expression => client.evaluate(expression);
    const samples = [];
    for (let index = 0; index < 30; index += 1) {
      const refresh = await measureInteraction({ evaluate,
        actionExpression: `${clickText('/刷新列表/')} `,
        readyExpression: `document.readyState==='complete'&&!document.querySelector('[aria-busy="true"]')` });
      samples.push({ action: 'refresh', iteration: index + 1, ...refresh });

      const label = index % 2 === 0 ? '/需要你帮助/' : '/自动处理中/';
      const switched = await measureInteraction({ evaluate,
        actionExpression: `${clickText(label)}`,
        readyExpression: `document.readyState==='complete'&&!document.querySelector('[aria-busy="true"]')` });
      samples.push({ action: 'switch', iteration: index + 1, ...switched });

      const detail = await measureInteraction({ evaluate,
        actionExpression: `${clickText('/高级Agent 状态与排障/')}`,
        readyExpression: `document.readyState==='complete'&&!document.querySelector('[aria-busy="true"]')` });
      samples.push({ action: 'detail', iteration: index + 1, ...detail });
    }
    const longTasks = await client.evaluate('window.__p0LongTasks||[]');
    const report = {
      schema: 'edu.p0.visible-interactions.v1',
      generatedAt: new Date().toISOString(),
      target: { title: target.title, url: target.url },
      visible: await client.evaluate(`document.visibilityState==='visible'`),
      samples,
      longTasks,
      ...summarizeInteractions(samples, longTasks),
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, interactionSamples: report.interactionSamples, p95Ms: report.p95Ms, maximumLongTaskMs: report.maximumLongTaskMs }));
    process.exitCode = report.passed ? 0 : 1;
  } finally { client.close(); }
}

if (require.main === module) void main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { percentile, summarizeInteractions, CdpClient };
