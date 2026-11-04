/** Finite cross-product of endpoint/model/observed-thinking/sampling choices. */
import assert from 'node:assert/strict';
import {geminiProfile,bindGeminiModel,normalizeGeminiModel} from '../../src/gemini-capabilities.js';
import {geminiGeneration} from '../../src/gemini-request.js';
import {getReasoningTemplates,availableReasoningFamilies} from '../../src/reasoning.js';
export function checkGeminiAdaptationModel(){
 let cases=0;
 for(const url of ['https://generativelanguage.googleapis.com/v1beta','https://gateway.example/v1'])
 for(const model of ['gemini-3.8-flash','gemini-3.6-flash','gemini-2.5-pro','gemini-2.5-flash-lite','gemini-flash-lite-latest','future'])
 for(const observed of [undefined,false,true])
 for(const include of ['',false,true])
 for(const seed of ['',0,123]){
  const c={protocol:'gemini',url,model};if(observed!==undefined)c.modelMetadata=bindGeminiModel(c,normalizeGeminiModel({name:model,thinking:observed,topK:40}),'fixture');
  const profile=geminiProfile(c),settings={geminiIncludeThoughts:include,geminiSeed:seed,geminiTopK:'40'};
  const before=JSON.stringify({c,settings});const out=geminiGeneration(c,settings,{temperature:0,topP:0});
  assert.equal(JSON.stringify({c,settings}),before);
  if(profile.sampling==='unsupported'){assert.equal(out.temperature,undefined);assert.equal(out.topP,undefined);assert.equal(out.topK,undefined);}
  if(profile.thinking==='unsupported'){assert.equal(out.thinkingConfig,undefined);assert.deepEqual(getReasoningTemplates(c),[]);assert.deepEqual(availableReasoningFamilies(c),[]);}
  if(include===''||profile.thinking==='unsupported')assert.equal(out.thinkingConfig,undefined);else assert.equal(out.thinkingConfig.includeThoughts,include);
  if(seed==='')assert.equal(out.seed,undefined);else assert.equal(out.seed,seed);
  assert.ok(availableReasoningFamilies(c).every(f=>f.id==='gemini'));cases++;
 }
 return {cases,scope:'Finite production-function classes; no quota/credential permission, real providers, DOM or complete abstraction proof.'};
}
