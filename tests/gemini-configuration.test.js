import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createConfigurationStore,getConfigurationPreset,validateConfiguration,validateConfigurationSnapshot,createConfiguredSimulator,resolveConfiguration} from '../module-library/test-resources/gemini-native/configuration.mjs';
import {getManifest,simulatorConfig} from '../module-library/test-resources/gemini-native/index.mjs';
import {generateText} from '../module-library/functions/text-generation/index.js';
import {main as cli} from '../scripts/gemini-simulator.mjs';
const root=new URL('../',import.meta.url);
globalThis.fetch=()=>{throw Error('Real network forbidden in configuration tests');};
async function setup(t) {const directory=await mkdtemp(join(tmpdir(),'gemini-config-'));t.after(()=>rm(directory,{recursive:true,force:true}));return createConfigurationStore({directory});}
const configError={code:'SIMULATOR_CONFIGURATION'};
const preset=(id,text,matchPrompt=null)=>({id,text,matchPrompt,usage:{promptTokenCount:3,candidatesTokenCount:5,totalTokenCount:8}});
const custom=()=>{const value=getConfigurationPreset();value.parameters.prompt='你好';value.output.presets=[preset('default','Fallback.'),preset('hello','自定义回复','你好')];value.output.selectedPresetId='hello';return value;};
const run=sim=>generateText({config:simulatorConfig(),messages:[{role:'user',content:sim.snapshot().configuration.parameters.prompt}],fetchImpl:sim.fetch});
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
function time() {let now=0,id=0;const jobs=new Map();return {clock:()=>now,setTimeout(fn,ms){jobs.set(++id,{fn,at:now+ms});return id;},clearTimeout(id){jobs.delete(id);},tick(ms){now+=ms;for(const [id,job]of [...jobs])if(job.at<=now){jobs.delete(id);job.fn();}},size:()=>jobs.size};}
test('configuration presets cover all 17 frozen scenarios without mutating fixture source',()=>{
  for(const entry of getManifest().scenarios){const value=getConfigurationPreset(entry.id);assert.equal(validateConfiguration(value).scenario,entry.id);}
  const a=getConfigurationPreset();a.output.presets[0].text='changed';assert.equal(getConfigurationPreset().output.presets[0].text,'Host text reply.');
});
test('editable presets drive unchanged actual Gemini adapter; usage and synthetic cache are observable',async t=>{
  const store=await setup(t),config=custom();config.probabilities.cacheHit=1;
  const snapshot=await store.load('demo',config),sim=await store.start('demo');
  assert.equal((await run(sim)).text,'自定义回复');const report=sim.assertComplete();
  assert.equal(report.configurationRevision.snapshotSha256,snapshot.snapshotSha256);
  assert.equal(report.configurationDecision.presetHit,true);assert.equal(report.configurationDecision.cacheHit,true);
  assert.equal(resolveConfiguration(snapshot).fixture.steps[0].response.json.usageMetadata.cachedContentTokenCount,3);
  assert.equal(report.realApiCalled,false);
});
test('set is versioned object merge; active runtime pins old snapshot; caller mutations cannot change it',async t=>{
  const store=await setup(t),first=await store.restore('demo'),active=await store.start('demo');
  first.configuration.output.presets[0].text='tampered';active.snapshot().configuration.output.presets[0].text='tampered';
  const second=await store.set('demo',{output:{presets:[preset('default','New output')]},seed:2});
  assert.equal(second.revision,2);assert.equal(second.version,'1.0.1');assert(second.updatedAt>second.createdAt);
  assert.equal(second.parentSha256,(await store.show('demo',1)).snapshotSha256);
  assert.equal((await run(active)).text,'Host text reply.');assert.equal((await run(await store.start('demo'))).text,'New output');
  assert.equal(active.assertComplete().configurationRevision.revision,1);
});
test('reset creates empty independent runtime; restore preset and prior revision both append history',async t=>{
  const store=await setup(t);await store.load('demo',custom());const old=await store.start('demo');await run(old);
  const reset=old.reset();assert.equal(reset.inspect().consumed,0);assert.equal(old.inspect().consumed,1);
  assert.equal(reset.snapshot().snapshotSha256,old.snapshot().snapshotSha256);await run(reset);
  const restored=await store.restore('demo');assert.equal(restored.revision,2);assert.equal((await run(await store.reset('demo'))).text,'Host text reply.');
  await assert.rejects(store.restore('demo',{revision:1,scenario:'text.ok'}),configError);
  const restoredOld=await store.restore('demo',{revision:1});assert.equal(restoredOld.revision,3);assert.equal(restoredOld.reason,'restore-revision');
  assert.equal((await run(await store.start('demo'))).text,'自定义回复');assert.equal((await store.history('demo')).length,3);
});
test('exact prompt misses use fallback or explicit HTTP error; rate endpoints are exact',async t=>{
  const store=await setup(t),config=custom();config.output.presets[1].matchPrompt='Other prompt';
  let snapshot=await store.load('demo',config);let sim=createConfiguredSimulator({snapshot});assert.equal((await run(sim)).text,'Fallback.');assert.equal(sim.assertComplete().configurationDecision.presetHit,false);
  config.output.missBehavior='error';snapshot=await store.load('demo',config);sim=createConfiguredSimulator({snapshot});await assert.rejects(run(sim),{code:'HTTP'});assert.equal(sim.assertComplete().configurationDecision.success,false);
  config.output.missBehavior='fallback';config.output.presets[1].matchPrompt='你好';config.probabilities.presetHit=0;snapshot=await store.load('demo',config);assert.equal((await run(createConfiguredSimulator({snapshot}))).text,'Fallback.');
  config.probabilities.presetHit=1;config.probabilities.success=0;snapshot=await store.load('demo',config);assert.equal(resolveConfiguration(snapshot).fixture.steps[0].response.status,429);
});
test('seed + explicit sample index repeat byte-identical decisions; indices exercise probability range',async t=>{
  const store=await setup(t),config=custom();config.probabilities={presetHit:0.4,success:0.6,cacheHit:0.5};config.seed=123;
  const snapshot=await store.load('demo',config),a=resolveConfiguration(snapshot,{sampleIndex:17}),b=resolveConfiguration(snapshot,{sampleIndex:17});assert.deepEqual(a,b);
  const decisions=Array.from({length:400},(_,sampleIndex)=>resolveConfiguration(snapshot,{sampleIndex}).decision);
  assert(decisions.filter(x=>x.presetHit).length>120);assert(decisions.filter(x=>x.presetHit).length<210);
  assert(decisions.some(x=>x.success));assert(decisions.some(x=>!x.success));assert(decisions.some(x=>x.cacheHit));assert(decisions.some(x=>!x.cacheHit));
  assert.notDeepEqual(a.decision.draws,resolveConfiguration(snapshot,{sampleIndex:18}).decision.draws);
  assert.throws(()=>resolveConfiguration(snapshot,{sampleIndex:-1}),configError);
});
test('latency plus synthetic speed delays a single non-streaming response using virtual time',async t=>{
  const store=await setup(t),config=custom();config.timing={latencyMs:100,tokensPerSecond:10};const snapshot=await store.load('demo',config),clock=time();
  const sim=createConfiguredSimulator({snapshot,clock:clock.clock,scheduler:clock}),pending=run(sim);await flush();
  assert.equal(sim.inspect().pending,1);assert.equal(sim.inspect().configurationDecision.totalDelayMs,600);assert.equal(sim.inspect().configurationDecision.mode,'non-streaming');
  clock.tick(599);assert.equal(sim.inspect().pending,1);clock.tick(1);assert.equal((await pending).text,'自定义回复');assert.equal(sim.assertComplete().events.at(-1).logicalTime,600);assert.equal(clock.size(),0);
});
test('reset during pending delay does not cancel or mutate previous launch',async t=>{
  const store=await setup(t),config=custom();config.timing.latencyMs=50;const snapshot=await store.load('demo',config),clock=time();
  const active=createConfiguredSimulator({snapshot,scheduler:clock}),pending=run(active);await flush();
  const reset=active.reset();assert.equal(reset.inspect().pending,0);assert.equal(active.inspect().pending,1);
  await store.restore('demo');clock.tick(50);assert.equal((await pending).text,'自定义回复');active.assertComplete();assert.equal(reset.snapshot().revision,1);
});
test('configurable delay cancellation and hang disposal clean up; scheduler cleanup errors settle and latch',async t=>{
  const store=await setup(t),config=custom();config.timing.latencyMs=50;const snapshot=await store.load('demo',config),clock=time();
  const sim=createConfiguredSimulator({snapshot,scheduler:clock}),controller=new AbortController();
  const pending=generateText({config:simulatorConfig(),messages:[{role:'user',content:'你好'}],fetchImpl:sim.fetch,signal:controller.signal});await flush();controller.abort();await assert.rejects(pending,{code:'CANCELLED'});sim.assertComplete();assert.equal(clock.size(),0);
  const hangSnap=await store.restore('demo',{scenario:'transport.hang'}),hang=createConfiguredSimulator({snapshot:hangSnap,scheduler:clock});const hanging=run(hang);await flush();hang.dispose();await assert.rejects(hanging,{code:'NETWORK'});assert.equal(hang.inspect().pending,0);assert.throws(()=>hang.assertComplete(),{code:'SIMULATOR_ASSERTION_FAILED'});
  let callback;const broken=createConfiguredSimulator({snapshot,scheduler:{setTimeout(fn){callback=fn;return 1;},clearTimeout(){throw Error('broken');}}});const brokenPending=run(broken);await flush();callback();await assert.rejects(brokenPending,{code:'NETWORK'});assert.equal(broken.inspect().active,0);assert.throws(()=>broken.assertComplete(),{code:'SIMULATOR_ASSERTION_FAILED'});
});
test('HTTP status/message are configurable only inside error envelope scenarios',async t=>{
  const store=await setup(t);await store.restore('errors',{scenario:'http.400'});const snapshot=await store.set('errors',{error:{httpStatus:503,status:'UNAVAILABLE',message:'SIMULATED maintenance'}}),fixture=resolveConfiguration(snapshot).fixture;
  assert.equal(fixture.steps[0].response.status,503);assert.deepEqual(fixture.steps[0].response.json.error,{code:503,status:'UNAVAILABLE',message:'SIMULATED maintenance'});
  const sim=await store.start('errors');await assert.rejects(run(sim),{code:'HTTP'});sim.assertComplete();
});
test('presets never relax strict request/key contract; mismatches latch without consuming step',async t=>{
  const store=await setup(t);await store.load('demo',custom());const sim=await store.start('demo');
  await assert.rejects(generateText({config:{...simulatorConfig(),key:'REAL-KEY-MUST-NEVER-BE-USED'},messages:[{role:'user',content:'unexpected'}],fetchImpl:sim.fetch}),{code:'NETWORK'});
  assert.equal(sim.inspect().consumed,0);assert(!JSON.stringify(sim.inspect()).includes('REAL-KEY'));await run(sim);assert.throws(()=>sim.assertComplete(),{code:'SIMULATOR_ASSERTION_FAILED'});
});
test('unknown keys, unsafe IDs, bad usage/rates/timings/unsupported scopes reject without new revision',async t=>{
  const store=await setup(t);await store.restore('demo');
  const patches=[{key:'secret'},{url:'https://example.com'},{parameters:{unknown:'x'}},{probabilities:{success:-1}},{probabilities:{cacheHit:1.001}},{probabilities:{presetHit:'1'}},{seed:1.5},{timing:{latencyMs:-1}},{timing:{tokensPerSecond:0.0001}},{output:{selectedPresetId:'missing'}},{output:{presets:[preset('../escape','x')]}},{output:{presets:[{...preset('default','x'),usage:{promptTokenCount:1,candidatesTokenCount:2,totalTokenCount:999}}]}}];
  for(const patch of patches)await assert.rejects(store.set('demo',patch),configError);
  for(const id of ['../escape','a/b','A','', '__proto__'])await assert.rejects(store.restore(id),configError);
  const config=getConfigurationPreset('models.list');config.output=custom().output;assert.throws(()=>validateConfiguration(config),configError);
  const hang=getConfigurationPreset('transport.hang');hang.timing.latencyMs=1;assert.throws(()=>validateConfiguration(hang),configError);
  const huge=custom();huge.timing.tokensPerSecond=0.001;assert.throws(()=>validateConfiguration(huge),configError);
  assert.equal((await store.history('demo')).length,1);
});
test('snapshot tampering, resource binding drift and history edits fail closed',async t=>{
  const store=await setup(t),snapshot=await store.restore('demo');
  const bad=structuredClone(snapshot);bad.configuration.output.presets[0].text='tampered';assert.throws(()=>validateConfigurationSnapshot(bad),configError);
  const record=join(store.directory,'demo','00000001.json');await writeFile(record,JSON.stringify(bad),{mode:0o600}).catch(async error=>{if(error.code!=='EACCES')throw error;const {chmod}=await import('node:fs/promises');await chmod(record,0o600);await writeFile(record,JSON.stringify(bad));});
  await assert.rejects(store.show('demo'),configError);await assert.rejects(store.set('demo',{seed:5}),configError);
});
test('concurrent edits append contiguous immutable hash-linked snapshots, without clobbering files',async t=>{
  const store=await setup(t);await store.restore('demo');const first=await readFile(join(store.directory,'demo','00000001.json'),'utf8');
  const records=await Promise.all(Array.from({length:12},(_,index)=>store.set('demo',{seed:index+10})));assert.equal(new Set(records.map(x=>x.revision)).size,12);
  assert.equal((await store.history('demo')).length,13);assert.equal(await readFile(join(store.directory,'demo','00000001.json'),'utf8'),first);
  assert.equal((await readdir(join(store.directory,'demo'))).filter(x=>x.startsWith('.pending')).length,0);
});
test('save is no-clobber, load creates new profile revision, historical replay pins earlier state',async t=>{
  const store=await setup(t);const first=await store.load('demo',custom()),path=join(store.directory,'export.json');await store.save('demo',path);await assert.rejects(store.save('demo',path),{code:'EEXIST'});
  const exported=validateConfigurationSnapshot(JSON.parse(await readFile(path,'utf8')));await store.load('other',exported.configuration);assert.equal((await store.show('other')).configurationSha256,first.configurationSha256);
  await store.restore('demo');assert.equal((await run(await store.start('demo',{revision:1}))).text,'自定义回复');
});
test('store stays outside checked source and rejects symlink profile directories',async t=>{
  assert.throws(()=>createConfigurationStore({directory:new URL('../src/profiles',import.meta.url).pathname}),configError);
  const store=await setup(t),target=await mkdtemp(join(tmpdir(),'gemini-target-'));t.after(()=>rm(target,{recursive:true,force:true}));await symlink(target,join(store.directory,'demo'));
  await assert.rejects(store.restore('demo'),configError);
});
test('CLI documented restore/set/show/replay/reset/save/load/history paths work with real subprocess',async t=>{
  const store=await setup(t),args=['--dir',store.directory,'--profile','cli'];
  const command=(name,...more)=>{const result=spawnSync(process.execPath,['scripts/gemini-simulator.mjs',name,...args,...more],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
  const first=command('restore');assert.equal(first.revision,1);
  command('set','--json',JSON.stringify({output:{presets:[preset('default','CLI changed response')]},timing:{latencyMs:20,tokensPerSecond:10}}));
  const preview=command('replay','--sample-index','7');assert.equal(preview.responses[0].status,200);assert(JSON.parse(preview.responses[0].body).candidates[0].content.parts[0].text==='CLI changed response');assert.equal(preview.simulation.configurationDecision.totalDelayMs,520);
  assert.equal(command('reset').simulation.consumed,0);assert.equal(command('show').revision,2);assert.equal(command('history').length,2);
  const path=join(store.directory,'cli-export.json');command('save','--file',path);assert.equal(command('load','--file',path).revision,3);
  assert.equal(command('restore','--revision','1').revision,4);assert.equal(command('replay','--revision','2').simulation.configurationRevision.revision,2);
});
test('CLI all registered scenario previews terminate, explicitly cancel hang, and remain simulated',async t=>{
  const store=await setup(t);for(const scenario of getManifest().scenarios) {
    await store.restore('all',{scenario:scenario.id});const result=await cli(['replay','--dir',store.directory,'--profile','all']);
    assert.equal(result.simulation.realApiCalled,false);assert.equal(result.simulation.remaining,0);assert.equal(result.simulation.active,0);assert.equal(result.hangCancelled,scenario.id==='transport.hang');if(result.hangCancelled)assert.equal(result.responses[0].error,'AbortError');
  }
});
test('CLI strict invalid options and malformed JSON reject rather than execute content',async t=>{
  const store=await setup(t);await assert.rejects(cli(['set','--dir',store.directory,'--json','not-json']),/INVALID_JSON/);
  await assert.rejects(cli(['replay','--sample-index','NaN']),/INVALID_NUMBER/);
  await assert.rejects(cli(['restore','--scenario','text.ok','--revision','1']),/CHOOSE_SCENARIO_OR_REVISION/);
  await assert.rejects(cli(['restore','--run-code','process.exit()']),/INVALID_OPTION/);
});
