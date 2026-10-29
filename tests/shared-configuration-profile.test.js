import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,readdir,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConfigurationApi} from '../module-library/relations/configuration-profile/index.mjs';
import {createConfigurationApi as compatibleApi} from '../module-library/test-resources/shared/configuration.mjs';
import {configurationFixture,requestProfile} from '../module-library/hosts/configuration-profile/fixture.mjs';

const configError={code:'SIMULATOR_CONFIGURATION'};
async function setup(t,options={}) {
  const directory=await mkdtemp(join(tmpdir(),'shared-profile-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const fixture=configurationFixture({directory,...options});
  return {...fixture,store:fixture.api.createConfigurationStore(),directory};
}
const canonical=value=>JSON.stringify(value&&typeof value==='object'?
  Array.isArray(value)?value.map(value=>JSON.parse(canonical(value))):
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):value);
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');

test('configuration compatibility path exposes the unique ordinary relation implementation',()=>{
  assert.equal(compatibleApi,createConfigurationApi);
  const {api}=configurationFixture();
  assert.deepEqual(Object.keys(api).sort(),['CONFIGURATION_API_VERSION','CONFIGURATION_SCHEMA_VERSION',
    'createConfigurationStore','createConfiguredSimulator','getConfigurationPreset','resolveConfiguration',
    'validateConfiguration','validateConfigurationSnapshot'].sort());
  assert.equal(api.CONFIGURATION_API_VERSION,'0.2.0');
  assert.equal(api.CONFIGURATION_SCHEMA_VERSION,'1.0.0');
});

test('separate factories own adapter/namespace/source inputs without mutable singleton state',async t=>{
  const a=await setup(t,{text:'alpha',namespace:'alpha-v1'}),b=await setup(t,{text:'beta',namespace:'beta-v1'});
  const beforeA=structuredClone(a.sourceFixture),beforeB=structuredClone(b.sourceFixture);
  const [as,bs]=await Promise.all([a.store.restore('same'),b.store.restore('same')]);
  const ad=a.api.resolveConfiguration(as,{sampleIndex:3}),bd=b.api.resolveConfiguration(bs,{sampleIndex:3});
  assert.equal(ad.fixture.steps[0].response.json.text,'alpha');
  assert.equal(bd.fixture.steps[0].response.json.text,'beta');
  assert.notDeepEqual(ad.decision.draws,bd.decision.draws);
  assert.deepEqual(a.api.resolveConfiguration(as,{sampleIndex:3}),ad);
  ad.fixture.steps[0].response.json.text='changed output';
  assert.equal(a.api.resolveConfiguration(as,{sampleIndex:3}).fixture.steps[0].response.json.text,'alpha');
  assert.deepEqual(a.sourceFixture,beforeA);assert.deepEqual(b.sourceFixture,beforeB);
  await assert.rejects(b.store.show('absent'),{code:'SIMULATOR_PROFILE_NOT_FOUND'});
  assert.equal((await a.store.history('same')).length,1);assert.equal((await b.store.history('same')).length,1);
});

test('defensive copies and pinned/reset sessions survive later writes and caller mutation',async t=>{
  const {api,store}=await setup(t);
  const configuration=api.getConfigurationPreset(),validated=api.validateConfiguration(configuration);
  validated.output.presets[0].text='validated copy changed';
  assert.equal(configuration.output.presets[0].text,'first reply');
  const first=await store.load('demo',configuration),session=await store.start('demo');
  t.after(()=>session.dispose());
  first.configuration.output.presets[0].text='caller changed';
  session.snapshot().configuration.output.presets[0].text='snapshot changed';
  await store.set('demo',{output:{presets:[{id:'default',matchPrompt:null,text:'later reply',tokens:4}]}});
  assert.equal((await requestProfile(session)).text,'first reply');
  const report=session.assertComplete();report.configurationDecision.success=false;
  assert.equal(session.inspect().configurationDecision.success,true);
  assert.equal(session.inspect().configurationRevision.revision,1);
  const reset=session.reset();t.after(()=>reset.dispose());
  assert.equal(reset.inspect().consumed,0);assert.equal(session.inspect().consumed,1);
  assert.equal(reset.snapshot().snapshotSha256,session.snapshot().snapshotSha256);
  assert.equal((await requestProfile(reset)).text,'first reply');reset.assertComplete();
  const latest=await store.reset('demo');t.after(()=>latest.dispose());
  assert.equal(latest.snapshot().revision,2);assert.equal((await requestProfile(latest)).text,'later reply');latest.assertComplete();
});

test('profile load/set/restore append an immutable linked history and save never clobbers',async t=>{
  const {store,directory}=await setup(t);
  const first=await store.restore('demo'),firstFile=join(directory,'demo','00000001.json');
  const firstBytes=await readFile(firstFile,'utf8');
  const second=await store.set('demo',{seed:17});
  const restored=await store.restore('demo',{revision:1}),history=await store.history('demo');
  assert.deepEqual(history.map(value=>value.revision),[1,2,3]);
  assert.deepEqual(history.map(value=>value.version),['1.0.0','1.0.1','1.0.2']);
  assert.deepEqual(history.map(value=>value.reason),['restore-preset','set','restore-revision']);
  assert.equal(second.parentSha256,first.snapshotSha256);assert.equal(restored.parentSha256,second.snapshotSha256);
  assert.equal(restored.configurationSha256,first.configurationSha256);
  assert(history.every(value=>value.createdAt===first.createdAt));
  assert(second.updatedAt>first.updatedAt&&restored.updatedAt>second.updatedAt);
  assert.equal(await readFile(firstFile,'utf8'),firstBytes);
  history[0].configuration.seed=99;assert.equal((await store.show('demo',1)).configuration.seed,1);
  const output=join(directory,'export.json');await store.save('demo',output,{revision:1});
  await assert.rejects(store.save('demo',output),{code:'EEXIST'});
  assert.equal(JSON.parse(await readFile(output,'utf8')).snapshotSha256,first.snapshotSha256);
});

test('snapshot integrity and resource revision drift fail without accepting a changed binding',async t=>{
  const {api,store,manifest}=await setup(t),snapshot=await store.restore('demo');
  const changed=structuredClone(snapshot);changed.configuration.seed++;
  assert.throws(()=>api.validateConfigurationSnapshot(changed),configError);
  manifest.fixtures[0].sha256='f'.repeat(64);
  assert.throws(()=>api.resolveConfiguration(snapshot),configError);
  await assert.rejects(store.show('demo'),configError);
  await assert.rejects(store.set('demo',{seed:3}),configError);
});

test('history validates chain linkage even when an edited record has a self-consistent digest',async t=>{
  const {api,store,directory}=await setup(t);await store.restore('demo');
  const second=await store.set('demo',{seed:2}),record=structuredClone(second);
  record.parentSha256='0'.repeat(64);delete record.snapshotSha256;record.snapshotSha256=hash(record);
  assert.equal(api.validateConfigurationSnapshot(record).revision,2);
  const file=join(directory,'demo','00000002.json');await chmod(file,0o600);await writeFile(file,JSON.stringify(record));
  await assert.rejects(store.history('demo'),configError);
  await assert.rejects(store.restore('demo'),configError);
  assert.equal((await readdir(join(directory,'demo'))).filter(name=>/^\d{8}\.json$/.test(name)).length,2);
});

test('cooperating concurrent writers keep contiguous revisions and leave no pending file',async t=>{
  const {store,directory}=await setup(t);await store.restore('demo');
  const records=await Promise.all(Array.from({length:6},(_,seed)=>store.set('demo',{seed:seed+10})));
  assert.equal(new Set(records.map(value=>value.revision)).size,6);
  assert.deepEqual((await store.history('demo')).map(value=>value.revision),[1,2,3,4,5,6,7]);
  assert.equal((await readdir(join(directory,'demo'))).filter(name=>name.startsWith('.pending')).length,0);
});

test('validation rejects extra keys, out-of-contract rate/reference and invalid restore before append',async t=>{
  const {api,store}=await setup(t);await store.restore('demo');
  for(const patch of [{unknown:true},{seed:-1},{timing:{tokensPerSecond:0.0001}},
    {output:{selectedPresetId:'absent'}},{parameters:{key:'not allowed'}},{probabilities:{cacheHit:2}}])
    await assert.rejects(store.set('demo',patch),configError);
  await assert.rejects(store.restore('demo',{revision:1,scenario:'text.ok'}),configError);
  await assert.rejects(store.restore('../outside'),configError);
  assert.throws(()=>api.resolveConfiguration({},{}),configError);
  const snapshot=await store.show('demo');
  assert.throws(()=>api.resolveConfiguration(snapshot,{sampleIndex:-1}),configError);
  assert.equal((await store.history('demo')).length,1);
});
