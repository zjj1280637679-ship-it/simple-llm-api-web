import assert from 'node:assert/strict';import {report} from './report.mjs';
import {geminiProfile,normalizeGeminiModel,bindGeminiModel,partitionGeminiModels} from '../../src/gemini-capabilities.js';
await report('gemini-capabilities',async()=>{
 const c={protocol:'gemini',url:'https://generativelanguage.googleapis.com/v1beta',model:'gemini-3.8-flash'};
 assert.equal(geminiProfile(c).sampling,'unsupported');assert.equal(geminiProfile({...c,model:'gemini-future'}).thinking,'unknown');
 const entry=normalizeGeminiModel({name:'models/gemini-3.8-flash',thinking:false,supportedGenerationMethods:['generateContent'],apiKey:'must-not-copy'});
 const bound={...c,modelMetadata:bindGeminiModel(c,entry,'synthetic-time')};assert.equal(geminiProfile(bound).thinking,'unsupported');
 assert.equal(geminiProfile({...bound,url:'https://gateway.example/v1'}).thinking,'unknown');assert.doesNotMatch(JSON.stringify(entry),/apiKey|must-not-copy/);
 assert.equal(partitionGeminiModels([entry,{id:'embed',methods:['embedContent']},{id:'unknown'}]).usable.length,2);
 return {threeWayCapability:true,endpointBoundMetadata:true,secretIndependent:true,unknownPreserved:true};
});
