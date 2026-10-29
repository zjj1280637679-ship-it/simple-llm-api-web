import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getImageCapabilities, normalizeImageOptions } from '../module-library/functions/image-options/index.js';
import { generateText } from '../module-library/functions/text-generation/index.js';
import { generateImage } from '../module-library/functions/image-generation/index.js';
import { dispatchCommand } from '../module-library/relations/image-command/index.js';
import { createPageSession } from '../module-library/relations/page-session/index.js';
import { runConversation } from '../module-library/compositions/agent-image-turn/index.js';
import { validateCatalog, selectModules, evidenceState, moduleRevisions, validateDependencies,
  validateRecipe, validateRevisionTransition } from '../scripts/module-library.mjs';

const url = 'https://audit.example.com/v1';
const config = {protocol:'openai',url,trustedTarget:url,key:'synthetic-library-key',model:'synthetic-model'};
const imageConfig = {...config,protocol:'ark',model:'doubao-seedream-5-0-flash-260915'};
const messages = [{role:'user',content:'Draw a blue cup'}];
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V8AAAAASUVORK5CYII=';
const imageBody = {data:[{b64_json:png}]};
const reply = content => ({choices:[{message:{role:'assistant',content}}]});
const response = body => new Response(JSON.stringify(body),{status:200});
const catalog = JSON.parse(await readFile(new URL('../module-library/catalog.json',import.meta.url),'utf8'));

test('library image options: independent entry maps known model and rejects unsupported size', () => {
  assert.deepEqual(normalizeImageOptions(imageConfig).pixels,[2048,2048]);
  assert.equal(getImageCapabilities({...imageConfig,model:'unknown'}),null);
  assert.throws(()=>normalizeImageOptions(imageConfig,{imageSize:'4K'}),e=>e.code==='IMAGE_OPTIONS');
});

test('library text entry constructs one request and returns the synthetic reply', async () => {
  let count=0;
  const result=await generateText({config,messages,fetchImpl:async (_url,init)=>{
    count++; const body=JSON.parse(init.body);
    assert.equal(body.messages[0].content,messages[0].content);
    return response(reply('ready'));
  }});
  assert.equal(count,1); assert.equal(result.text,'ready');
});

test('library image entry returns supplied raster bytes, not a claim about generated quality', async () => {
  const result=await generateImage({config:imageConfig,prompt:'cup',fetchImpl:async (_url,init)=>{
    assert.equal(JSON.parse(init.body).size,'2048x2048');
    return response(imageBody);
  }});
  assert.equal(result.images[0].data,png);
});

test('library command relation refuses unconfirmed calls without sending and routes confirmed calls', async () => {
  let calls=0;
  const context={imageConfig,fetchImpl:async()=>{calls++;return response(imageBody);}};
  const command={command:'image.generate',args:{prompt:'cup'}};
  await assert.rejects(dispatchCommand(command,context),e=>e.code==='CONFIRMATION');
  assert.equal(calls,0);
  const result=await dispatchCommand(command,{...context,confirmed:true});
  assert.equal(calls,1); assert.equal(result.images.length,1);
});

test('library session relation reaches the supplied handler and preserves declined-send semantics', async () => {
  let draft='', sends=0;
  const session=createPageSession({draft:({text})=>{draft=text;},confirmSend:()=>false,send:()=>{sends++;}});
  assert.equal((await session.execute({command:'draft.set',args:{text:'cup'}})).ok,true);
  assert.equal(draft,'cup');
  assert.equal((await session.execute({command:'request.send'})).ok,false);
  assert.equal(sends,0);
});

test('library composition entry completes a tool group before the follow-up reply', async () => {
  let requests=0, delivered=0;
  const first={choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'lib-1',type:'function',function:{name:'image_generate',arguments:JSON.stringify({prompt:'cup'})}}]}}]};
  const responses=[first,imageBody,reply('image returned')];
  const result=await runConversation({config,imageConfig,messages,confirmTool:()=>true,
    onToolResult:()=>{delivered++;},
    fetchImpl:async (_url,init)=>{
      requests++;
      if(requests===3) assert.equal(JSON.parse(init.body).messages.at(-1).tool_call_id,'lib-1');
      return response(responses.shift());
    }});
  assert.equal(requests,3); assert.equal(delivered,1);
  assert.equal(result.text,'image returned'); assert.equal(result.toolResults.length,1);
});

