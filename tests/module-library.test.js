import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getImageCapabilities, normalizeImageOptions } from '../module-library/functions/image-options/index.js';
import { generateText } from '../module-library/functions/text-generation/index.js';
import { generateImage } from '../module-library/functions/image-generation/index.js';
import { dispatchCommand } from '../module-library/relations/image-command/index.js';
import { createPageSession } from '../module-library/relations/page-session/index.js';
import { runConversation } from '../module-library/compositions/agent-image-turn/index.js';
import { validateCatalog, selectModules, evidenceState, moduleRevisions, validateDependencies,
  validateRecipe, validateRevisionTransition, validateTestResources, validateHostResourceLock,
  loadResourceRevisions, validateResourceRevisionTransition } from '../scripts/module-library.mjs';

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
  const record={schemaVersion:3,kind:'local-tests',status:'PASS',moduleIds:catalog.modules.map(m=>m.id),moduleRevisions:moduleRevisions(catalog.modules),hostRevisions:[],fileHashes:hashes};
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
  await assert.rejects(validateCatalog(copy), /Host module revision mismatch/);
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
  const record = {schemaVersion:3,kind:'local-tests',status:'PASS',moduleIds:catalog.modules.map(m=>m.id),
    moduleRevisions:moduleRevisions(catalog.modules),hostRevisions:[],fileHashes:hashes};
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


const resourceStamp = '2026-10-29T07:30:55.000Z';
async function resourceFixture() {
  const root = await mkdtemp(join(tmpdir(),'module-resource-test-'));
  const path = 'module-library/test-resources/gemini-native';
  await mkdir(join(root,path,'fixtures'),{recursive:true});
  await mkdir(join(root,'module-library/hosts/text-generation'),{recursive:true});
  const bytes = JSON.stringify({id:'text',version:'1.0.0',createdAt:resourceStamp,updatedAt:resourceStamp,
    request:{method:'POST'},response:{text:'SIMULATED'}})+'\n';
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(root,path,'fixtures/text.json'),bytes);
  const manifest = {resourceId:'TR-GEMINI-001',resourceVersion:'0.1.0',schemaVersion:'1.0.0',
    fixtureSetVersion:'1.0.0',protocolSnapshot:'gemini-developer-v1beta-generateContent@2026-10-29',
    createdAt:resourceStamp,updatedAt:resourceStamp,evidenceType:'SIMULATED',realApiCalled:false,
    fixtures:[{id:'text',version:'1.0.0',path:'fixtures/text.json',sha256:hash,
      createdAt:resourceStamp,updatedAt:resourceStamp}],
    scenarios:[{id:'text.ok',version:'1.0.0',fixtureId:'text',createdAt:resourceStamp,updatedAt:resourceStamp}]};
  const registry = {schemaVersion:1,resources:[{id:manifest.resourceId,manifest:path+'/manifest.json'}]};
  const lock = {schemaVersion:1,resources:[{resourceId:manifest.resourceId,resourceVersion:manifest.resourceVersion,
    scenarioId:'text.ok',scenarioVersion:'1.0.0',fixtureSetVersion:manifest.fixtureSetVersion,
    fixtureSha256:hash,protocolSnapshot:manifest.protocolSnapshot}]};
  const lockPath = 'module-library/hosts/text-generation/resources.lock.json';
  await writeFile(join(root,path,'manifest.json'),JSON.stringify(manifest));
  await writeFile(join(root,'module-library/test-resources/catalog.json'),JSON.stringify(registry));
  await writeFile(join(root,lockPath),JSON.stringify(lock));
  return {root,path,manifest,registry,lock,lockPath};
}

test('test resources verify versioned manifests, fixture bytes and host scenario locks',async ()=>{
  const f = await resourceFixture();
  try {
    const manifests = await validateTestResources(f.registry,f.root);
    validateHostResourceLock(f.lock,manifests);
    for (const [key,value] of [['resourceId','TR-NOPE-001'],['resourceVersion','9.0.0'],
      ['scenarioId','unknown'],['scenarioVersion','9.0.0'],['fixtureSetVersion','9.0.0'],
      ['fixtureSha256','0'.repeat(64)],['protocolSnapshot','wrong']]) {
      const bad = structuredClone(f.lock); bad.resources[0][key] = value;
      assert.throws(()=>validateHostResourceLock(bad,manifests),/lock mismatch/);
    }
    const absent = structuredClone(f.lock);absent.resources[0].scenarioId='unknown';
    delete absent.resources[0].scenarioVersion;delete absent.resources[0].fixtureSha256;
    assert.throws(()=>validateHostResourceLock(absent,manifests),/lock mismatch/);
    const duplicate = structuredClone(f.lock);duplicate.resources.push(duplicate.resources[0]);
    assert.throws(()=>validateHostResourceLock(duplicate,manifests),/lock mismatch/);
    await writeFile(join(f.root,f.path,'fixtures/text.json'),'changed');
    await assert.rejects(validateTestResources(f.registry,f.root),/fixture hash mismatch/);
  } finally {await rm(f.root,{recursive:true,force:true});}
});

