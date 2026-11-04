/** Translate explicit Gemini choices into generateContent fields, never Interactions fields.
 * Pure projection; inactive preferences are retained by the owner, omitted on the wire.
 */
import {geminiProfile} from './gemini-capabilities.js';
const present=value=>value!==undefined&&value!==null&&value!=='';
function fail(message){throw Object.assign(new Error(message),{code:'GEMINI_SETTINGS'});}
export function geminiGeneration(config,settings={},generation={}) {
 const profile=geminiProfile(config);if(!profile)return generation;
 const result={...generation};
 if(profile.sampling==='unsupported'){delete result.temperature;delete result.topP;}
 if(profile.topK==='unsupported')delete result.topK;
 if(profile.thinking==='unsupported')delete result.thinkingConfig;
 const number=(field,label,min,max)=>{
  if(!present(settings[field]))return;
  const value=Number(settings[field]);
  if(typeof settings[field]==='boolean'||!Number.isSafeInteger(value)||value<min||value>max)fail(`${label}须为 ${min}–${max} 的整数。`);
  return value;
 };
 if(profile.topK!=='unsupported'){
  const topK=number('geminiTopK','Top K',1,2147483647);if(topK!==undefined)result.topK=topK;
 }
 const seed=number('geminiSeed','随机种子',-2147483648,2147483647);if(seed!==undefined)result.seed=seed;
 if(present(settings.geminiIncludeThoughts)&&profile.thinking!=='unsupported'){
  if(!['true','false',true,false].includes(settings.geminiIncludeThoughts))fail('思考摘要选项无效。');
  result.thinkingConfig={...result.thinkingConfig,includeThoughts:settings.geminiIncludeThoughts===true||settings.geminiIncludeThoughts==='true'};
 }
 if(present(settings.geminiMediaResolution)){
  const value=settings.geminiMediaResolution;
  if(!['MEDIA_RESOLUTION_LOW','MEDIA_RESOLUTION_MEDIUM','MEDIA_RESOLUTION_HIGH'].includes(value))fail('媒体精度选项无效。');
  result.mediaResolution=value;
 }
 if(present(settings.geminiStopSequences)){
  if(typeof settings.geminiStopSequences!=='string')fail('停止序列应逐行填写。');
  const values=settings.geminiStopSequences.split(/\r?\n/).filter(value=>value.length);
  if(values.length>5)fail('Gemini 最多接受 5 个停止序列。');
  if(values.length)result.stopSequences=values;
 }
 return result;
}
/** Used before generic numeric validation, so hidden stale values cannot block a new model. */
export function geminiEffectiveSettings(config,settings={}) {
 const profile=geminiProfile(config);if(!profile)return settings;
 const out={...settings};
 if(profile.sampling==='unsupported'){delete out.temperature;delete out.topP;}
 if(profile.thinking==='unsupported')delete out.reasoning;
 return out;
}
