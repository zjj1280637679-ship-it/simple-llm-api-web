import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTestRun, testCoverage, bindTestResults, testResultsDigest, testResultsMatch, testCommands, summarizeTestResults } from '../scripts/module-test-results.mjs';
import { main, evidenceState } from '../scripts/module-library.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const reporter = resolve(root,'scripts/module-test-results.mjs');
const cases = {
  pass:"test('works',()=>{});",
  namedPass:"test('namedPass.test.mjs',()=>{});",
  namedSkip:"test('works',()=>{});test.skip('namedSkip.test.mjs',()=>{});",
  namedTodo:"test('works',()=>{});test.todo('namedTodo.test.mjs');",
  nested:"describe('suite',()=>{test('child',()=>{});});test('parent',async t=>{await t.test('inner',()=>{});});",
  imported:"await import('./'+'helper.mjs');",
  empty:'',
  emptySuite:"describe('empty',()=>{});",
  skip:"test.skip('skipped',()=>{});",
  todo:"test.todo('later');",
  mixedSkip:"test('works',()=>{});test.skip('required',()=>{});",
  mixedTodo:"test('works',()=>{});test.todo('required');",
  skippedSuite:"test('works',()=>{});describe.skip('required',()=>{test('hidden',()=>{});});",
  todoSuite:"test('works',()=>{});describe.todo('required',()=>{test('hidden',()=>{});});",
  cancel:"test('cancel',{timeout:20},()=>new Promise(()=>{}));",
  fail:"test('failure',()=>{throw Error('expected');});",
  spoof:"console.log('# tests 1\\n# pass 1\\n# fail 0\\n# skipped 0\\n# todo 0\\n# cancelled 0');",
};
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(),'module-test-results-'));
  await writeFile(join(dir,'helper.mjs'),"import {test} from 'node:test';test('imported',()=>{});");
  return dir;
}
async function execute(dir,name) {
  const file=name+'.test.mjs';
  await writeFile(join(dir,file),"import {test,describe} from 'node:test';\n"+cases[name]);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
  const run=spawnSync(process.execPath,['--test','--test-reporter='+reporter,file],
    {cwd:dir,encoding:'utf8',timeout:10000,env});
  assert.ifError(run.error);
  return {result:normalizeTestRun(run.stdout,{file,root:dir,exitCode:run.status}),output:run.stdout};
}
for (const name of Object.keys(cases)) test('actual Node runner: '+name,async()=>{
  const dir=await fixture();
  try {
    const {result}=await execute(dir,name);
    assert.equal(result.status,['pass','namedPass','nested','imported'].includes(name)?'PASS':'FAIL');
    if(name==='empty') {assert.equal(result.stats.tests,0);assert.equal(result.wrappers,1);}
    if(name==='nested') {assert.equal(result.stats.tests,3);assert.equal(result.stats.suites,1);}
    if(name==='skippedSuite'||name==='todoSuite') assert.equal(result.suiteFailures,1);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('actual streams fail closed when truncated or missing a terminal result',async()=>{
  const dir=await fixture();
  try {
    const {output}=await execute(dir,'pass');
    assert.throws(()=>normalizeTestRun(output.split('\n').slice(0,-2).join('\n'),
      {file:'pass.test.mjs',root:dir,exitCode:0}),/Incomplete/);
    const unlocated=output.trim().split('\n').map(line=>{const event=JSON.parse(line);
      if(event.data) {delete event.data.line;delete event.data.column;}return JSON.stringify(event);}).join('\n');
    assert.throws(()=>normalizeTestRun(unlocated,{file:'pass.test.mjs',root:dir,exitCode:0}),/Invalid structured/);
    const missing=output.split('\n').filter(line=>!line.includes('"event":"pass"')).join('\n');
    assert.equal(normalizeTestRun(missing,{file:'pass.test.mjs',root:dir,exitCode:0}).status,'FAIL');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('mandatory ownership rejects missing/duplicate results and ignores optional MCP skips',async()=>{
  const dir=await fixture();
  try {
    const pass=(await execute(dir,'pass')).result, skip=(await execute(dir,'skip')).result;
    const modules=[{id:'F-001',version:'1.0.0',tests:[pass.file]},{id:'R-001',version:'1.0.0',tests:[pass.file]}];
    const optional={...skip,file:'tests/mcp-transport.test.js'};
    const coverage=testCoverage(modules,[pass,optional]);
    assert(coverage.modules.every(module=>module.status==='PASS'));
    assert.deepEqual(coverage.files[0].moduleIds,['F-001','R-001']);
    for(const results of [[],[pass,pass],[{...pass,status:'FAIL'}],[{...skip,file:pass.file}]])
      assert(testCoverage(modules,results).modules.every(module=>module.status==='FAIL'));
    const hashes={[pass.file]:'a'.repeat(64)}, testResults=bindTestResults(modules,[pass],hashes);
    const record={testResults,testResultsSha256:testResultsDigest(testResults),
      commands:testCommands(modules),stats:summarizeTestResults([pass])};
    assert.equal(testResultsMatch(record,modules,hashes),true);
    assert.equal(testResultsMatch(record,modules,{[pass.file]:'b'.repeat(64)}),false);
    for(const mutate of [r=>r.testResults.files[0].result.stats.pass++,r=>r.testResults.files[0].moduleIds.pop(),
      r=>r.testResults.files[0].result.outputSha256='c'.repeat(64),r=>r.testResults.modules[0].files=[],r=>r.stats.pass++,r=>r.commands[0].pop(),
      r=>r.testResults.files[0]=null]) {
      const changed=structuredClone(record);mutate(changed);assert.equal(testResultsMatch(changed,modules,hashes),false);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('real record command migrates schema, preserves prior bytes on failure, and rejects stale result binding',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'module-record-'));
  try {
    for(const name of await readdir(root)) if(!['dist','output','.git'].includes(name))
      await cp(join(root,name),join(dir,name),{recursive:true});
    const catalogPath=join(dir,'module-library/catalog.json');
    const catalog=JSON.parse(await readFile(catalogPath,'utf8'));
    const file='tests/required-evidence-fixture.test.mjs';
    for(const module of catalog.modules) module.tests=[file];
    await writeFile(catalogPath,JSON.stringify(catalog));
    const evidencePath=join(dir,'module-library/evidence/local-tests.json');
    const before=await readFile(evidencePath,'utf8');
    for(const name of ['empty','skip','todo','mixedSkip','mixedTodo','skippedSuite','cancel','fail']) {
      await writeFile(join(dir,file),"import {test,describe} from 'node:test';\n"+cases[name]);
      await assert.rejects(main(['record'],dir),/Incomplete required tests/);
      assert.equal(await readFile(evidencePath,'utf8'),before);
    }
    await rm(join(dir,file));
    await assert.rejects(main(['record'],dir),/ENOENT/);
    assert.equal(await readFile(evidencePath,'utf8'),before);
    await writeFile(join(dir,file),"import {test} from 'node:test';test('mandatory',()=>{});");
    for(const module of catalog.modules) module.tests=['tests/./required-evidence-fixture.test.mjs'];
    await writeFile(catalogPath,JSON.stringify(catalog));
    await assert.rejects(main(['record'],dir),/must be canonical/);
    assert.equal(await readFile(evidencePath,'utf8'),before);
    for(const module of catalog.modules) module.tests=[file];
    await writeFile(catalogPath,JSON.stringify(catalog));
    await main(['record'],dir);
    const record=JSON.parse(await readFile(evidencePath,'utf8'));
    assert.equal(record.schemaVersion,5);
    assert.equal(record.testResults.files.length,1);
    assert.equal(record.testResults.modules.length,catalog.modules.length);
    const hosts=JSON.parse(await readFile(join(dir,'module-library/hosts/catalog.json'),'utf8')).hosts;
    assert.equal(evidenceState(record,record.fileHashes,catalog.modules,hosts,record.resourceRevisions),'PASS');
    for(const schemaVersion of [1,3,4]) assert.equal(evidenceState({...record,schemaVersion},record.fileHashes,catalog.modules,hosts,record.resourceRevisions),'STALE');
    record.testResults.files[0].result.stats.pass++;
    await writeFile(evidencePath,JSON.stringify(record));
    await assert.rejects(main(['check'],dir),/STALE/);
    assert.deepEqual((await readdir(join(dir,'module-library/evidence'))).filter(name=>name.endsWith('.tmp')),[]);
  } finally {await rm(dir,{recursive:true,force:true});}
});
