/** Shared command parser and virtual fixture replay; provider semantics are injected. */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function createSimulatorCli({provider,label,commandName,api}) {
  const {createConfigurationStore,getConfigurationPreset,validateConfigurationSnapshot,resolveConfiguration}=api;
const help=`${label} simulator configuration (SIMULATED; no network, no HTTP server)
  npm run ${commandName} -- preset [--scenario text.ok]
  npm run ${commandName} -- restore --profile demo [--scenario text.ok | --revision 1]
  npm run ${commandName} -- show|history --profile demo [--revision N]
  npm run ${commandName} -- set --profile demo --json '{"parameters":{"prompt":"Hello"}}'
  npm run ${commandName} -- load --profile demo --file config-or-export.json
  npm run ${commandName} -- save --profile demo --file new-export.json [--revision N]
  npm run ${commandName} -- reset|replay --profile demo [--revision N] [--sample-index N]
Common: --dir DIRECTORY (default ignored output/${provider}-simulator-profiles).
set merges objects; arrays replace whole. Change scenario with restore or load.
reset starts a NEW empty process-local runtime; it does not stop other processes.
restore appends a revision; replay pins a revision, uses virtual time, and explicitly
cancels hang scenarios. No streaming is implemented; speed delays one JSON response.`;
const allowed={preset:['scenario'],restore:['scenario','revision'],show:['revision'],history:[],set:['json'],load:['file'],save:['file','revision'],reset:['revision','sample-index'],replay:['revision','sample-index']};
const parseJson=source=>{try{return JSON.parse(source);}catch{throw Error('INVALID_JSON');}};
function bind(value,parameters) {
  if(value&&typeof value==='object') {
    if(Object.keys(value).length===1&&Object.hasOwn(value,'$parameter'))return parameters[value.$parameter];
    return Array.isArray(value)?value.map(item=>bind(item,parameters)):Object.fromEntries(Object.entries(value).map(([key,item])=>[key,bind(item,parameters)]));
  }
  return value;
}
async function main(args=process.argv.slice(2)) {
  const command=args[0];if(!command||command==='help'||command==='--help')return {help};
  if(!Object.hasOwn(allowed,command))throw Error('UNKNOWN_COMMAND');
  const options={};
  for(let i=1;i<args.length;i+=2) {
    const key=args[i].startsWith('--')?args[i].slice(2):'';
    if(!['dir','profile',...allowed[command]].includes(key)||Object.hasOwn(options,key)||args[i+1]===undefined)throw Error('INVALID_OPTION');
    options[key]=args[i+1];
  }
  for(const key of ['revision','sample-index'])if(options[key]!==undefined) {
    if(!/^(0|[1-9]\d*)$/.test(options[key])||!Number.isSafeInteger(Number(options[key])))throw Error('INVALID_NUMBER');
    options[key]=Number(options[key]);
  }
  if(command==='preset')return getConfigurationPreset(options.scenario);
  const store=createConfigurationStore({...(options.dir?{directory:options.dir}:{})}),profile=options.profile||'default';
  if(command==='show')return store.show(profile,options.revision);
  if(command==='history')return store.history(profile);
  if(command==='restore') {
    if(options.scenario!==undefined&&options.revision!==undefined)throw Error('CHOOSE_SCENARIO_OR_REVISION');
    return store.restore(profile,{scenario:options.scenario,revision:options.revision});
  }
  if(command==='set') {if(options.json===undefined)throw Error('JSON_REQUIRED');return store.set(profile,parseJson(options.json));}
  if(command==='load') {
    if(!options.file)throw Error('FILE_REQUIRED');let config=parseJson(await readFile(options.file,'utf8'));
    if(config&&typeof config==='object'&&Object.hasOwn(config,'snapshotSha256'))config=validateConfigurationSnapshot(config).configuration;
    return store.load(profile,config);
  }
  if(command==='save'){if(!options.file)throw Error('FILE_REQUIRED');return store.save(profile,options.file,{revision:options.revision});}
  let now=0,next=0;const jobs=new Map();
  const scheduler={setTimeout(callback,ms){const id=++next;jobs.set(id,true);queueMicrotask(()=>{if(jobs.delete(id)){now+=ms;callback();}});return id;},clearTimeout(id){jobs.delete(id);}};
  const sim=await store.start(profile,{revision:options.revision,sampleIndex:options['sample-index']??0,clock:()=>now,scheduler});
  if(command==='reset')return {operation:'new-runtime',persistentRuntime:false,simulation:sim.inspect()};
  const snapshot=sim.snapshot(),{fixture}=resolveConfiguration(snapshot,{sampleIndex:options['sample-index']??0}),responses=[];
  for(const step of bind(fixture.steps,snapshot.configuration.parameters)) {
    const controller=new AbortController(),request=step.request;
    const pending=sim.fetch(request.url,{method:request.method,headers:request.headers,
      ...(request.body===undefined?{}:{body:JSON.stringify(request.body)}),signal:controller.signal});
    // Install rejection handling before yielding. Intentional transport rejection is observable.
    const outcome=pending.then(async response=>({status:response.status,body:await response.text()}),error=>({error:typeof error.code==='string'?error.code:error.name}));
    await new Promise(resolve=>setImmediate(resolve));
    if(step.response.hang)controller.abort(new DOMException('SIMULATED replay cancellation','AbortError'));
    responses.push(await outcome);
  }
  const simulation=sim.assertComplete();sim.dispose();
  return {operation:'fixture-transport-preview',adapterVerified:false,virtualTime:true,hangCancelled:fixture.steps.some(step=>step.response.hang),responses,simulation};
}
return main;
}
export function runSimulatorCli(main,url) {
  if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(url))main().then(result=>console.log(result.help||JSON.stringify(result,null,2))).catch(error=>{
    console.error(JSON.stringify({status:'ERROR',code:error.code||(['INVALID_JSON','UNKNOWN_COMMAND','INVALID_OPTION','INVALID_NUMBER','CHOOSE_SCENARIO_OR_REVISION','JSON_REQUIRED','FILE_REQUIRED'].includes(error.message)?error.message:'SIMULATOR_COMMAND_FAILED')}));process.exitCode=1;
  });
}
