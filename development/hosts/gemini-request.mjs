import assert from 'node:assert/strict';import {report} from './report.mjs';
import {geminiGeneration,geminiEffectiveSettings} from '../../src/gemini-request.js';
await report('gemini-request',async()=>{
 const c={protocol:'gemini',url:'https://generativelanguage.googleapis.com/v1beta',model:'gemini-3.8-flash'},settings={temperature:'inactive',topP:4,geminiIncludeThoughts:'false',geminiSeed:'0'};
 const effective=geminiEffectiveSettings(c,settings);assert.equal(effective.temperature,undefined);assert.equal(settings.temperature,'inactive');
 assert.deepEqual(geminiGeneration(c,settings,{thinkingConfig:{thinkingLevel:'low'}}),{thinkingConfig:{thinkingLevel:'low',includeThoughts:false},seed:0});
 assert.deepEqual(geminiGeneration(c,{}),{});assert.throws(()=>geminiGeneration(c,{geminiSeed:1.5}),{code:'GEMINI_SETTINGS'});
 return {explicitOnly:true,zeroAndFalsePreserved:true,preferencesRetained:true,nestedThinkingMerged:true};
});
