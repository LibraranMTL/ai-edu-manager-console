'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyProbeResult,validateProbeResult}=require('../scripts/probe-codex-research-host.cjs');

function base(patch={}){return {processStarted:true,toolDiscoveryObserved:true,firstEventAt:'2026-01-01T00:00:00.000Z',
 webEventCount:1,structuredOutputPresent:true,exitCode:0,timedOut:false,stderrClass:'',...patch};}

test('host probe classifies process start, authentication, network and timeout independently',()=>{
 assert.equal(classifyProbeResult(base({processStarted:false,toolDiscoveryObserved:false,webEventCount:0,structuredOutputPresent:false,exitCode:null})).failureClass,'process_start');
 assert.equal(classifyProbeResult(base({stderrClass:'authentication',webEventCount:0,structuredOutputPresent:false,exitCode:1})).failureClass,'authentication');
 assert.equal(classifyProbeResult(base({stderrClass:'network',webEventCount:0,structuredOutputPresent:false,exitCode:1})).failureClass,'network');
 assert.equal(classifyProbeResult(base({timedOut:true,toolDiscoveryObserved:false,webEventCount:0,structuredOutputPresent:false,exitCode:null})).failureClass,'timeout');
 assert.equal(classifyProbeResult(base({eventErrorClass:'model_configuration',toolDiscoveryObserved:false,webEventCount:0,structuredOutputPresent:false,exitCode:1})).failureClass,'model_configuration');
});

test('host probe distinguishes missing discovery, no tool call, output protocol and success',()=>{
 assert.equal(classifyProbeResult(base({toolDiscoveryObserved:false,webEventCount:0,structuredOutputPresent:false,exitCode:0})).failureClass,'tool_discovery');
 assert.equal(classifyProbeResult(base({webEventCount:0,structuredOutputPresent:true,exitCode:0})).failureClass,'model_no_tool_call');
 assert.equal(classifyProbeResult(base({structuredOutputPresent:false,exitCode:0})).failureClass,'output_protocol');
 assert.equal(classifyProbeResult(base()).failureClass,'none');
});

test('host probe contract rejects missing evidence fields instead of guessing',()=>{
 assert.throws(()=>validateProbeResult({processStarted:true}),/PROBE_EVIDENCE_INCOMPLETE/);
 const result=validateProbeResult({...base(),failureClass:'none',evidenceFiles:['events.json','process-tree.json']});
 assert.equal(result.failureClass,'none');
});
