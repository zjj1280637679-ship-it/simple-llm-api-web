/** Editable local simulator profiles. No network, eval, credential, or production builder dependency. */
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readdir, readFile, writeFile, link, unlink, lstat} from 'node:fs/promises';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getManifest, getFixture, SimulatorError} from './index.mjs';
import {createSimulatorCore} from './core.js';
export const CONFIGURATION_API_VERSION='0.2.0';
export const CONFIGURATION_SCHEMA_VERSION='1.0.0';
const textScenarios=new Set(['text.ok','transport.delay','transport.hang']);
const clone=value=>structuredClone(value);
const fail=field=>{throw new SimulatorError('SIMULATOR_CONFIGURATION',[field]);};
const canonical=value=>JSON.stringify(value && typeof value==='object' ? Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])) : value);
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
function shape(value,keys,field) {
  if(!plain(value) || Object.keys(value).length!==keys.length || keys.some(key=>!Object.hasOwn(value,key))) fail(field);
}
const string=(value,field,max=8192,empty=false)=>{if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))fail(field);};
const integer=(value,min,max,field)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail(field);};
const number=(value,min,max,field)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(field);};
const id=(value,field)=>{if(typeof value!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(value))fail(field);};
function usage(value,field) {
  shape(value,['promptTokenCount','candidatesTokenCount','totalTokenCount'],field);
  for(const key of Object.keys(value))integer(value[key],0,10000000,field+'.'+key);
  if(value.totalTokenCount!==value.promptTokenCount+value.candidatesTokenCount)fail(field+'.totalTokenCount');
}
function errorConfig(value) {
  shape(value,['httpStatus','status','message'],'error');integer(value.httpStatus,400,599,'error.httpStatus');
  if(typeof value.status!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(value.status))fail('error.status');
  string(value.message,'error.message');
}
function resourceRevision(scenario) {
  const manifest=getManifest();
  if(manifest.configurationApiVersion!==CONFIGURATION_API_VERSION||manifest.configurationSchemaVersion!==CONFIGURATION_SCHEMA_VERSION)fail('resource.configurationVersion');
  const entry=manifest.scenarios.find(value=>value.id===scenario);
  if(!entry)fail('scenario');
  const fixture=manifest.fixtures.find(value=>value.id===entry.fixtureId);
  return {resourceId:manifest.resourceId,resourceVersion:manifest.resourceVersion,scenarioId:scenario,
    scenarioVersion:entry.version,fixtureSetVersion:manifest.fixtureSetVersion,fixtureSha256:fixture.sha256,
    protocolSnapshot:manifest.protocolSnapshot};
}
export function getConfigurationPreset(scenario='text.ok') {
  resourceRevision(scenario);const fixture=getFixture(scenario),response=fixture.steps[0].response;
  const config={schemaVersion:CONFIGURATION_SCHEMA_VERSION,scenario,
    parameters:Object.fromEntries(Object.entries(fixture.parameters||{}).map(([key,value])=>[key,value.default])),
    seed:1,timing:{latencyMs:response.delayMs||0,tokensPerSecond:0}};
  if(textScenarios.has(scenario)) {
    config.output={presets:[{id:'default',matchPrompt:null,text:response.json.candidates[0].content.parts[0].text,
      usage:clone(response.json.usageMetadata)}],selectedPresetId:'default',fallbackPresetId:'default',missBehavior:'fallback'};
    config.probabilities={presetHit:1,success:1,cacheHit:0};
    config.error={httpStatus:429,status:'RESOURCE_EXHAUSTED',message:'SIMULATED configured error'};
  } else if(scenario.startsWith('http.')) {
    config.error={httpStatus:response.status,status:response.json.error.status,message:response.json.error.message};
  }
  return validateConfiguration(config);
}
export function validateConfiguration(input) {
  if(!plain(input))fail('configuration');
  const isText=textScenarios.has(input.scenario),isHttp=typeof input.scenario==='string'&&input.scenario.startsWith('http.');
  shape(input,['schemaVersion','scenario','parameters','seed','timing',...(isText?['output','probabilities','error']:isHttp?['error']:[])],'configuration');
  if(input.schemaVersion!==CONFIGURATION_SCHEMA_VERSION)fail('schemaVersion');
  resourceRevision(input.scenario);const fixture=getFixture(input.scenario);
  shape(input.parameters,Object.keys(fixture.parameters||{}),'parameters');
  for(const [key,value] of Object.entries(input.parameters))string(value,'parameters.'+key);
  integer(input.seed,0,4294967295,'seed');
  shape(input.timing,['latencyMs','tokensPerSecond'],'timing');
  integer(input.timing.latencyMs,0,3600000,'timing.latencyMs');
  number(input.timing.tokensPerSecond,0,1000000,'timing.tokensPerSecond');
  if(input.timing.tokensPerSecond>0&&input.timing.tokensPerSecond<0.001)fail('timing.tokensPerSecond');
  if(!isText&&input.timing.tokensPerSecond!==0)fail('timing.tokensPerSecond');
  if(['transport.reject','transport.hang'].includes(input.scenario) && (input.timing.latencyMs!==0||input.timing.tokensPerSecond!==0))fail('timing');
  if(isText) {
    shape(input.output,['presets','selectedPresetId','fallbackPresetId','missBehavior'],'output');
    if(!Array.isArray(input.output.presets)||!input.output.presets.length||input.output.presets.length>100)fail('output.presets');
    const seen=new Set();
    for(const preset of input.output.presets) {
      shape(preset,['id','matchPrompt','text','usage'],'output.presets');id(preset.id,'output.presets.id');
      if(seen.has(preset.id))fail('output.presets.id');seen.add(preset.id);
      if(preset.matchPrompt!==null)string(preset.matchPrompt,'output.presets.matchPrompt');
      string(preset.text,'output.presets.text',65536,true);usage(preset.usage,'output.presets.usage');
      const generationMs=input.timing.tokensPerSecond?Math.ceil(preset.usage.candidatesTokenCount/input.timing.tokensPerSecond*1000):0;
      if(generationMs+input.timing.latencyMs>3600000)fail('timing.duration');
    }
    if(!seen.has(input.output.selectedPresetId)||!seen.has(input.output.fallbackPresetId))fail('output.presetReference');
    if(!['fallback','error'].includes(input.output.missBehavior))fail('output.missBehavior');
    shape(input.probabilities,['presetHit','success','cacheHit'],'probabilities');
    for(const [key,value] of Object.entries(input.probabilities))number(value,0,1,'probabilities.'+key);
  }
  if(isText||isHttp)errorConfig(input.error);
  return clone(input);
}
function merge(base,patch) {
  if(!plain(patch))fail('patch');
  const result=clone(base);
  for(const [key,value] of Object.entries(patch)) {
    if(!Object.hasOwn(base,key))fail('patch.'+key);
    result[key]=plain(value)&&plain(base[key])?merge(base[key],value):clone(value);
  }
  return result;
}
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function makeSnapshot(profileId,config,previous,reason) {
  id(profileId,'profileId');const configuration=validateConfiguration(config);
  const revision=(previous?.revision||0)+1;integer(revision,1,99999999,'revision');
  const now=new Date(Math.max(Date.now(),previous?Date.parse(previous.updatedAt)+1:0)).toISOString();
  const snapshot={schemaVersion:CONFIGURATION_SCHEMA_VERSION,apiVersion:CONFIGURATION_API_VERSION,profileId,revision,
    version:`1.0.${revision-1}`,createdAt:previous?.createdAt||now,updatedAt:now,reason,
    parentSha256:previous?.snapshotSha256||null,configuration,configurationSha256:hash(configuration),
    resourceRevision:resourceRevision(configuration.scenario)};
  return {...snapshot,snapshotSha256:hash(snapshot)};
}
export function validateConfigurationSnapshot(input) {
  shape(input,['schemaVersion','apiVersion','profileId','revision','version','createdAt','updatedAt','reason','parentSha256','configuration','configurationSha256','resourceRevision','snapshotSha256'],'snapshot');
  const {snapshotSha256,...unsigned}=input;
  if(input.schemaVersion!==CONFIGURATION_SCHEMA_VERSION||input.apiVersion!==CONFIGURATION_API_VERSION||hash(unsigned)!==snapshotSha256)fail('snapshot.integrity');
  id(input.profileId,'profileId');integer(input.revision,1,99999999,'revision');
  if(input.version!==`1.0.${input.revision-1}`||!stamp(input.createdAt)||!stamp(input.updatedAt)||input.updatedAt<input.createdAt)fail('snapshot.revision');
  if(!['set','load','restore-preset','restore-revision'].includes(input.reason))fail('snapshot.reason');
  if((input.revision===1&&input.parentSha256!==null)||(input.revision>1&&!/^[a-f0-9]{64}$/.test(input.parentSha256)))fail('snapshot.parent');
  const config=validateConfiguration(input.configuration);
  if(hash(config)!==input.configurationSha256||canonical(resourceRevision(config.scenario))!==canonical(input.resourceRevision))fail('snapshot.binding');
  return clone(input);
}
function freeze(value) {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export function resolveConfiguration(snapshot,{sampleIndex=0}={}) {
  snapshot=validateConfigurationSnapshot(snapshot);integer(sampleIndex,0,Number.MAX_SAFE_INTEGER,'sampleIndex');
  const config=snapshot.configuration,fixture=getFixture(config.scenario),response=fixture.steps[0].response;
  const draw=label=>createHash('sha256').update(`gemini-config-v1:${config.seed}:${sampleIndex}:${label}`).digest().readUInt32BE(0)/4294967296;
  const decision={seed:config.seed,sampleIndex,mode:'non-streaming',scenario:config.scenario,
    latencyMs:config.timing.latencyMs,generationMs:0,totalDelayMs:config.timing.latencyMs};
  if(textScenarios.has(config.scenario)) {
    const draws={presetHit:draw('presetHit'),success:draw('success'),cacheHit:draw('cacheHit')};
    const selected=config.output.presets.find(value=>value.id===config.output.selectedPresetId);
    const promptMatches=selected.matchPrompt===null||selected.matchPrompt===config.parameters.prompt;
    const presetHit=promptMatches&&draws.presetHit<config.probabilities.presetHit;
    const preset=config.output.presets.find(value=>value.id===(presetHit?selected.id:config.output.fallbackPresetId));
    const success=draws.success<config.probabilities.success&&(presetHit||config.output.missBehavior!=='error');
    const cacheHit=success&&draws.cacheHit<config.probabilities.cacheHit;
    Object.assign(decision,{draws,promptMatches,presetHit,presetId:success?preset.id:null,success,cacheHit,syntheticCacheOnly:true});
    if(success) {
      response.json.candidates[0].content.parts=[{text:preset.text}];response.json.usageMetadata=clone(preset.usage);
      if(cacheHit)response.json.usageMetadata.cachedContentTokenCount=preset.usage.promptTokenCount;
      decision.generationMs=config.timing.tokensPerSecond?Math.ceil(preset.usage.candidatesTokenCount/config.timing.tokensPerSecond*1000):0;
    } else {response.status=config.error.httpStatus;response.json={error:{code:config.error.httpStatus,status:config.error.status,message:config.error.message}};}
  } else if(config.error) {
    response.status=config.error.httpStatus;response.json={error:{code:config.error.httpStatus,status:config.error.status,message:config.error.message}};
  }
  decision.totalDelayMs+=decision.generationMs;
  // Apply latency to each scripted response; generation speed is supported for single-step text only.
  for(const step of fixture.steps) {
    delete step.response.delayMs;
    if(decision.totalDelayMs)step.response.delayMs=decision.totalDelayMs;
  }
  return {fixture,decision};
}
export function createConfiguredSimulator({snapshot,clock,scheduler,sampleIndex=0}={}) {
  const pinned=freeze(validateConfigurationSnapshot(snapshot)),{fixture,decision}=resolveConfiguration(pinned,{sampleIndex});
  const sim=createSimulatorCore({fixture,revision:pinned.resourceRevision,parameters:pinned.configuration.parameters,clock,scheduler});
  const binding={profileId:pinned.profileId,revision:pinned.revision,version:pinned.version,createdAt:pinned.createdAt,
    updatedAt:pinned.updatedAt,snapshotSha256:pinned.snapshotSha256,configurationSha256:pinned.configurationSha256,
    apiVersion:pinned.apiVersion,schemaVersion:pinned.schemaVersion};
  const report=value=>({...value,configurationRevision:clone(binding),configurationDecision:clone(decision)});
  return {fetch:sim.fetch,dispose:sim.dispose,inspect:()=>report(sim.inspect()),assertComplete:()=>report(sim.assertComplete()),
    snapshot:()=>clone(pinned),reset:()=>createConfiguredSimulator({snapshot:pinned,clock,scheduler,sampleIndex})};
}
const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const defaultDirectory=resolve(repoRoot,'output/gemini-simulator-profiles');
async function safeDirectory(directory) {
  // Check existing ancestors BEFORE creating anything, then recheck the result.
  async function inspect() {
    let cursor=resolve(directory);
    for(;;) {
      try {const stat=await lstat(cursor);if(stat.isSymbolicLink()||!stat.isDirectory())fail('store.directory');}
      catch(error){if(error.code!=='ENOENT')throw error;}
      const parent=resolve(cursor,'..');if(parent===cursor)break;cursor=parent;
    }
  }
  await inspect();await mkdir(directory,{recursive:true});await inspect();
}
export function createConfigurationStore({directory=defaultDirectory}={}) {
  if(typeof directory!=='string'||!directory)fail('store.directory');directory=resolve(directory);
  const rel=relative(repoRoot,directory),outputRel=relative(resolve(repoRoot,'output'),directory);
  if((rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'))&&(outputRel==='..'||outputRel.startsWith('..'+sep)))fail('store.checkedSource');
  const location=profileId=>{id(profileId,'profileId');return resolve(directory,profileId);};
  async function history(profileId) {
    const dir=location(profileId);await safeDirectory(directory);
    let names;try{names=await readdir(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    await safeDirectory(dir);
    names=names.filter(name=>/^\d{8}\.json$/.test(name)).sort();
    const records=[];
    for(const name of names) {
      const file=resolve(dir,name),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())fail('store.record');
      let record;try{record=validateConfigurationSnapshot(JSON.parse(await readFile(file,'utf8')));}catch{fail('store.integrity');}
      const previous=records.at(-1);
      if(record.profileId!==profileId||record.revision!==records.length+1||name!==`${String(record.revision).padStart(8,'0')}.json`||
        record.parentSha256!==(previous?.snapshotSha256||null)||(previous&&(record.createdAt!==previous.createdAt||record.updatedAt<=previous.updatedAt)))fail('store.history');
      records.push(record);
    }
    return records;
  }
  async function show(profileId='default',revision) {
    const records=await history(profileId);
    if(revision!==undefined)integer(revision,1,99999999,'revision');
    const record=revision===undefined?records.at(-1):records[revision-1];
    if(!record)throw new SimulatorError('SIMULATOR_PROFILE_NOT_FOUND');return clone(record);
  }
  async function append(profileId,build,reason) {
    const dir=location(profileId);await safeDirectory(dir);
    // Atomic no-overwrite publication; simultaneous writers retry from the new head.
    for(let attempt=0;attempt<100;attempt++) {
      const previous=(await history(profileId)).at(-1);
      const snapshot=makeSnapshot(profileId,await build(previous),previous,reason);
      const destination=resolve(dir,`${String(snapshot.revision).padStart(8,'0')}.json`),temp=resolve(dir,`.pending-${randomUUID()}`);
      await writeFile(temp,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o400});
      try {await link(temp,destination);return clone(snapshot);}
      catch(error){if(error.code!=='EEXIST')throw error;}
      finally{await unlink(temp);}
    }
    throw new SimulatorError('SIMULATOR_STORE_BUSY');
  }
  const store={directory,history,show,
    set:(profileId,patch)=>append(profileId,previous=>merge(previous?.configuration||getConfigurationPreset(),patch),'set'),
    load:(profileId,configuration)=>append(profileId,()=>validateConfiguration(configuration),'load'),
    restore:async(profileId,options={})=>{
      if(!plain(options)||Object.keys(options).some(key=>!['scenario','revision'].includes(key))||
        (options.scenario!==undefined&&options.revision!==undefined))fail('restore.selection');
      const {scenario='text.ok',revision}=options;
      return append(profileId,async()=>revision===undefined?getConfigurationPreset(scenario):(await show(profileId,revision)).configuration,revision===undefined?'restore-preset':'restore-revision');
    },
    save:async(profileId,file,{revision}={})=>{const snapshot=await show(profileId,revision);await writeFile(file,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});return snapshot;},
    start:async(profileId,{revision,...options}={})=>createConfiguredSimulator({snapshot:await show(profileId,revision),...options}),
    reset:async(profileId,options)=>store.start(profileId,options)};
  return store;
}
