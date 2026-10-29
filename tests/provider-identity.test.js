import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyProvider} from '../src/provider-identity.js';
import {getReasoningTemplates, getRecommendedReasoningTemplate, isOfficialReasoningEndpoint, reasoningBody} from '../src/reasoning.js';

const profiles = [
  ['gemini','https://generativelanguage.googleapis.com/v1beta','gemini-2.5-pro'],
  ['openai','https://api.openai.com/v1','gpt-5'],
  ['ark','https://ark.cn-beijing.volces.com/api/v3','doubao-seed-2-1-lite-260915'],
  ['anthropic','https://api.anthropic.com/v1','claude-sonnet-4-5'],
  ['openai','https://api.deepseek.com','deepseek-flash'],
  ['openai','https://open.bigmodel.cn/api/paas/v4','glm-5.3']
];

test('catalog matching binds provider, protocol and a declared path without proving live capability', () => {
  for (const [protocol,url,model] of profiles) {
    const config = {protocol,url,model};
    assert.equal(identifyProvider(config).profileMatched,true);
    assert.equal(isOfficialReasoningEndpoint(config),true);
    const template = getReasoningTemplates(config)[0];
    assert.equal(template.catalogMatch,true);
    assert.equal(template.evidence.liveVerified,false);
  }
});

test('a known hostname on an unmatched path does not inherit catalog evidence', () => {
  for (const [protocol,url,model] of profiles) {
    const config={protocol,url:url+'/custom',model};
    assert.equal(identifyProvider(config).profileMatched,false);
    assert.equal(isOfficialReasoningEndpoint(config),false);
    assert.equal(getRecommendedReasoningTemplate(config),null);
    assert.ok(getReasoningTemplates(config).every(t=>!t.catalogMatch && !t.verifiedModel));
  }
});

test('scheme, credentials, port, query, fragment, protocol and hostname boundaries do not match', () => {
  for (const url of ['http://api.openai.com/v1','https://user@api.openai.com/v1','https://api.openai.com:8443/v1','https://api.openai.com/v1?q=1','https://api.openai.com/v1#x','https://api.openai.com.evil.example/v1','https://api.openai.com\\v1']) {
    assert.deepEqual(identifyProvider({url,protocol:'openai'}),{provider:null,profileMatched:false});
  }
  assert.equal(identifyProvider({url:'https://api.openai.com/v1',protocol:'gemini'}).profileMatched,false);
});

test('manual schemas remain available and errors describe local coverage', () => {
  const config={protocol:'openai',url:'https://gateway.example/v1',model:'unknown'};
  assert.deepEqual(reasoningBody(config,{template:'deepseek-effort',value:'high'}),{reasoning_effort:'high'});
  assert.throws(()=>reasoningBody({...config,url:'https://api.openai.com/v1',model:'gpt-5'},{template:'openai-effort',value:'max'}),/本地模板未收录/);
  assert.deepEqual(reasoningBody(config),{});
});
