/** Text acceptance host 0.1.0, 2026-10-30.
 * Runs the production serializer/transport/SSE parser once. Node observations
 * cannot establish browser CORS, visible rendering or independent provenance.
 * Default is plan-only; no key lookup, provider request or report write.
 */
import {createHash} from 'node:crypto';
import {readFile, readdir, mkdir, open} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateText, canonicalEndpoint, validateEndpoint} from '../src/core.js';
import {getNetworkLogs, clearNetworkLogs, sanitizeLogValue, setLogSecrets} from '../src/logs.js';

export const HOST_VERSION = '0.1.0';
export const EXPECTED = 'STREAM_OK\n第一行：你好。\n第二行：流式验收。';
export const PROMPT = `Reply with exactly these three lines, without explanation:\n${EXPECTED}`;
const keyNames = {ark:'ARK_API_KEY',gemini:'GEMINI_API_KEY',openai:'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY'};
const hash = value => createHash('sha256').update(value).digest('hex');
const reject = message => { throw new Error(message); };

export function makePlan(argv) {
  const options = {};
  for (let i=0;i<argv.length;i++) {
    const name=argv[i];
    if (Object.hasOwn(options,name)) reject('Duplicate option.');
    if(name==='--execute') options[name]=true;
    else if(['--protocol','--endpoint','--model','--output-tokens','--report'].includes(name)) {
      if(!argv[i+1] || argv[i+1].startsWith('--')) reject('Missing option value.');
      options[name]=argv[++i];
    } else reject('Unknown option; use --help.');
  }
  const protocol=options['--protocol'];
  if(!Object.hasOwn(keyNames,protocol)) reject('Choose ark, gemini, openai or anthropic.');
  const endpoint=canonicalEndpoint(options['--endpoint']);
  const model=options['--model'];
  if(typeof model!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(model)) reject('Supply a model ID (not a credential).');
  const outputTokens=Number(options['--output-tokens']??128);
  if(!Number.isInteger(outputTokens)||outputTokens<16||outputTokens>1024) reject('Output budget must be 16..1024 tokens.');
  if(options['--execute'] && !options['--report']) reject('--execute requires a new --report path.');
  return {hostVersion:HOST_VERSION,protocol,endpoint,model,keyEnvironment:keyNames[protocol],
    execute:options['--execute']===true,report:options['--report']??null,
    outputTokens,requests:1,retries:0,timeoutMs:60000,prompt:PROMPT};
}

export function assess({response,deltaCount,deltaText,httpStatus,contentType,error}) {
  const passed=!error && httpStatus>=200 && httpStatus<300 &&
    contentType?.toLowerCase().includes('text/event-stream') && deltaCount>0 &&
    response?.completion?.status==='complete' && response.text===deltaText &&
    response.text.trim()===EXPECTED && response.toolCalls.length===0;
  return {samplePassed:Boolean(passed),multipleDeltasObserved:deltaCount>1,
    browserCORS:'not-tested',browserRendering:'not-tested',agentImage:'not-tested',
    productCLI:'not-tested',externalHost:'not-tested',generalGoalSatisfied:'unknown'};
}

async function sourceHashes() {
  const root=new URL('../',import.meta.url), files=['qa/text-stream-live.mjs'];
  async function walk(dir) {
    for(const entry of await readdir(new URL(dir,root),{withFileTypes:true})) {
      if(entry.isDirectory())await walk(`${dir}${entry.name}/`);
      else if(entry.isFile())files.push(`${dir}${entry.name}`);
    }
  }
  await walk('src/');
  return Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,hash(await readFile(new URL(p,root)))])));
}

