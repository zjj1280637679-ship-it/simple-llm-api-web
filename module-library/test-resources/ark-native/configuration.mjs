/** Ordinary Ark mapping. Presets are synthetic output only, not generation/quality evidence. */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {inspectPng} from '../shared/png.mjs';
import {getManifest,getFixture} from './index.mjs';
import {createConfigurationApi} from '../shared/configuration.mjs';
const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
// Editable image presets are complete bounded PNGs; dimensions are measured, not inferred from request size.
function pngPreset(value,fail) {
  if(typeof value!=='string'||value.length>4194304||value.length%4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail('output.presets.b64Json');
  try {inspectPng(Buffer.from(value,'base64'),{maxBytes:3145728,maxPixels:16777216,maxDimension:4096});}catch{fail('output.presets.png');}
}
const adapter={
  isHttp:scenario=>scenario.startsWith('http.')||scenario==='image.http.400',
  outputKind:scenario=>['text.ok','transport.delay','transport.hang'].includes(scenario)?'text':scenario==='image.output'?'image':null,
  presetFields:kind=>kind==='text'?['text','usage']:['b64Json'],
  readPreset:(response,kind)=>kind==='text'?{text:response.json.choices[0].message.content,usage:structuredClone(response.json.usage)}:{b64Json:response.json.data[0].b64_json},
  validatePreset(preset,kind,{shape,string,integer,fail}) {
    if(kind==='image')return pngPreset(preset.b64Json,fail);
    string(preset.text,'output.presets.text',65536,true);
    const value=preset.usage,field='output.presets.usage';shape(value,['prompt_tokens','completion_tokens','total_tokens'],field);
    for(const key of Object.keys(value))integer(value[key],0,10000000,field+'.'+key);
    if(value.total_tokens!==value.prompt_tokens+value.completion_tokens)fail(field+'.total_tokens');
  },
  outputTokens:preset=>preset.usage?.completion_tokens||0,
  applyPreset(response,preset,{cacheHit,kind}) {
    if(kind==='image') {const png=inspectPng(Buffer.from(preset.b64Json,'base64'));Object.assign(response.json.data[0],{b64_json:preset.b64Json,size:`${png.width}x${png.height}`,output_format:'png'});response.json.usage={generated_images:1};return;}
    response.json.choices[0].message.content=preset.text;response.json.usage=structuredClone(preset.usage);
    if(cacheHit)response.json.usage.prompt_tokens_details={cached_tokens:preset.usage.prompt_tokens};
  },
  defaultError:()=>({httpStatus:429,code:'RateLimitExceeded',message:'SIMULATED configured error'}),
  readError:response=>({httpStatus:response.status,code:response.json.error.code,message:response.json.error.message}),
  validateError(value,{shape,integer,string,fail}) {
    shape(value,['httpStatus','code','message'],'error');integer(value.httpStatus,400,599,'error.httpStatus');
    if(typeof value.code!=='string'||!/^[A-Za-z][A-Za-z0-9_.]{0,127}$/.test(value.code))fail('error.code');
    string(value.message,'error.message');
  },
  applyError(response,error) {response.status=error.httpStatus;response.json={error:{code:error.code,message:error.message}};}
};
export const {CONFIGURATION_API_VERSION,CONFIGURATION_SCHEMA_VERSION,getConfigurationPreset,validateConfiguration,validateConfigurationSnapshot,resolveConfiguration,createConfiguredSimulator,createConfigurationStore}=createConfigurationApi({getManifest,getFixture,adapter,repoRoot,defaultDirectory:resolve(repoRoot,'output/ark-simulator-profiles'),namespace:'ark-config-v1'});
