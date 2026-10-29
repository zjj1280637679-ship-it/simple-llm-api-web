import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchema as normalize, validateSchemaSubset as validate, buildStructuredOutputFields as build, parseStructuredResult as parse } from '../src/structured-output.js';
const schema = () => ({ type:'object', properties:{ value:{type:'string'} }, required:['value'], additionalProperties:false });

test('JSON __proto__ property and default stay own data, without prototype mutation', () => {
 const s=JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"],"default":{"__proto__":{"x":1}}}');
 const n=normalize(s);assert(Object.hasOwn(n.properties,'__proto__'));assert(Object.hasOwn(n.default,'__proto__'));assert.equal(Object.getPrototypeOf(n.properties),Object.prototype);assert.equal(JSON.stringify(n),JSON.stringify(normalize(n)));assert.deepEqual(n.properties.__proto__,{type:'string'});
});
test('shared references are cloned without silently erasing constraints or values', () => {
 const shared={type:'string'}, value={x:1}; const s={type:'object',properties:{a:shared,b:shared},default:[value,value]};
 const n=normalize(s);assert.deepEqual(n.properties.a,n.properties.b);assert.deepEqual(n.default,[{x:1},{x:1}]);assert.notEqual(n.properties.a,n.properties.b);assert.deepEqual(n,normalize(n));
});
test('circular schema and circular annotation fail explicitly rather than changing meaning',()=>{
 for (const kind of ['schema','annotation']) {const s=schema();if(kind==='schema')s.properties.self=s;else {s.default={};s.default.self=s.default;}
 assert.equal(validate(s,'ark').ok,false);assert.throws(()=>normalize(s),/Circular/);assert.throws(()=>build('ark',{schema:s}),/Circular/);}
});
test('invalid JSON data: non-finite, bigint, undefined, sparse, date and accessors',()=>{
 let accessed=false; const getter={};Object.defineProperty(getter,'bad',{enumerable:true,get(){accessed=true;return 1;}});
 for(const value of [NaN,Infinity,1n,undefined,new Array(3),new Date(),getter]) {const s={...schema(),default:value}; assert.equal(validate(s,'ark').ok,false);assert.throws(()=>normalize(s));}assert.equal(accessed,false);
});
test('bounded traversal rejects deep and huge sparse data without recursion crash',()=>{
 const s=schema();let at=s;for(let i=0;i<110;i++){at.default={};at=at.default;}assert.equal(validate(s,'ark').ok,false);
 assert.throws(()=>normalize(new Array(2**32-1)),/bounds/);
});
test('OpenAI strict checks nested required and additionalProperties, nonstrict separately',()=>{
 const s=schema();s.properties.value={type:'object',properties:{x:{type:'string'}}};
 assert.equal(validate(s,'openai').ok,true);assert.equal(validate(s,'openai',{strict:true}).ok,false);assert.throws(()=>build('openai',{schema:s}),/strict/);
 s.properties.value.required=['x'];s.properties.value.additionalProperties=false;assert.equal(validate(s,'openai',{strict:true}).ok,true);assert.equal(build('openai',{schema:s}).response_format.json_schema.strict,true);
});
test('provider profiles do not conflate OpenAI and Ark combinators/nullable',()=>{
 for(const key of ['allOf','oneOf']) {const s=schema();s.properties.value={[key]:[{type:'string'}]}; assert.equal(validate(s,'openai').ok,false);assert.equal(validate(s,'ark').ok,true);}
 const s=schema();s.properties.value.nullable=true;assert.equal(validate(s,'openai').ok,false);assert.equal(validate(s,'ark').ok,false);
});
test('Gemini OpenAPI message supports anyOf with uppercase enum types, excludes JSONSchema-only fields',()=>{
 const s={type:'object',properties:{value:{anyOf:[{type:'string'},{type:'null'}]}}};
 assert.equal(validate(s,'gemini').ok,true);const out=build('gemini',{schema:s}).generationConfig.responseSchema;assert.equal(out.type,'OBJECT');assert.deepEqual(out.properties.value.anyOf,[{type:'STRING'},{type:'NULL'}]);
 assert.equal(validate({...s,additionalProperties:false},'gemini').ok,false);assert.equal(validate({...s,$defs:{}},'gemini').ok,false);
 assert.equal(validate({type:'object',properties:{x:{type:'integer',enum:[1,2]}}},'gemini').ok,false);
});
test('builder validates before normalization, never silently strips unsupported constraints',()=>{
 assert.throws(()=>build('ark',{schema:{...schema(),not:{}}}),/Disallowed/);
 assert.throws(()=>build('openai',{schema:schema(),strict:'yes'}),/boolean/);
 assert.throws(()=>build('ark',{schema:schema(),name:'bad name'}),/Schema name/);
});
test('empty combinators fail rather than reporting valid schema',()=>{
 for(const key of ['anyOf','allOf','oneOf'])assert.equal(validate({...schema(),properties:{x:{[key]:[]}}},'ark').ok,false);
});
test('explicit refusal and incomplete or blocked responses are not parsed as success',()=>{
 assert.equal(parse('openai',{choices:[{message:{content:'{}',refusal:'refused'},finish_reason:'stop'}]}).ok,false);
 for(const reason of ['length','content_filter','tool_calls'])assert.equal(parse('openai',{choices:[{message:{content:'{}'},finish_reason:reason}]}).ok,false);
 for(const reason of ['MAX_TOKENS','SAFETY'])assert.equal(parse('gemini',{candidates:[{content:{parts:[{text:'{}'}]},finishReason:reason}]}).ok,false);
 assert.equal(parse('gemini',{candidates:[{content:{parts:[{text:'{}'}]},finishReason:'STOP'}]}).ok,true);
});
test('parse success is JSON syntax only, not instance schema validation',()=>{
 assert.deepEqual(parse('ark',{choices:[{message:{content:'{"wrong":true}'},finish_reason:'stop'}]}),{ok:true,value:{wrong:true}});
});
test('non-enumerable accessors do not execute at the JSON boundary',()=>{
 let accessed=false;const s=schema();Object.defineProperty(s,'default',{get(){accessed=true;return 1;}});
 assert.equal(validate(s,'ark').ok,false);assert.throws(()=>normalize(s));assert.equal(accessed,false);
});
test('contradictory constraints and duplicate required entries are reported',()=>{
 assert.equal(validate({...schema(),required:['value','value']},'ark').ok,false);
 assert.equal(validate({...schema(),properties:{value:{type:'string',minLength:5,maxLength:1}}},'ark').ok,false);
});
test('simple reference profile rejects escaped pointer and percent tokens rather than misresolving',()=>{
 for(const token of ['a~1b','a~0b','a%2Fb','a%25b']) {const s={...schema(),$defs:{[token]:{type:'string'}},properties:{value:{$ref:'#/$defs/'+token}}};assert.equal(validate(s,'ark').ok,false);assert.throws(()=>build('ark',{schema:s}),/format/);}
 const s={...schema(),$defs:{Name:{type:'string'}},properties:{value:{$ref:'#/$defs/Name'}}};assert.equal(validate(s,'ark').ok,true);
});
test('numeric-looking array properties outside array index range are rejected',()=>{
 for(const key of ['4294967295','9007199254740992','01','-1']) {const a=[];a[key]='lost';const s={...schema(),default:a};assert.equal(validate(s,'ark').ok,false);assert.throws(()=>normalize(s),/array properties/);}
});
