import test from 'node:test';
import assert from 'node:assert/strict';
import {bindFixtureSteps, assertFixtureRequest, SimulatorError, DUMMY_KEY} from '../module-library/functions/fixture-contract/index.js';
import * as legacy from '../module-library/test-resources/shared/core.js';
const fixture=()=>({parameters:{prompt:{type:'string',default:'default'}},steps:[{request:{method:'POST',url:'https://fixture.invalid/x',
  headers:{'content-type':'application/json'},body:{nested:[{$parameter:'prompt'}],options:{a:1,b:2}}},response:{status:200,json:{ok:true}}}]});
const actual=expected=>({...expected,headers:new Headers(expected.headers)});

test('fixture contract is the unique error/constant implementation behind old core entry',()=>{
  assert.equal(legacy.SimulatorError,SimulatorError);assert.equal(legacy.DUMMY_KEY,DUMMY_KEY);
});
test('pure binding applies default or explicit nested string parameters without modifying or retaining the fixture',()=>{
  const input=fixture(),before=structuredClone(input);
  assert.equal(bindFixtureSteps(input)[0].request.body.nested[0],'default');
  const steps=bindFixtureSteps(input,{prompt:'custom'});
  assert.equal(steps[0].request.body.nested[0],'custom');assert.deepEqual(input,before);
  steps[0].request.body.options.a=99;steps[0].response.json.ok=false;assert.deepEqual(input,before);
});
test('pure binding rejects empty, wrong-type, undeclared parameters and absent steps',()=>{
  for(const parameters of [{prompt:''},{prompt:'  '},{prompt:3},{other:'x'}])
    assert.throws(()=>bindFixtureSteps(fixture(),parameters),error=>error.code==='SIMULATOR_CONFIGURATION');
  for(const input of [undefined,{}, {steps:[]}]) assert.throws(()=>bindFixtureSteps(input),error=>error.code==='SIMULATOR_CONFIGURATION');
  const input=fixture();input.parameters.prompt.type='number';
  assert.throws(()=>bindFixtureSteps(input),error=>error.diff[0].field==='parameters.prompt');
});
test('exact request comparison ignores object key order but not array order, method, URL, headers or body',()=>{
  const expected=bindFixtureSteps(fixture())[0].request;
  assert.equal(assertFixtureRequest({...actual(expected),body:{options:{b:2,a:1},nested:['default']}},expected),undefined);
  const cases=[['method','GET'],['url',expected.url+'?extra=1'],['headers',new Headers({...expected.headers,extra:'x'})],['body',{nested:['different'],options:{a:1,b:2}}]];
  for(const [field,value] of cases) assert.throws(()=>assertFixtureRequest({...actual(expected),[field]:value},expected),error=>
    error instanceof SimulatorError&&error.code==='SIMULATOR_REQUEST_MISMATCH'&&error.diff.length===1&&error.diff[0].field===field);
  assert.throws(()=>assertFixtureRequest({...actual(expected),body:{nested:['default','extra'],options:{a:1,b:2}}},expected));
  const ordered={...expected,body:{items:['one','two']}};
  assert.throws(()=>assertFixtureRequest({...actual(ordered),body:{items:['two','one']}},ordered));
});
test('mismatch reports never echo supplied URL, credential header or body values',()=>{
  const expected=bindFixtureSteps(fixture())[0].request,secret='private-value-that-must-not-appear';
  assert.throws(()=>assertFixtureRequest({...actual(expected),url:'https://bad.invalid/'+secret,headers:new Headers({authorization:secret}),body:{prompt:secret}},expected),error=>{
    assert.deepEqual(error.diff.map(item=>item.field),['url','headers','body']);
    assert(!error.message.includes(secret));assert(!JSON.stringify(error).includes(secret));return true;
  });
});
test('caller-owned requests and expected bodies remain unchanged after acceptance or rejection',()=>{
  const expected=bindFixtureSteps(fixture())[0].request,copy=structuredClone(expected),request=actual(expected);
  assertFixtureRequest(request,expected);assert.deepEqual(expected,copy);
  assert.throws(()=>assertFixtureRequest({...request,method:'GET'},expected));assert.deepEqual(expected,copy);
});