test('test resources reject malformed metadata, dangling scenarios and escaping fixture paths',async ()=>{
  const f = await resourceFixture();
  try {
    for (const mutate of [m=>m.resourceVersion='bad',m=>m.createdAt='not UTC',
      m=>m.realApiCalled=true,m=>m.evidenceType='REAL_API_VERIFIED',
      m=>m.fixtures[0].version='1',m=>m.fixtures[0].updatedAt='2000-01-01T00:00:00.000Z',
      m=>m.scenarios[0].fixtureId='missing',m=>m.scenarios[0].createdAt=undefined,
      m=>m.scenarios[0].updatedAt='2000-01-01T00:00:00.000Z',m=>m.fixtures[0].path='../outside.json']) {
      const bad = structuredClone(f.manifest);mutate(bad);
      await writeFile(join(f.root,f.path,'manifest.json'),JSON.stringify(bad));
      await assert.rejects(validateTestResources(f.registry,f.root));
    }
  } finally {await rm(f.root,{recursive:true,force:true});}
});

test('resource revisions bind package, scenario, fixture and lock hashes into evidence',async ()=>{
  const f = await resourceFixture();
  try {
    const resources = await loadResourceRevisions({testResourceRegistry:'module-library/test-resources/catalog.json'},
      [{id:'H-F-002',resourceLock:f.lockPath}],f.root);
    assert.equal(resources.length,1);
    assert.equal(resources[0].resourceId,'TR-GEMINI-001');
    assert.match(resources[0].manifestSha256,/^[a-f0-9]{64}$/);
    assert.match(resources[0].lockSha256,/^[a-f0-9]{64}$/);
    const hashes={'same':'unchanged'};
    const record={schemaVersion:4,kind:'local-tests',status:'PASS',moduleIds:catalog.modules.map(m=>m.id),
      moduleRevisions:moduleRevisions(catalog.modules),hostRevisions:[],resourceRevisions:resources,fileHashes:hashes};
    assert.equal(evidenceState(record,hashes,catalog.modules,[],resources),'PASS');
    for(const field of ['resourceVersion','scenarioVersion','fixtureSetVersion','fixtureSha256',
      'protocolSnapshot','createdAt','updatedAt','manifestSha256','lockSha256']) {
      const changed=structuredClone(resources);changed[0][field]='changed';
      assert.equal(evidenceState(record,hashes,catalog.modules,[],changed),'STALE');
    }
    const missing={...record};delete missing.resourceRevisions;
    assert.equal(evidenceState(missing,hashes,catalog.modules,[],resources),'STALE');
    validateResourceRevisionTransition(resources,resources);
    const backwards=structuredClone(resources);backwards[0].resourceVersion='0.0.1';
    assert.throws(()=>validateResourceRevisionTransition(resources,backwards),/version moved backwards/);
    const recreated=structuredClone(resources);recreated[0].createdAt='2020-01-01T00:00:00.000Z';
    assert.throws(()=>validateResourceRevisionTransition(resources,recreated),/Creation timestamp/);
  } finally {await rm(f.root,{recursive:true,force:true});}
});


test('fixture descriptors must match embedded identity and timestamps even after rehashing',async ()=>{
  const f = await resourceFixture();
  try {
    const fixturePath = join(f.root,f.path,'fixtures/text.json');
    const original = JSON.parse(await readFile(fixturePath,'utf8'));
    for (const field of ['id','version','createdAt','updatedAt']) {
      const changed = {...original,[field]:'different'};
      const bytes = JSON.stringify(changed);
      const manifest = structuredClone(f.manifest);
      manifest.fixtures[0].sha256 = createHash('sha256').update(bytes).digest('hex');
      await writeFile(fixturePath,bytes);
      await writeFile(join(f.root,f.path,'manifest.json'),JSON.stringify(manifest));
      await assert.rejects(validateTestResources(f.registry,f.root),/fixture metadata mismatch/);
    }
  } finally {await rm(f.root,{recursive:true,force:true});}
});

test('resource assets pin valid revision metadata and exact bytes',async ()=>{
  const f = await resourceFixture();
  try {
    const bytes = Buffer.from([1,2,3,4]);
    await mkdir(join(f.root,f.path,'assets'));
    const assetPath = join(f.root,f.path,'assets/sample.bin');
    await writeFile(assetPath,bytes);
    const asset = {id:'sample',version:'1.0.0',createdAt:resourceStamp,updatedAt:resourceStamp,
      path:'assets/sample.bin',sha256:createHash('sha256').update(bytes).digest('hex'),mimeType:'application/octet-stream'};
    const manifest = {...f.manifest,assets:[asset]};
    const write = async value=>writeFile(join(f.root,f.path,'manifest.json'),JSON.stringify(value));
    await write(manifest);
    await validateTestResources(f.registry,f.root);
    for (const mutate of [a=>a.id='',a=>a.version='bad',a=>a.createdAt='bad',
      a=>a.updatedAt='2000-01-01T00:00:00.000Z',a=>a.sha256='bad',a=>a.mimeType=12,
      a=>a.width=0,a=>a.height=1.5,a=>a.path='../outside']) {
      const bad = structuredClone(manifest);mutate(bad.assets[0]);await write(bad);
      await assert.rejects(validateTestResources(f.registry,f.root));
    }
    await write({...manifest,assets:[asset,asset]});
    await assert.rejects(validateTestResources(f.registry,f.root),/Invalid resource asset/);
    await write({...manifest,assets:{}});
    await assert.rejects(validateTestResources(f.registry,f.root),/Invalid resource assets/);
    await write(manifest);
    await writeFile(assetPath,Buffer.from([9]));
    await assert.rejects(validateTestResources(f.registry,f.root),/asset hash mismatch/);
  } finally {await rm(f.root,{recursive:true,force:true});}
});
