import test from 'node:test';
import { requiredTestFiles, bindTestResults, testResultsDigest, testCommands, summarizeTestResults } from '../scripts/module-test-results.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, validateHosts, moduleRevisions, hostRevisions, evidenceState, validateRevisionTransition } from '../scripts/module-library.mjs';
const exec=promisify(execFile);
const catalog=JSON.parse(await readFile(new URL('../module-library/catalog.json',import.meta.url),'utf8'));
const registry=JSON.parse(await readFile(new URL('../module-library/hosts/catalog.json',import.meta.url),'utf8'));
const cleanEnv={...process.env,ARK_API_KEY:'',ARK_BASE_URL:'',ARK_TEXT_MODEL:'',ARK_IMAGE_MODEL:''};

for (const host of registry.hosts) {
  test('standalone minimal host '+host.id+' produces observable '+host.goal,async ()=>{
    const dir=await mkdtemp(join(tmpdir(),'module-host-test-'));
    try {
      const {stdout}=await exec(process.execPath,[host.entry,'--out',dir],{cwd:ROOT,env:cleanEnv,timeout:10000});
      const result=JSON.parse(stdout);
      assert.equal(result.status,'PASS'); assert.equal(result.mode,host.defaultMode);
      assert.deepEqual(result.module,host.module);
      assert.equal(result.host.version,host.version);
      assert.equal(result.host.createdAt,host.createdAt);
      assert.equal(result.host.updatedAt,host.updatedAt);
      assert(Number.isFinite(Date.parse(result.verifiedAt)));
      if (host.module.id==='F-001') assert.equal(result.observed.options.size,'2048x2048');
      if (host.module.id==='F-002') {
        assert.equal(result.observed.text,'Host text reply.');
        assert.equal(result.evidenceType,'SIMULATED'); assert.equal(result.realApiCalled,false);
        assert.equal(result.observed.realNetworkRequests,0);
        assert.equal(result.resourceRevisions[0].resourceId,'TR-GEMINI-001');
        assert.equal(result.resourceRevisions[0].scenarioId,'text.ok');
        assert.match(result.resourceRevisions[0].fixtureSha256,/^[a-f0-9]{64}$/);
        assert.equal(new Date(result.runStartedAt).toISOString(),result.runStartedAt);
        assert.equal(new Date(result.runFinishedAt).toISOString(),result.runFinishedAt);
        assert(Date.parse(result.runFinishedAt)>=Date.parse(result.runStartedAt));
      }
      if (host.module.id==='R-001') {
        assert.equal(result.observed.unconfirmedRequests,0);
        assert.equal(result.observed.confirmedEffect,true);
      }
      if (host.module.id==='R-002') {
        assert.deepEqual(result.observed.state,{page:'image',draft:'host draft',sends:0});
        assert.equal(result.observed.deniedSend.ok,false);
      }
      if (host.module.id==='C-001') {
        assert.equal(result.observed.deliveredImages,1);
        assert.equal(result.observed.toolHistoryMatched,true);
        assert(result.observed.checkpoints>0);
      }
      for (const file of result.observed.files || []) {
        const data=await readFile(file.path);
        assert.equal(data.length,file.bytes);
        assert.equal(data.readUInt32BE(16),1);
        assert.equal(data.readUInt32BE(20),1);
      }
    } finally {await rm(dir,{recursive:true,force:true});}
  });
}

test('module host command resolves the pinned host and refuses unknown modules',async ()=>{
  const good=await exec(process.execPath,['scripts/module-host.mjs','F-001'],{cwd:ROOT,env:cleanEnv,timeout:10000});
  assert.equal(JSON.parse(good.stdout).host.id,'H-F-001');
  await assert.rejects(exec(process.execPath,['scripts/module-host.mjs','F-999'],{cwd:ROOT,env:cleanEnv,timeout:10000}),
    error=>error.code===1 && error.stderr.includes('Unknown module ID'));
});

test('host failure is observable: unsupported mode, absent live credentials and invalid arguments',async ()=>{
  for (const [entry,args,message] of [
    ['image-options',['--live'],'not applicable'],
    ['text-generation',['--live'],'requires ARK_API_KEY'],
    ['page-session',['--wrong'],'Use --live']]) {
    await assert.rejects(exec(process.execPath,['module-library/hosts/'+entry+'/run.mjs',...args],
      {cwd:ROOT,env:cleanEnv,timeout:10000}),error=>{
        const report=JSON.parse(error.stdout);
        return error.code===1 && report.status==='FAIL' && report.message.includes(message);
      });
  }
});

test('every module must bind an existing versioned host with explicit scope',async ()=>{
  await validateHosts(catalog,registry);
  const missing=structuredClone(catalog); delete missing.modules[0].host;
  await assert.rejects(validateHosts(missing,registry),/Missing or mismatched module host/);
  for (const change of [
    h=>h.version='bad',h=>h.createdAt=null,h=>h.module.version='99.0.0',
    h=>h.criteria=[],h=>h.defaultMode='live']) {
    const bad=structuredClone(registry); change(bad.hosts[0]);
    await assert.rejects(validateHosts(catalog,bad));
  }
});

test('host changes stale evidence and preserve host creation/version history',()=>{
  const hashes={'fixture':'same'};
  // Synthetic binding fixture; real runner coverage is exercised separately.
  const results=requiredTestFiles(catalog.modules).map(file=>({file,status:'PASS',completed:true,exitCode:0,
    stats:{tests:1,pass:1,fail:0,cancelled:0,skipped:0,todo:0,suites:0},
    suiteFailures:0,wrappers:0,outputSha256:'b'.repeat(64)}));
  for(const result of results) hashes[result.file]='a'.repeat(64);
  const testResults=bindTestResults(catalog.modules,results,hashes);
  const record={schemaVersion:5,kind:'local-tests',status:'PASS',
    testResults,testResultsSha256:testResultsDigest(testResults),
    stats:summarizeTestResults(results),commands:testCommands(catalog.modules),
    moduleIds:catalog.modules.map(m=>m.id),moduleRevisions:moduleRevisions(catalog.modules),
    hostRevisions:hostRevisions(registry.hosts),fileHashes:hashes};
  assert.equal(evidenceState(record,hashes,catalog.modules,registry.hosts),'PASS');
  for(const [field,value] of [['version','99.0.0'],['updatedAt','2027-01-01T00:00:00.000Z']]) {
    const changed=structuredClone(registry.hosts);changed[0][field]=value;
    assert.equal(evidenceState(record,hashes,catalog.modules,changed),'STALE');
  }
  const changed=structuredClone(registry.hosts);changed[0].module.version='0.2.0';
  assert.equal(evidenceState(record,hashes,catalog.modules,changed),'STALE');
  changed[0].createdAt='2020-01-01T00:00:00.000Z';
  assert.throws(()=>validateRevisionTransition({moduleRevisions:record.hostRevisions},changed),/Creation timestamp/);
});