test('catalogue rejects duplicate IDs and unsupported gate claims', async () => {
  await validateCatalog(catalog);
  const duplicate=structuredClone(catalog); duplicate.modules[1].id=duplicate.modules[0].id;
  await assert.rejects(validateCatalog(duplicate),/duplicate/);
  const claimed=structuredClone(catalog); claimed.modules[0].gates.F.status='PASS';
  await assert.rejects(validateCatalog(claimed),/PASS needs evidence/);
  const missing=structuredClone(catalog); delete missing.modules[0].gates.H;
  await assert.rejects(validateCatalog(missing),/Missing gate/);
});

test('catalogue filters by relation, tag and effect without merging distinct goals', () => {
  assert.equal(selectModules(catalog,{kind:'relation'}).length,2);
  assert.deepEqual(selectModules(catalog,{query:'image-options.normalize'}).map(m=>m.id),['F-001']);
  assert(selectModules(catalog,{tag:'image'}).every(m=>m.tags.includes('image')));
  assert.throws(()=>selectModules(catalog,{kind:'imaginary'}),/Unknown kind/);
});

test('local evidence becomes stale for changed, removed or added inputs and never fills proof gates', () => {
  const before = JSON.stringify(catalog.modules.map(m=>m.gates));
  const hashes={'src/a.js':'abc'};
  const record={schemaVersion:2,kind:'local-tests',status:'PASS',moduleIds:catalog.modules.map(m=>m.id),moduleRevisions:moduleRevisions(catalog.modules),fileHashes:hashes};
  assert.equal(evidenceState(record,hashes,catalog.modules),'PASS');
  assert.equal(evidenceState(record,{'src/a.js':'def'},catalog.modules),'STALE');
  assert.equal(evidenceState(record,{},catalog.modules),'STALE');
  assert.equal(evidenceState(record,{...hashes,'src/b.js':'def'},catalog.modules),'STALE');
  assert.equal(evidenceState(null,hashes,catalog.modules),'UNKNOWN');
  assert.equal(JSON.stringify(catalog.modules.map(m=>m.gates)),before);
});

test('module cards require a stable three-part version', async () => {
  for (const version of [undefined, 1, '1.0', '01.0.0', '1.0.0-beta', '1.0.-1']) {
    const copy = structuredClone(catalog); copy.modules[0].version = version;
    await assert.rejects(validateCatalog(copy), /Invalid module version/);
  }
  const copy = structuredClone(catalog); copy.modules.find(m=>m.id==='R-002').version = '2.10.3';
  await validateCatalog(copy);
});

test('module timestamps must be canonical UTC and cannot precede creation', async () => {
  for (const updatedAt of [undefined, 'yesterday', '2026-02-30T00:00:00.000Z',
    '2026-10-29T14:00:00.000+08:00', '2000-01-01T00:00:00.000Z']) {
    const copy = structuredClone(catalog); copy.modules[0].updatedAt = updatedAt;
    await assert.rejects(validateCatalog(copy), /Invalid module timestamps/);
  }
  const copy = structuredClone(catalog); delete copy.modules[0].createdAt;
  await assert.rejects(validateCatalog(copy), /Invalid module timestamps/);
});

test('verification binds the exact module version and timestamps, not just its ID', () => {
  const hashes = {'sample.js':'unchanged'};
  const record = {schemaVersion:2,kind:'local-tests',status:'PASS',moduleIds:catalog.modules.map(m=>m.id),
    moduleRevisions:moduleRevisions(catalog.modules),fileHashes:hashes};
  assert.equal(evidenceState(record,hashes,catalog.modules),'PASS');
  for (const [field,value] of [['version','0.1.1'],['createdAt','2026-10-29T00:00:00.000Z'],
    ['updatedAt','2026-10-30T00:00:00.000Z']]) {
    const copy = structuredClone(catalog.modules); copy[0][field] = value;
    assert.equal(evidenceState(record,hashes,copy),'STALE');
  }
  const legacy = {...record,schemaVersion:1};
  assert.equal(evidenceState(legacy,hashes,catalog.modules),'STALE');
});

const recipe = JSON.parse(await readFile(new URL('../module-library/recipes/agent-image-turn.json',import.meta.url),'utf8'));
const scenario = JSON.parse(await readFile(new URL('../module-library/scenarios/workbench-v1.json',import.meta.url),'utf8'));

