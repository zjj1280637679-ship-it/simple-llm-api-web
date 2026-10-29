import assert from 'node:assert/strict';
import {bindFixtureSteps, assertFixtureRequest, SimulatorError} from '../../functions/fixture-contract/index.js';
import {runHost} from '../support.mjs';

await runHost('F-004',async()=>{
  const fixture={parameters:{prompt:{type:'string',default:'default prompt'}},steps:[{
    request:{method:'POST',url:'https://fixture.invalid/request',headers:{'content-type':'application/json'},
      body:{prompt:{$parameter:'prompt'},settings:{sample:1}}},response:{status:200,json:{ok:true}}}]};
  const before=structuredClone(fixture),steps=bindFixtureSteps(fixture,{prompt:'host prompt'});
  assert.equal(bindFixtureSteps(fixture)[0].request.body.prompt,'default prompt');
  assert.deepEqual(fixture,before);
  const expected=steps[0].request,actual={...expected,headers:new Headers(expected.headers)};
  assert.equal(assertFixtureRequest(actual,expected),undefined);
  const secret='DO_NOT_ECHO_REQUEST_VALUE';let mismatch;
  assert.throws(()=>assertFixtureRequest({...actual,url:'https://other.invalid/'+secret,body:{prompt:secret}},expected),error=>{
    mismatch=error;return error instanceof SimulatorError&&error.code==='SIMULATOR_REQUEST_MISMATCH';
  });
  assert.deepEqual(mismatch.diff.map(value=>value.field),['url','body']);
  assert(!JSON.stringify(mismatch).includes(secret));assert(!mismatch.message.includes(secret));
  assert.throws(()=>bindFixtureSteps(fixture,{extra:'unknown'}),error=>error.code==='SIMULATOR_CONFIGURATION');
  steps[0].request.body.settings.sample=2;assert.deepEqual(fixture,before);
  return {boundPrompt:expected.body.prompt,fixtureUnchanged:true,exactMatchAccepted:true,
    mismatchFields:mismatch.diff.map(value=>value.field),valuesRedacted:true,unknownParameterRejected:true,networkRequests:0};
});
