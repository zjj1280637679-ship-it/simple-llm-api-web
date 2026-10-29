import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { validateHosts, loadResourceRevisions } from '../../scripts/module-library.mjs';

export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==';
export const imageReply = {data:[{b64_json:PNG}]};
export const textReply = text => ({choices:[{message:{role:'assistant',content:text}}]});
export function scriptedFetch(responses) {
  const pending = [...responses], requests = [];
  return {requests, remaining:()=>pending.length, fetchImpl:async (url,options)=>{
    assert(pending.length,'Unexpected extra request');
    requests.push({url,method:options.method,body:JSON.parse(options.body)});
    return new Response(JSON.stringify(pending.shift()),{status:200});
  }};
}
export function parseOptions(args) {
  const options = {live:false,prompt:'Draw one blue cup on a white background.'};
  const seen = new Set();
  for (let i=0;i<args.length;i++) {
    const key=args[i];
    if (seen.has(key)) throw Error('Duplicate option: '+key);
    seen.add(key);
    if (key==='--live') options.live=true;
    else if (key==='--help') options.help=true;
    else if (['--prompt','--out','--simulator','--profile','--dir','--revision','--sample-index','--live-plan'].includes(key) && args[i+1] && !args[i+1].startsWith('--')) options[key.slice(2)]=args[++i];
    else throw Error('Use --live, --prompt TEXT, --out DIRECTORY, --simulator ark|gemini, --profile ID, --dir DIRECTORY, --revision N, --sample-index N, --live-plan FILE, or --help');
  }
  options.promptSpecified=seen.has('--prompt');
  if(options.simulator!==undefined&&!['ark','gemini'].includes(options.simulator))throw Error('Unknown simulator');
  if(options.live&&options.simulator)throw Error('Choose live or simulated mode, not both');
  if(options['live-plan']&&!options.live)throw Error('--live-plan requires --live');
  for(const key of ['revision','sample-index'])if(options[key]!==undefined) {
    if(!/^(0|[1-9]\d*)$/.test(options[key])||!Number.isSafeInteger(Number(options[key]))||(key==='revision'&&Number(options[key])<1))throw Error('Invalid simulator revision/sample index');
    options[key]=Number(options[key]);
  }
  if(['profile','dir','revision','sample-index'].some(key=>options[key]!==undefined)&&!options.simulator)throw Error('Profile options require --simulator');
  if(['dir','revision','sample-index'].some(key=>options[key]!==undefined)&&!options.profile)throw Error('Revision/store options require --profile');
  return options;
}
export async function persistImages(result, options) {
  assert(result.images?.length>0,'No image result');
  const base=options.out?resolve(options.out):tmpdir();
  await mkdir(base,{recursive:true});
  const directory=await mkdtemp(join(base,'module-host-'));
  const files=[];
  for (let i=0;i<result.images.length;i++) {
    const image=result.images[i];
    const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[image.mimeType];
    assert(ext,'Unsupported image format');
    const bytes=Buffer.from(image.data,'base64');
    assert(bytes.length>0,'Empty image bytes');
    const path=join(directory,'image-'+(i+1)+'.'+ext);
    await writeFile(path,bytes,{flag:'wx'});
    assert.deepEqual(await readFile(path),bytes,'File readback differs from response');
    files.push({path,mimeType:image.mimeType,bytes:bytes.length});
  }
  return files;
}

