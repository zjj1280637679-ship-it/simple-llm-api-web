/** Tiny, owned host fixture; no provider package, production adapter, or credentials. */
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createConfigurationApi} from '../../relations/configuration-profile/index.mjs';

export function configurationFixture({directory,namespace='profile-host-v1',text='first reply'}={}) {
  const sourceFixture={id:'profile-host-text',parameters:{prompt:{type:'string',default:'hello'}},steps:[{
    request:{method:'POST',url:'https://profile.example.invalid/text',headers:{'content-type':'application/json'},body:{prompt:{$parameter:'prompt'}}},
    response:{status:200,json:{text,tokens:2}}
  }]};
  const manifest={resourceId:'host-inline-profile',resourceVersion:'1.0.0',fixtureSetVersion:'1.0.0',
    protocolSnapshot:'host-inline-json-v1',configurationApiVersion:'0.2.0',configurationSchemaVersion:'1.0.0',
    fixtures:[{id:sourceFixture.id,sha256:createHash('sha256').update(JSON.stringify(sourceFixture)).digest('hex')}],
    scenarios:[{id:'text.ok',version:'1.0.0',fixtureId:sourceFixture.id}]};
  const adapter={
    outputKind:scenario=>scenario==='text.ok'?'text':null,
    presetFields:()=>['text','tokens'],
    readPreset:response=>structuredClone(response.json),
    validatePreset(preset,_kind,{string,integer}) {string(preset.text,'output.presets.text',65536,true);integer(preset.tokens,0,10000000,'output.presets.tokens');},
    outputTokens:preset=>preset.tokens,
    applyPreset(response,preset,{cacheHit}) {response.json={text:preset.text,tokens:preset.tokens,cached:cacheHit};},
    defaultError:()=>({httpStatus:429,message:'SIMULATED configured error'}),
    readError:response=>({httpStatus:response.status,message:response.json.error}),
    validateError(value,{shape,string,integer}) {shape(value,['httpStatus','message'],'error');integer(value.httpStatus,400,599,'error.httpStatus');string(value.message,'error.message');},
    applyError(response,error) {response.status=error.httpStatus;response.json={error:error.message};}
  };
  const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
  const getFixture=()=>structuredClone(sourceFixture);
  const api=createConfigurationApi({getManifest:()=>structuredClone(manifest),getFixture,adapter,repoRoot,
    defaultDirectory:directory||resolve(repoRoot,'output/profile-host'),namespace});
  return {api,manifest,sourceFixture};
}

export async function requestProfile(sim) {
  const prompt=sim.snapshot().configuration.parameters.prompt;
  return (await sim.fetch('https://profile.example.invalid/text',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt})
  })).json();
}
