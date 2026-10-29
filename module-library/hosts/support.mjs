import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { validateHosts } from '../../scripts/module-library.mjs';

export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V8AAAAASUVORK5CYII=';
export const imageReply = {data:[{b64_json:PNG}]};
export const textReply = text => ({choices:[{message:{role:'assistant',content:text}}]});
export function scriptedFetch(responses) {
  const pending = [...responses], requests = [];
  return {requests, remaining:()=>pending.length, fetchImpl:async (url,options)=>{
    assert(pending.length,'Unexpected extra request');
    requests.push({url,method:options.method,body:JSON.parse(options.body)});
    return new Response(JSON.stringify(pending.shift()),{status:200});
  }};
}
export function parseOptions(args) {
  const options = {live:false,prompt:'Draw one blue cup on a white background.'};
  const seen = new Set();
  for (let i=0;i<args.length;i++) {
    const key=args[i];
    if (seen.has(key)) throw Error('Duplicate option: '+key);
    seen.add(key);
    if (key==='--live') options.live=true;
    else if (key==='--help') options.help=true;
    else if (['--prompt','--out'].includes(key) && args[i+1] && !args[i+1].startsWith('--')) options[key.slice(2)]=args[++i];
    else throw Error('Use --live, --prompt TEXT, --out DIRECTORY, or --help');
  }
  return options;
}
export async function persistImages(result, options) {
  assert(result.images?.length>0,'No image result');
  const base=options.out?resolve(options.out):tmpdir();
  await mkdir(base,{recursive:true});
  const directory=await mkdtemp(join(base,'module-host-'));
  const files=[];
  for (let i=0;i<result.images.length;i++) {
    const image=result.images[i];
    const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[image.mimeType];
    assert(ext,'Unsupported image format');
    const bytes=Buffer.from(image.data,'base64');
    assert(bytes.length>0,'Empty image bytes');
    const path=join(directory,'image-'+(i+1)+'.'+ext);
    await writeFile(path,bytes,{flag:'wx'});
    assert.deepEqual(await readFile(path),bytes,'File readback differs from response');
    files.push({path,mimeType:image.mimeType,bytes:bytes.length});
  }
  return files;
}

export async function runHost(moduleId, exercise) {
  const secrets=[];
  let metadata={moduleId}, previousFetch, guarded=false;
  try {
    const catalog=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
    const registry=JSON.parse(await readFile(new URL('./catalog.json',import.meta.url),'utf8'));
    const module=catalog.modules.find(m=>m.id===moduleId);
    const host=registry.hosts.find(h=>h.id===module?.host.id);
    assert(module && host,'Unknown module host');
    await validateHosts({modules:[module]},{schemaVersion:1,hosts:[host]});
    const options=parseOptions(process.argv.slice(2));
    const mode=options.live?'live':host.defaultMode;
    metadata={module:{id:module.id,version:module.version},host:{id:host.id,version:host.version,
      createdAt:host.createdAt,updatedAt:host.updatedAt},mode,effect:host.goal,lifecycle:module.lifecycle.state};
    if (options.help) {
      console.log(JSON.stringify({...metadata,usage:'node '+host.entry+' [--live] [--prompt TEXT] [--out DIRECTORY]',supportedModes:host.modes},null,2));
      return;
    }
    assert(host.modes.includes(mode),'Live mode is not applicable to this host');
    const realFetch=globalThis.fetch;
    if (mode!=='live') {
      previousFetch=realFetch; guarded=true;
      globalThis.fetch=()=>{throw Error('Unexpected real network in a local/synthetic host');};
    }
    // Local state routing does not need an image/text provider or its shared state.
    const provider=moduleId==='R-002'?null:moduleId==='F-001'
      ?await import('../../src/image-capabilities.js'):await import('../../src/core.js');
    const config=kind=>{
      if (mode!=='live') return {protocol:'ark',url:'https://host.example.com/api/v3',trustedTarget:'https://host.example.com/api/v3',
        key:'synthetic-host-key',model:kind==='image'?provider.ARK_FLASH_MODEL:provider.ARK_TEXT_MODEL};
      const key=process.env.ARK_API_KEY || '';
      if (!key.trim()) throw Error('Live mode requires ARK_API_KEY');
      secrets.push(key);
      const endpoint=provider.canonicalEndpoint(process.env.ARK_BASE_URL || provider.ARK_ENDPOINT);
      return {protocol:'ark',url:endpoint,trustedTarget:endpoint,key,
        model:kind==='image'?(process.env.ARK_IMAGE_MODEL || provider.ARK_FLASH_MODEL):(process.env.ARK_TEXT_MODEL || provider.ARK_TEXT_MODEL)};
    };
    const observed=await exercise({mode,options,config,realFetch,signal:AbortSignal.timeout(120000)});
    console.log(JSON.stringify({schemaVersion:1,status:'PASS',...metadata,verifiedAt:new Date().toISOString(),
      observed,limits:host.limits},null,2));
  } catch (error) {
    let message=error.message || 'Host failed';
    for (const key of secrets) message=message.split(key).join('[REDACTED]');
    console.log(JSON.stringify({schemaVersion:1,status:'FAIL',...metadata,verifiedAt:new Date().toISOString(),message},null,2));
    process.exitCode=1;
  } finally {if(guarded) globalThis.fetch=previousFetch;}
}