export async function runHost(moduleId, exercise) {
  const secrets=[], runStartedAt=new Date().toISOString();
  let metadata={moduleId}, previousFetch, guarded=false;
  try {
    const catalog=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
    const registry=JSON.parse(await readFile(new URL('./catalog.json',import.meta.url),'utf8'));
    const module=catalog.modules.find(m=>m.id===moduleId);
    const host=registry.hosts.find(h=>h.id===module?.host.id);
    assert(module && host,'Unknown module host');
    await validateHosts({modules:[module]},{schemaVersion:1,hosts:[host]});
    const resourceRevisions=host.resourceLock?await loadResourceRevisions(catalog,[host]):[];
    const options=parseOptions(process.argv.slice(2));
    const mode=options.live?'live':host.defaultMode;
    if(options.simulator&&!['F-002','F-003'].includes(moduleId))throw Error('Simulator selection is supported only by text/image hosts');
    if(options.simulator==='gemini'&&moduleId==='F-003')throw Error('Gemini selection is supported only by the text host');
    metadata={module:{id:module.id,version:module.version},host:{id:host.id,version:host.version,
      createdAt:host.createdAt,updatedAt:host.updatedAt},mode,effect:host.goal,lifecycle:module.lifecycle.state,resourceRevisions:mode==='live'?[]:resourceRevisions};
    if (options.help) {
      console.log(JSON.stringify({...metadata,usage:'node '+host.entry+' [--simulator ark|gemini --profile ID --dir DIRECTORY --revision N --sample-index N] [--live --live-plan FILE] [--prompt TEXT] [--out DIRECTORY]',supportedModes:host.modes},null,2));
      return;
    }
    assert(host.modes.includes(mode),'Live mode is not applicable to this host');
    const realFetch=globalThis.fetch;
    if (mode!=='live') {
      previousFetch=realFetch; guarded=true;
      globalThis.fetch=()=>{throw Error('Unexpected real network in a local/synthetic host');};
    }
    // Local state routing does not need an image/text provider or its shared state.
    const provider=moduleId==='R-002'?null:moduleId==='F-001'
      ?await import('../../src/image-capabilities.js'):await import('../../src/core.js');
    const config=kind=>{
      if (mode!=='live') return {protocol:'ark',url:'https://host.example.com/api/v3',trustedTarget:'https://host.example.com/api/v3',
        key:'synthetic-host-key',model:kind==='image'?provider.ARK_FLASH_MODEL:provider.ARK_TEXT_MODEL};
      const key=process.env.ARK_API_KEY || '';
      if (!key.trim()) throw Error('Live mode requires ARK_API_KEY');
      secrets.push(key);
      const endpoint=provider.canonicalEndpoint(process.env.ARK_BASE_URL || provider.ARK_ENDPOINT);
      return {protocol:'ark',url:endpoint,trustedTarget:endpoint,key,
        model:kind==='image'?(process.env.ARK_IMAGE_MODEL || provider.ARK_FLASH_MODEL):(process.env.ARK_TEXT_MODEL || provider.ARK_TEXT_MODEL)};
    };
    const observed=await exercise({mode,options,config,realFetch,signal:AbortSignal.timeout(120000)});
    console.log(JSON.stringify({schemaVersion:1,status:'PASS',...metadata,verifiedAt:new Date().toISOString(),runStartedAt,runFinishedAt:new Date().toISOString(),
      resourceRevisions:observed.simulation?.resourceRevisions.map(revision=>({...metadata.resourceRevisions.find(locked=>locked.resourceId===revision.resourceId&&locked.scenarioId===revision.scenarioId),...revision}))||[],
      evidenceType:observed.liveProbe?.evidenceType||(mode==='synthetic'?'SIMULATED':mode==='live'?'LIVE_RUN':'LOCAL'),realApiCalled:observed.liveProbe?.realApiCalled??(mode==='live'),observed,limits:host.limits},null,2));
  } catch (error) {
    let message=error.message || 'Host failed';
    for (const key of secrets) message=message.split(key).join('[REDACTED]');
    console.log(JSON.stringify({schemaVersion:1,status:'FAIL',...metadata,verifiedAt:new Date().toISOString(),message,...(error.liveProbe?{liveProbe:error.liveProbe,realApiCalled:error.liveProbe.realApiCalled,evidenceType:error.liveProbe.evidenceType}:{})},null,2));
    process.exitCode=1;
  } finally {if(guarded) globalThis.fetch=previousFetch;}
}

/** Select a provider resource without changing production adapters or the default host path. */
export async function hostSimulator(options,kind='text') {
  const provider=options.simulator||'gemini';
  const api=await import(`../test-resources/${provider}-native/index.mjs`);
  let now=0,next=0;const jobs=new Map();
  const scheduler={setTimeout(callback,ms){const id=++next;jobs.set(id,true);queueMicrotask(()=>{if(jobs.delete(id)){now+=ms;callback();}});return id;},clearTimeout(id){jobs.delete(id);}};
  let sim,prompt=options.prompt,model=kind==='image'?api.IMAGE_MODEL:undefined;
  if(options.profile) {
    const {createConfigurationStore}=await import(`../test-resources/${provider}-native/configuration.mjs`);
    const store=createConfigurationStore(options.dir?{directory:options.dir}:{});
    sim=await store.start(options.profile,{revision:options.revision,sampleIndex:options['sample-index']??0,clock:()=>now,scheduler});
    const snapshot=sim.snapshot(),parameters=snapshot.configuration.parameters;
    if(snapshot.configuration.scenario!==(kind==='image'?'image.output':'text.ok'))throw Error('Host profile scenario does not match single-request effect');
    if(options.promptSpecified&&options.prompt!==parameters.prompt)throw Error('Host prompt differs from pinned profile; update the profile first');
    prompt=parameters.prompt;model=parameters.model??model;
  } else {
    const create=provider==='ark'?api.createArkSimulator:api.createGeminiSimulator;
    sim=create({scenario:kind==='image'?'image.output':'text.ok',parameters:{prompt},clock:()=>now,scheduler});
  }
  return {sim,prompt,config:api.simulatorConfig(model),virtualTime:true,
    imageOptions:kind==='image'?{imageSize:'1.5K',aspectRatio:'1:1'}:{}};
}
/** Live F-002/F-003 requires a separate expiring user-approved one-call plan. */
export async function hostLiveProbe(options,operation) {
  if(!process.env.ARK_API_KEY?.trim())throw Error('Live mode requires ARK_API_KEY');
  if(!options['live-plan'])throw Error('Live mode requires --live-plan with exact model, one request, output limit, cost estimate and user approval');
  let plan;try{plan=JSON.parse(await readFile(options['live-plan'],'utf8'));}catch{throw Error('Invalid live plan file');}
  if(plan.operation!==operation)throw Error('Live plan operation does not match host');
  if(options.promptSpecified&&options.prompt!==plan.prompt)throw Error('Host prompt differs from approved live plan');
  const {runArkLiveProbe}=await import('../test-resources/ark-native/live.mjs');
  const liveProbe=await runArkLiveProbe({enabled:true,plan});
  if(liveProbe.status!=='PASS') {const error=new Error(liveProbe.code);error.liveProbe=liveProbe;throw error;}
  return {liveProbe,requestMappingChecked:false,realNetworkRequests:liveProbe.attemptedRequests};
}
