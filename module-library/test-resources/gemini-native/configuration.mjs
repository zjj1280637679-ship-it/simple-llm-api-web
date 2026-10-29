/** Gemini protocol mapping; shared profile store/probability/timing engine stays provider-neutral. */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {getManifest,getFixture} from './index.mjs';
import {createConfigurationApi} from '../shared/configuration.mjs';
const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const adapter={
  outputKind:scenario=>['text.ok','transport.delay','transport.hang'].includes(scenario)?'text':null,
  presetFields:()=>['text','usage'],
  readPreset:response=>({text:response.json.candidates[0].content.parts[0].text,usage:structuredClone(response.json.usageMetadata)}),
  validatePreset(preset,kind,{shape,string,integer,fail}) {
    string(preset.text,'output.presets.text',65536,true);
    const value=preset.usage,field='output.presets.usage';
    shape(value,['promptTokenCount','candidatesTokenCount','totalTokenCount'],field);
    for(const key of Object.keys(value))integer(value[key],0,10000000,field+'.'+key);
    if(value.totalTokenCount!==value.promptTokenCount+value.candidatesTokenCount)fail(field+'.totalTokenCount');
  },
  outputTokens:preset=>preset.usage.candidatesTokenCount,
  applyPreset(response,preset,{cacheHit}) {
    response.json.candidates[0].content.parts=[{text:preset.text}];response.json.usageMetadata=structuredClone(preset.usage);
    if(cacheHit)response.json.usageMetadata.cachedContentTokenCount=preset.usage.promptTokenCount;
  },
  defaultError:()=>({httpStatus:429,status:'RESOURCE_EXHAUSTED',message:'SIMULATED configured error'}),
  readError:response=>({httpStatus:response.status,status:response.json.error.status,message:response.json.error.message}),
  validateError(value,{shape,integer,string,fail}) {
    shape(value,['httpStatus','status','message'],'error');integer(value.httpStatus,400,599,'error.httpStatus');
    if(typeof value.status!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(value.status))fail('error.status');
    string(value.message,'error.message');
  },
  applyError(response,error) {response.status=error.httpStatus;response.json={error:{code:error.httpStatus,status:error.status,message:error.message}};}
};
export const {CONFIGURATION_API_VERSION,CONFIGURATION_SCHEMA_VERSION,getConfigurationPreset,validateConfiguration,validateConfigurationSnapshot,resolveConfiguration,createConfiguredSimulator,createConfigurationStore}=createConfigurationApi({getManifest,getFixture,adapter,repoRoot,defaultDirectory:resolve(repoRoot,'output/gemini-simulator-profiles'),namespace:'gemini-config-v1'});