test('maintenance cards reject unknown states and invalid replacement pointers', () => {
  validateDependencies(catalog.modules);
  const bad = structuredClone(catalog.modules);
  bad[0].lifecycle.state = 'verified-everywhere';
  assert.throws(()=>validateDependencies(bad),/Invalid lifecycle/);
  bad[0].lifecycle.state = 'deprecated';
  bad[0].lifecycle.replacement = {id:bad[0].id,version:bad[0].version};
  assert.throws(()=>validateDependencies(bad),/Invalid replacement/);
});

test('dependencies are pinned and cannot be missing, duplicated or circular', () => {
  for (const deps of [[{id:'F-999',version:'0.1.0'}],[{id:'F-001',version:'99.0.0'}],
    [{id:'F-001',version:'0.1.0'},{id:'F-001',version:'0.1.0'}]]) {
    const copy = structuredClone(catalog.modules);
    copy.find(m=>m.id==='F-003').dependencies = deps;
    assert.throws(()=>validateDependencies(copy),/Invalid pinned dependency/);
  }
  const cyclic = structuredClone(catalog.modules);
  cyclic.find(m=>m.id==='F-001').dependencies = [{id:'C-001',version:'0.1.0'}];
  assert.throws(()=>validateDependencies(cyclic),/Dependency cycle/);
});

test('recipe pins the implementation and the complete dependency closure', () => {
  validateRecipe(recipe,catalog,scenario);
  const mismatch = structuredClone(recipe); mismatch.versions['F-001'] = '0.2.0';
  assert.throws(()=>validateRecipe(mismatch,catalog,scenario),/Recipe version mismatch/);
  const incomplete = structuredClone(recipe);
  incomplete.members = incomplete.members.filter(id=>id!=='F-003');
  delete incomplete.versions['F-003'];
  assert.throws(()=>validateRecipe(incomplete,catalog,scenario),/Incomplete recipe dependency closure/);
});

test('quarantine propagates to consumers while allowing historical wiring to be retained', () => {
  const copy = structuredClone(catalog);
  copy.modules.find(m=>m.id==='F-003').lifecycle.state = 'quarantined';
  assert.throws(()=>validateDependencies(copy.modules),/Unavailable dependency/);
  for (const id of ['R-001','C-001']) copy.modules.find(m=>m.id===id).lifecycle.state = 'quarantined';
  validateDependencies(copy.modules);
  assert.throws(()=>validateRecipe(recipe,copy,scenario),/Unavailable recipe member/);
  validateRecipe({...recipe,status:'quarantined'},copy,scenario);
  const archived = structuredClone(copy); archived.modules.find(m=>m.id==='F-003').lifecycle.state = 'archived';
  validateDependencies(archived.modules);
  validateRecipe({...recipe,status:'archived'},archived,scenario);
});

test('revision transitions preserve creation, monotonic versions and update time', () => {
  const old = {moduleRevisions:moduleRevisions(catalog.modules)};
  validateRevisionTransition(old,catalog.modules);
  for (const [field,value,pattern] of [
    ['createdAt','2020-01-01T00:00:00.000Z',/Creation timestamp/],
    ['updatedAt','2020-01-01T00:00:00.000Z',/Update timestamp/],
    ['version','0.0.9',/version moved backwards/],
    ['version','0.2.0',/newer timestamp/]]) {
    const copy = structuredClone(catalog.modules); copy[0][field] = value;
    assert.throws(()=>validateRevisionTransition(old,copy),pattern);
  }
  assert.throws(()=>validateRevisionTransition(old,catalog.modules.slice(1)),/Retain archived/);
  const upgraded = structuredClone(catalog.modules);
  upgraded[0].version = '10.0.0';
  upgraded[0].updatedAt = new Date(Date.parse(upgraded[0].updatedAt)+1000).toISOString();
  validateRevisionTransition(old,upgraded);
});

test('maintenance lifecycle is independently searchable from verification', () => {
  assert.equal(selectModules(catalog,{lifecycle:'candidate'}).length,6);
  assert.equal(selectModules(catalog,{lifecycle:'archived'}).length,0);
  assert.throws(()=>selectModules(catalog,{lifecycle:'PASS'}),/Unknown lifecycle/);
});
