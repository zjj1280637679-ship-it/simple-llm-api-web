import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConfigurationStore,getConfigurationPreset} from '../module-library/test-resources/ark-native/configuration.mjs';
import {getManifest} from '../module-library/test-resources/ark-native/index.mjs';
import {runArkLiveProbe,validateLivePlan,ARK_LIVE_ENDPOINT} from '../module-library/test-resources/ark-native/live.mjs';
import {main as cli} from '../scripts/ark-simulator.mjs';
const exec=promisify(execFile),root=new URL('../',import.meta.url).pathname;
const cleanEnv={...process.env,ARK_API_KEY:'',ARK_BASE_URL:'https://untrusted.invalid'};
const now=Date.parse('2026-10-29T08:30:00.000Z');
const plan=(operation='text')=>({schemaVersion:1,operation,model:operation==='text'?'doubao-seed-2-1-lite-260915':'doubao-seedream-5-0-flash-260915',
  prompt:'只回复 OK',maxRequests:1,maxCostCny:0.01,estimatedCostCny:0.01,approved:true,approvalId:'unit-test-only',
  approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),
  ...(operation==='text'?{maxOutputTokens:256,thinking:{type:'disabled'}}:{size:'1536x1536',maxCostCny:0.12,estimatedCostCny:0.12})});