export async function run(plan) {
  if(!plan.execute) return {status:'PLAN_ONLY',...plan};
  const key=process.env[plan.keyEnvironment];
  if(!key) reject('Selected key environment is not configured; no request sent.');
  setLogSecrets([key]);
  const config={protocol:plan.protocol,url:plan.endpoint,trustedTarget:plan.endpoint,model:plan.model,key};
  validateEndpoint(config);
  // Credential material accidentally placed in configuration must not reach a report.
  if(JSON.stringify(plan).includes(key.trim())) reject('Credential found outside its environment binding.');
  const report={schemaVersion:1,hostVersion:HOST_VERSION,startedAt:new Date().toISOString(),
    runtime:process.version,scope:'Node production generateText, single fixed sample',
    provenance:{transport:'process global fetch',independentlyVerified:false},
    plan:{...plan,report:undefined},sourceSha256:await sourceHashes(),status:'STARTED',
    observations:{deltaCount:0,deltaTimesMs:[],firstDeltaMs:null,elapsedMs:null},
    limits:'Token budget and timeout are request constraints, not a monetary cap. No browser/CLI/Agent certification.'};
  const path=resolve(plan.report);
  await mkdir(dirname(path),{recursive:true});
  const file=await open(path,'wx',0o600); // Refuse overwrite before any outbound effect.
  const save=async()=>{await file.truncate(0);await file.write(JSON.stringify(report,null,2)+'\n',0,'utf8');await file.sync();};
  let timer;
  try {
    await save();
    clearNetworkLogs();
    const controller=new AbortController(), start=performance.now();
    timer=setTimeout(()=>controller.abort(),plan.timeoutMs);
    let response,error,deltaText='';
    try {
      response=await generateText({config,messages:[{role:'user',content:PROMPT}],settings:{output:plan.outputTokens},
        signal:controller.signal,onDelta:delta=>{
          if(!delta)return;
          const elapsed=Math.round(performance.now()-start);
          report.observations.firstDeltaMs??=elapsed;
          report.observations.deltaCount++;
          if(report.observations.deltaTimesMs.length<256)report.observations.deltaTimesMs.push(elapsed);
          deltaText+=delta;
        }});
    } catch(caught) {
      error={code:typeof caught.code==='string'?caught.code:'UNCLASSIFIED',httpStatus:caught.status??null};
    }
    clearTimeout(timer);
    const events=getNetworkLogs(), last=events.at(-1);
    report.observations={...report.observations,elapsedMs:Math.round(performance.now()-start),
      requestsObserved:events.length,httpStatus:last?.status??null,responseHeaders:last?.responseHeaders??{},
      finishReason:response?.finishReason??null,completion:response?.completion??null,
      usage:response?.usage??null,textCharacters:deltaText.length,textSha256:hash(deltaText),error};
    report.assessment=assess({response,deltaCount:report.observations.deltaCount,deltaText,
      httpStatus:last?.status,contentType:last?.responseHeaders?.['content-type'],error});
    // Sanitize upstream-selected metadata; never write headers, messages, raw output or keys wholesale.
    report.observations=sanitizeLogValue(report.observations,{preserveRootKeys:true});
    report.status=report.assessment.samplePassed?'SAMPLE_PASS':'SAMPLE_NOT_PASSED';
    report.finishedAt=new Date().toISOString();
    await save();
    return {status:report.status,assessment:report.assessment};
  } finally {clearTimeout(timer);await file.close();}
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.slice(2).includes('--help')) console.log(`Text acceptance host ${HOST_VERSION} (Node, not browser/CLI certification).
node qa/text-stream-live.mjs --protocol ark|gemini|openai|anthropic --endpoint HTTPS_BASE --model MODEL
Default: plan only. To make ONE potentially billable request, add --execute --report NEW_FILE.json.
Optional --output-tokens 128 (16..1024); fixed prompt; timeout 60s; no retry.
Key: protocol-specific ARK_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY.
Never put keys in arguments. See docs/LIVE_ACCEPTANCE.md.`);
  else try {
    const result=await run(makePlan(process.argv.slice(2)));
    console.log(JSON.stringify(result,null,2));
    if(result.status==='SAMPLE_NOT_PASSED')process.exitCode=1;
  } catch {console.error('Acceptance host could not run. Check arguments, selected key binding and unused report path; no raw error is printed. See --help.');process.exitCode=2;}
}
