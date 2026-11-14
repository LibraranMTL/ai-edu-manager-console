'use strict';
const BACKOFF = [15000, 30000, 60000, 300000];

// Dispatch eligibility and desktop presence are different facts. WorkBuddy's
// automatic lane uses its controlled CLI, so a closed desktop window or a
// missing wbipc endpoint must not strand work before the task-boundary
// authorization and contract checks can run. A cached qualification improves
// the status projection, but absence of one is not a confirmed negative.
function workBuddyDispatchReadiness({ adapter, profileId = '', savedQualification = null, now = Date.now() } = {}) {
  const runtime = adapter?.runtime;
  if (adapter?.unavailable || !runtime?.available || !runtime?.cliPath) return {
    state: 'unavailable', reasonCode: adapter?.code || 'not_installed',
    capability: { id: 'workbuddy', available: false, authorized: false, automatic: true, cli: false,
      exePath: runtime?.exePath || '' },
  };
  const authScope = JSON.stringify([runtime.configDir || '', runtime.authVersion || 0]);
  const qualified = Boolean(savedQualification?.ready
    && (!savedQualification.providerId || savedQualification.providerId === 'workbuddy')
    && (!savedQualification.profile || savedQualification.profile === profileId)
    && savedQualification.authScope === authScope
    && Date.parse(savedQualification.expiresAt || '') > now);
  return {
    state: 'available',
    reasonCode: qualified ? 'qualification_cached' : 'cli_ready_task_boundary_verification',
    capability: { id: 'workbuddy', available: true, authorized: qualified, automatic: true, cli: true,
      exePath: runtime.exePath || '', desktopSessionAvailable: Boolean(runtime.desktopSessionAvailable),
      qualificationPending: !qualified },
  };
}
function createDispatchCapabilityGate({ probe, now = Date.now, onChange = () => {}, deadlineMs = 15000,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof probe !== 'function') throw TypeError('probe required');
  const records = new Map(), generations = new Map(), pending = [];
  let active = 0, closed = false;
  const keyFor = (id, profile) => JSON.stringify([id, profile]);
  function current(r) { return !closed && records.get(r.key) === r && generations.get(r.key) === r.configRevision; }
  function drain() {
    while (!closed && active < 2 && pending.length) {
      const r = pending.shift(); if (!current(r)) continue;
      active++; r.controller = new AbortController();r.retryAt=now()+deadlineMs;
      const timeout = new Promise((_, reject) => {
        r.controller.signal.addEventListener('abort', () => reject(Object.assign(Error('probe_aborted'), {code:'probe_aborted'})), {once:true});
        r.timer = setTimer(() => { r.controller.abort(); reject(Object.assign(Error('probe_timeout'), {code:'probe_timeout'})); }, deadlineMs);
        r.timer.unref?.();
      });
      Promise.race([Promise.resolve().then(() => probe(r.providerId, { profileId:r.profileId, configRevision:r.configRevision, signal:r.controller.signal })), timeout])
        .then(value => finish(r, value), error => finish(r, {state:'unknown',reasonCode:error.code || 'probe_error',lastError:String(error.message || error).slice(0,160)}))
        .finally(() => { clearTimer(r.timer); active--; drain(); });
    }
  }
  function finish(r, value) {
    if (!current(r)) return;
    const at=now();
    r.state = ['available','unavailable','unknown'].includes(value?.state) ? value.state : 'unknown';
    r.refreshing=false;r.checkedAt=at;r.reasonCode=String(value?.reasonCode||r.state);
    r.lastError=String(value?.lastError||'');r.capability=value?.capability;
    if (r.state === 'available') { r.lastSuccessAt=at; r.expiresAt=at+300000; r.attempts=0;r.retryAt=0; }
    else if(r.state === 'unavailable'){r.expiresAt=at+60000;r.retryAt=0;}
    else {r.attempts++;r.retryAt=at+BACKOFF[Math.min(r.attempts-1,BACKOFF.length-1)];r.expiresAt=0;}
    try { onChange({providerId:r.providerId,profileId:r.profileId,configRevision:r.configRevision,state:r.state,retryAt:r.retryAt}); } catch { /* notification cannot corrupt probe state */ }
  }
  function ensureRecord(id, request) {
    const key=keyFor(id,request.profileId),generation=String(request.configRevision??'');let r=records.get(key);
    if(!r||r.configRevision!==generation){
      r?.controller?.abort();
      r={key,providerId:id,profileId:request.profileId,configRevision:generation,state:'unknown',refreshing:false,checkedAt:0,lastSuccessAt:0,lastError:'',retryAt:0,expiresAt:0,attempts:0,windowAt:now()};
      records.set(key,r);generations.set(key,generation);
    }
    if(now()-r.windowAt>=900000){r.attempts=0;r.windowAt=now();}
    const fresh=r.state!=='unknown' && r.expiresAt>now();
    if(!fresh&&!r.refreshing&&r.retryAt<=now()&&r.attempts<6){r.state='unknown';r.refreshing=true;r.retryAt=now()+deadlineMs;pending.push(r);drain();}
    return r;
  }
  function ensureReady(request) {
    if(closed||request.signal?.aborted)return {decision:'wait',retryAt:now()+15000,reasons:['cancelled_or_closed']};
    const ids=[...new Set(request.lockedProviderId?[request.lockedProviderId]:request.providers||[])];
    const rows=ids.map(id=>ensureRecord(id,request));
    const base={configRevision:String(request.configRevision??''),checkedAt:now(),reasons:rows.map(r=>({providerId:r.providerId,state:r.state,refreshing:r.refreshing,probeAttempt:r.attempts,reasonCode:r.reasonCode||'checking',lastError:r.lastError||''}))};
    // A shared refresh is evidence of uncertainty, not a global dispatch lock.
    // Preserve provider order among fresh positives, but inspect all candidates
    // before waiting for an earlier provider that is still probing.
    const available=rows.find(r=>r.state==='available'&&!r.refreshing&&r.expiresAt>now());
    if(available)return {...base,decision:'dispatch',providerId:available.providerId,capability:available.capability};
    const refreshing=rows.find(r=>r.refreshing);
    if(refreshing)return {...base,decision:'wait',retryAt:refreshing.retryAt};
    if(rows.every(r=>r.state==='unavailable'))return {...base,decision:'manual_fallback'};
    const unknown=rows.filter(r=>r.state==='unknown');
    if(unknown.every(r=>r.attempts>=6))return {...base,decision:'environment_help',retryAt:Math.min(...unknown.map(r=>r.windowAt+900000))};
    return {...base,decision:'wait',retryAt:Math.min(...unknown.filter(r=>r.attempts<6).map(r=>r.retryAt||now()+15000))};
  }
  function invalidate(providerId, reason='configuration_changed') {
    for(const [key,r] of records){if(r.providerId!==providerId)continue;r.controller?.abort();clearTimer(r.timer);records.delete(key);generations.delete(key);}
    try{onChange({providerId,state:'invalidated',reasonCode:reason});}catch{}
  }
  return {ensureReady,invalidate,snapshot:()=>[...records.values()].map(({controller,timer,key,...r})=>({...r})),
    close(){closed=true;for(const r of records.values()){clearTimer(r.timer);r.controller?.abort();}pending.length=0;records.clear();generations.clear();}};
}
module.exports={createDispatchCapabilityGate,workBuddyDispatchReadiness};
