import test from 'node:test';import assert from 'node:assert/strict';
import {geminiProfile,normalizeGeminiModel,bindGeminiModel,partitionGeminiModels} from '../src/gemini-capabilities.js';
import {geminiGeneration,geminiEffectiveSettings} from '../src/gemini-request.js';
import {geminiSettingsMarkup} from '../src/gemini-settings-markup.js';
import {generateText,listModels,GEMINI_ENDPOINT} from '../src/core.js';
import {availableReasoningFamilies,getReasoningTemplates} from '../src/reasoning.js';
const config=(model='gemini-3.8-flash')=>({protocol:'gemini',url:GEMINI_ENDPOINT,key:'synthetic-gemini',trustedTarget:GEMINI_ENDPOINT,model});
const answer=()=>Response.json({candidates:[{content:{parts:[{text:'ok'}]},finishReason:'STOP'}]});
test('capability identity ignores credential spelling and distinguishes unknown aliases/gateways',()=>{
 const c=config();assert.deepEqual(geminiProfile(c),geminiProfile({...c,key:'AIza-this-is-only-a-fixture'}));
 assert.equal(geminiProfile(c).sampling,'unsupported');
 for(const model of ['gemini-flash-lite-latest','gemini-future','unrecognized'])assert.equal(geminiProfile(config(model)).sampling,'unknown');
 assert.equal(geminiProfile({...c,url:'https://proxy.example/v1beta'}).sampling,'unknown');
 assert.equal(geminiProfile({...c,protocol:'openai'}),null);
 assert.deepEqual(availableReasoningFamilies(c).map(f=>f.id),['gemini']);
});
test('model response uses methods, thinking, limits and topK without importing arbitrary fields',async()=>{
 const models=await listModels({config:config(),fetchImpl:async()=>Response.json({models:[
 {name:'models/gemini-3.8-flash',supportedGenerationMethods:['generateContent'],thinking:true,inputTokenLimit:123,outputTokenLimit:456,apiKey:'DO-NOT-COPY'},
 {name:'models/embedding',supportedGenerationMethods:['embedContent']},{name:'models/unknown'},
 {name:'models/no-thinking',supportedGenerationMethods:['generateContent'],thinking:false,topK:40}]})});
 const {usable,other}=partitionGeminiModels(models);assert.deepEqual(usable.map(m=>m.id),['gemini-3.8-flash','unknown','no-thinking']);assert.deepEqual(other.map(m=>m.id),['embedding']);
 assert.doesNotMatch(JSON.stringify(models),/DO-NOT-COPY|apiKey/);
 const c=config('no-thinking');c.modelMetadata=bindGeminiModel(c,models[3],'fixture-time');
 assert.equal(geminiProfile(c).thinking,'unsupported');assert.equal(geminiProfile(c).topK,'supported');assert.equal(getReasoningTemplates(c).length,0);
 assert.equal(geminiProfile({...c,model:'another'}).thinking,'unknown');
 assert.equal(geminiProfile({...c,url:'https://other.example/v1beta'}).thinking,'unknown');
});
test('default requests omit every new control; chosen controls survive thinking merge and retain zero/false',async()=>{
 for(const settings of [{},{geminiIncludeThoughts:'false',geminiSeed:'0',geminiMediaResolution:'MEDIA_RESOLUTION_HIGH',geminiStopSequences:'END\n STOP ',reasoning:{template:'gemini-level',value:'low'}}]){
 let body;await generateText({config:config(),messages:[{role:'user',content:'fixture'}],settings,fetchImpl:async(u,o)=>{body=JSON.parse(o.body);return answer();}});
 if(!Object.keys(settings).length)assert.deepEqual(body.generationConfig,{});
 else assert.deepEqual(body.generationConfig,{seed:0,mediaResolution:'MEDIA_RESOLUTION_HIGH',stopSequences:['END',' STOP '],thinkingConfig:{thinkingLevel:'low',includeThoughts:false}});
 }
});
test('hidden unsupported preferences never leak on wire or fail generic numeric validation',async()=>{
 const settings={temperature:'invalid-retained-preference',topP:999,geminiTopK:'not-used',geminiSeed:'1'};let body;
 await generateText({config:config(),messages:[{role:'user',content:'fixture'}],settings,fetchImpl:async(u,o)=>{body=JSON.parse(o.body);return answer();}});
 assert.deepEqual(body.generationConfig,{seed:1});assert.equal(settings.topP,999);
 const c=config('without-thinking');c.modelMetadata=bindGeminiModel(c,normalizeGeminiModel({name:c.model,thinking:false}));
 assert.equal(geminiEffectiveSettings(c,{reasoning:{template:'gemini-level',value:'high'}}).reasoning,undefined);
 assert.deepEqual(geminiGeneration(c,{geminiIncludeThoughts:'true'}),{});
});
test('known 2.5 model retains editable sampling; topK absence applies only to an observed Model record',async()=>{
 const c=config('gemini-2.5-flash');assert.equal(geminiProfile(c).topK,'unknown');
 let body;await generateText({config:c,messages:[{role:'user',content:'fixture'}],settings:{temperature:0,topP:0,geminiTopK:'12',reasoning:{template:'gemini-budget',value:0},geminiIncludeThoughts:'true'},fetchImpl:async(u,o)=>{body=JSON.parse(o.body);return answer();}});
 assert.deepEqual(body.generationConfig,{temperature:0,topP:0,topK:12,thinkingConfig:{thinkingBudget:0,includeThoughts:true}});
 c.modelMetadata=bindGeminiModel(c,normalizeGeminiModel({name:c.model}));assert.equal(geminiProfile(c).topK,'unsupported');assert.deepEqual(geminiGeneration(c,{geminiTopK:'12'}),{});
});
test('new controls stay protocol-scoped and invalid inputs produce preflight errors with no request',async()=>{
 const all={geminiIncludeThoughts:'true',geminiSeed:'0',geminiTopK:'12',geminiStopSequences:'END',geminiMediaResolution:'MEDIA_RESOLUTION_LOW'};
 let body;const c={...config(),protocol:'openai',url:'https://gateway.example/v1',trustedTarget:'https://gateway.example/v1'};
 await generateText({config:c,messages:[{role:'user',content:'fixture'}],settings:all,fetchImpl:async(u,o)=>{body=JSON.parse(o.body);return Response.json({choices:[{message:{role:'assistant',content:'ok'},finish_reason:'stop'}]});}});
 for(const k of ['seed','topK','stopSequences','thinkingConfig','mediaResolution','generationConfig'])assert.equal(body[k],undefined);
 for(const invalid of [{geminiSeed:'1.2'},{geminiIncludeThoughts:'maybe'},{geminiMediaResolution:'ULTRA'},{geminiStopSequences:'a\nb\nc\nd\ne\nf'}])await assert.rejects(()=>generateText({config:config(),messages:[{role:'user',content:'fixture'}],settings:invalid,fetchImpl:()=>assert.fail('must not request')}),{code:'GEMINI_SETTINGS'});
});
test('Gemini deep controls escape content, shrink explicit negatives and preserve an unknown-model route',()=>{
 assert.equal(geminiSettingsMarkup({id:1},{protocol:'openai'},{}),'');
 const html=geminiSettingsMarkup({id:1},config(),{geminiStopSequences:'</textarea><script>x</script>'});assert.doesNotMatch(html,/<script|data-key="geminiTopK"|geminiThinkingMode/);assert.match(html,/&lt;script&gt;/);
 const unknown=geminiSettingsMarkup({id:1},config('future'),{});assert.match(unknown,/未核验模型的思考格式/);assert.match(unknown,/gemini-budget/);
});
