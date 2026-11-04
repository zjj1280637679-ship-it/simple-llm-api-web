/** Gemini 能力解释：协议事实、具名模型记录与当前端点的 models 回执分开。
 * 无网络/密钥读取/持久状态；unknown 不是 unsupported。契约：gemini-capabilities。
 */
import {identifyProvider} from './provider-identity.js';
export const GEMINI_PROFILE_VERSION='0.1.0';
export const GEMINI_PROFILE_DATE='2026-11-04';
export const GEMINI_FIELDS=Object.freeze(['geminiIncludeThoughts','geminiMediaResolution','geminiTopK','geminiSeed','geminiStopSequences','geminiThinkingMode']);
const level=(choices)=>({id:'gemini-level',choices});
const levels=['low','medium','high'],full=['minimal',...levels];
const known={
 'gemini-4-argon':level(levels),'gemini-3.8-flash':level(levels),'gemini-3.7-flash':level(levels),
 'gemini-3.6-flash':level(full),'gemini-3.5-flash':level(full),'gemini-3.5-flash-lite':level(full),
 'gemini-3.1-flash-lite':level(full),'gemini-3-flash-preview':level(full),
 'gemini-3.1-pro-preview':level(levels),'gemini-3-pro-preview':level(['low','high']),
 'gemini-2.5-pro':{id:'gemini-budget',kind:'number',min:128,max:32768,specialValues:[-1]},
 'gemini-2.5-flash':{id:'gemini-budget',kind:'number',min:0,max:24576,specialValues:[-1]},
 'gemini-2.5-flash-lite':{id:'gemini-budget',kind:'number',min:512,max:24576,specialValues:[-1,0]}
};
const ignoredSampling=new Set(['gemini-3.6-flash','gemini-3.7-flash','gemini-3.8-flash','gemini-4-argon']);
const modelId=value=>String(value||'').replace(/^models\//,'').trim();
const endpoint=value=>{try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)return '';return u.href.replace(/\/+$/,'');}catch{return '';}};
/** Only the documented Model fields survive; arbitrary response fields never enter settings. */
export function normalizeGeminiModel(model={}) {
 const id=modelId(model.name),metadata={topK:Number.isInteger(model.topK)&&model.topK>0?model.topK:null};
 for(const key of ['inputTokenLimit','outputTokenLimit'])if(Number.isSafeInteger(model[key])&&model[key]>0)metadata[key]=model[key];
 if(typeof model.thinking==='boolean')metadata.thinking=model.thinking;
 if(Number.isFinite(model.maxTemperature)&&model.maxTemperature>=0)metadata.maxTemperature=model.maxTemperature;
 const methods=Array.isArray(model.supportedGenerationMethods)?model.supportedGenerationMethods.filter(x=>typeof x==='string'):null;
 return {id,name:String(model.displayName||model.name||''),methods,metadata};
}
export function bindGeminiModel(config,entry,observedAt=new Date().toISOString()) {
 if(config?.protocol!=='gemini'||modelId(config.model)!==entry?.id||!endpoint(config.url))return null;
 const normalized=normalizeGeminiModel({name:entry.id,...entry.metadata,supportedGenerationMethods:entry.methods});
 return {endpoint:endpoint(config.url),model:entry.id,observedAt,...normalized.metadata,methods:normalized.methods};
}
export function geminiProfile(config={}) {
 if(config.protocol!=='gemini')return null;
 const id=modelId(config.model),identity=identifyProvider(config),official=identity.provider==='gemini'&&identity.profileMatched;
 const metadata=config.modelMetadata?.endpoint===endpoint(config.url)&&endpoint(config.url)&&config.modelMetadata?.model===id?config.modelMetadata:null;
 const template=official?known[id]:null;
 const thinking=metadata?.thinking===false?'unsupported':template||metadata?.thinking===true?'supported':'unknown';
 const sampling=official&&ignoredSampling.has(id)?'unsupported':template?'supported':'unknown';
 const topK=sampling==='unsupported'||metadata?.topK===null?'unsupported':Number.isInteger(metadata?.topK)?'supported':'unknown';
 return {version:GEMINI_PROFILE_VERSION,recordedAt:GEMINI_PROFILE_DATE,model:id,official,catalogMatch:Boolean(template),
  thinking,thinkingTemplate:thinking==='unsupported'?null:template?structuredClone(template):null,sampling,topK,
  inputTokenLimit:metadata?.inputTokenLimit??null,outputTokenLimit:metadata?.outputTokenLimit??null,
  methods:Array.isArray(metadata?.methods)?[...metadata.methods]:null,
  observedAt:metadata?.observedAt??null,evidence:metadata?'models-response':template?'dated-model-profile':'protocol-schema-only'};
}
/** A declared non-generateContent model is outside this host; absent methods remain unknown. */
export function partitionGeminiModels(models=[]) {
 const usable=[],other=[];
 for(const model of models)(Array.isArray(model.methods)&&!model.methods.includes('generateContent')?other:usable).push(model);
 return {usable,other};
}