const setup=async t=>{const dir=await mkdtemp(join(tmpdir(),'ark-host-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;};
const host=async (moduleId,args=[])=>JSON.parse((await exec(process.execPath,['scripts/module-host.mjs',moduleId,...args],{cwd:root,env:cleanEnv,timeout:10000})).stdout);

test('Ark CLI reuses shared commands and previews every scenario without real transport',async t=>{
  const dir=await setup(t);
  for(const scenario of getManifest().scenarios) {
    await cli(['restore','--dir',dir,'--profile','all','--scenario',scenario.id]);
    const result=await cli(['replay','--dir',dir,'--profile','all']);
    assert.equal(result.simulation.evidenceType,'SIMULATED');assert.equal(result.simulation.realApiCalled,false);
    assert.equal(result.simulation.remaining,0);assert.equal(result.simulation.active,0);
    assert.equal(result.simulation.resourceRevisions[0].resourceId,'TR-ARK-001');
  }
});
test('Ark text host pins configured revision, prompt, seed and virtual speed; default Gemini stays unchanged',async t=>{
  const dir=await setup(t),store=createConfigurationStore({directory:dir}),config=getConfigurationPreset();
  config.parameters.prompt='Configured host prompt';config.output.presets[0].text='Custom Ark answer';
  config.output.presets[0].usage={prompt_tokens:2,completion_tokens:4,total_tokens:6};
  config.timing={latencyMs:20,tokensPerSecond:2};await store.load('demo',config);
  await store.set('demo',{output:{presets:[{...config.output.presets[0],text:'Later answer'}]}});
  const result=await host('F-002',['--simulator','ark','--profile','demo','--dir',dir,'--revision','1','--sample-index','7']);
  assert.equal(result.observed.text,'Custom Ark answer');assert.equal(result.evidenceType,'SIMULATED');assert.equal(result.realApiCalled,false);
  assert.equal(result.resourceRevisions[0].resourceId,'TR-ARK-001');assert.equal(result.observed.simulation.configurationRevision.revision,1);
  assert.equal(result.observed.simulation.configurationDecision.totalDelayMs,2020);
  assert.equal(result.observed.simulation.configurationDecision.sampleIndex,7);
  const gemini=await host('F-002');assert.equal(gemini.observed.text,'Host text reply.');assert.equal(gemini.resourceRevisions[0].resourceId,'TR-GEMINI-001');assert.equal(gemini.resourceRevisions.length,1);
});
test('Ark image host uses strict PNG scenario, configured snapshot and unchanged production adapter',async t=>{
  const dir=await setup(t),store=createConfigurationStore({directory:dir});await store.restore('image',{scenario:'image.output'});
  const result=await host('F-003',['--simulator','ark','--profile','image','--dir',dir,'--out',dir]);
  assert.equal(result.evidenceType,'SIMULATED');assert.equal(result.realApiCalled,false);assert.equal(result.observed.requestedSize,'1536x1536');
  assert.equal(result.resourceRevisions[0].resourceId,'TR-ARK-001');assert.equal(result.observed.simulation.configurationRevision.revision,1);
  const bytes=await readFile(result.observed.files[0].path);assert.equal(bytes.readUInt32BE(16),1536);assert.equal(bytes.readUInt32BE(20),1536);
});
test('host rejects ambiguous simulator/live/profile options without network',async()=>{
  for(const args of [['--simulator','other'],['--simulator','ark','--live'],['--profile','demo'],['--simulator','ark','--revision','1']]) {
    await assert.rejects(host('F-002',args),error=>JSON.parse(error.stdout).status==='FAIL');
  }
});
test('live probe defaults off and validates fresh exact one-call approval before reading credentials',async()=>{
  const denied=new Proxy({}, {get(){throw Error('ENV_MUST_NOT_BE_READ');}});
  await assert.rejects(runArkLiveProbe({plan:plan(),environment:denied}),{code:'ARK_LIVE_DISABLED'});
  for(const patch of [{approved:false},{maxRequests:2},{maxCostCny:0.001},{model:'https://evil.invalid'},{expiresAt:new Date(now).toISOString()},{maxOutputTokens:1025},{thinking:{type:'enabled'}},{endpoint:'https://evil.invalid'}]) {
    await assert.rejects(runArkLiveProbe({enabled:true,plan:{...plan(),...patch},environment:denied,now:()=>now}),error=>error.code?.startsWith('ARK_LIVE_'));
  }
  assert.equal(validateLivePlan(plan(),{now}).maxRequests,1);
  for(const key of ['SIMULATOR_ONLY_NOT_A_REAL_KEY','  SIMULATOR_ONLY_NOT_A_REAL_KEY  '])await assert.rejects(runArkLiveProbe({enabled:true,plan:plan(),environment:{ARK_API_KEY:key},now:()=>now}),{code:'ARK_LIVE_DUMMY_KEY'});
});
test('fake live text transport verifies official URL, explicit limits and reports SIMULATED, not real evidence',async()=>{
  const requests=[];const denied=new Proxy({}, {get(){throw Error('ENV_MUST_NOT_BE_READ');}});
  const result=await runArkLiveProbe({enabled:true,plan:plan(),environment:denied,now:()=>now,testTransport:async(url,options)=>{
    requests.push({url,options});return new Response(JSON.stringify({choices:[{message:{content:'OK'}}],usage:{prompt_tokens:3,completion_tokens:1,total_tokens:4}}));
  }});
  assert.equal(requests.length,1);assert.equal(requests[0].url,ARK_LIVE_ENDPOINT+'/chat/completions');
  assert.equal(requests[0].options.redirect,'error');assert.equal(requests[0].options.credentials,'omit');
  assert.deepEqual(JSON.parse(requests[0].options.body),{model:plan().model,messages:[{role:'user',content:'只回复 OK'}],stream:false,max_completion_tokens:256,thinking:{type:'disabled'}});
  assert.equal(result.mode,'live');assert.equal(result.status,'PASS');assert.equal(result.evidenceType,'SIMULATED');assert.equal(result.realApiCalled,false);
  assert.equal(result.transport,'test-double');assert.equal(result.attemptedRequests,1);assert.equal(result.observed.textCharacters,2);
  assert.equal(result.costLimitType,'preflight-estimate-only-not-provider-billing-cap');
  assert(!JSON.stringify(result).includes('只回复'));assert(!JSON.stringify(result).includes('SIMULATOR_ONLY_NOT_A_REAL_KEY'));
});
test('fake live failure has no retries, fallback or upstream secrets in reports',async()=>{
  for(const transport of [()=>{throw Error('SECRET upstream URL prompt key');},()=>new Response('SECRET upstream body',{status:429}),()=>new Response('not-json SECRET')]) {
    let calls=0;const result=await runArkLiveProbe({enabled:true,plan:plan(),now:()=>now,testTransport:async(...args)=>{calls++;return transport(...args);}});
    assert.equal(calls,1);assert.equal(result.status,'FAIL');assert.equal(result.retries,0);assert.equal(result.fallbacks,0);assert.equal(result.realApiCalled,false);assert(!JSON.stringify(result).includes('SECRET'));
  }
});
test('fake live image validates whole PNG and rejects truncation or extra images',async()=>{
  const config=getConfigurationPreset('image.output'),png=config.output.presets[0].b64Json;
  for(const [data,expected] of [[[{b64_json:png,output_format:'png'}],'PASS'],[[{b64_json:Buffer.from(png,'base64').subarray(0,24).toString('base64')}],'FAIL'],[[{b64_json:png},{b64_json:png}],'FAIL']]) {
    let calls=0;const result=await runArkLiveProbe({enabled:true,plan:plan('image'),now:()=>now,testTransport:async(url,options)=>{
      calls++;assert.equal(url,ARK_LIVE_ENDPOINT+'/images/generations');assert.equal(JSON.parse(options.body).size,'1536x1536');return new Response(JSON.stringify({data}));
    }});assert.equal(calls,1);assert.equal(result.status,expected);assert.equal(result.realApiCalled,false);
  }
});
test('fake live cancellation does not retry or consume a pre-aborted request',async()=>{
  let calls=0;const controller=new AbortController();controller.abort();
  await assert.rejects(runArkLiveProbe({enabled:true,plan:plan(),now:()=>now,signal:controller.signal,testTransport:async()=>{calls++;}}),{code:'ARK_LIVE_CANCELLED_BEFORE_REQUEST'});assert.equal(calls,0);
  const active=new AbortController();const promise=runArkLiveProbe({enabled:true,plan:plan(),now:()=>now,signal:active.signal,testTransport:async(_url,{signal})=>{
    calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});active.abort();const result=await promise;assert.equal(result.code,'ARK_LIVE_CANCELLED');assert.equal(calls,1);
});
