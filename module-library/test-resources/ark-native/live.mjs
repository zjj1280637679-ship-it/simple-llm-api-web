/** Opt-in, one-request ordinary Ark probe. Importing this file never reads a key or calls fetch. */
import {inspectPng} from '../shared/png.mjs';
export const ARK_LIVE_ENDPOINT='https://ark.cn-beijing.volces.com/api/v3';
const fields={text:['maxOutputTokens','thinking'],image:['size']};
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const utc=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export function validateLivePlan(plan,{now=Date.now()}={}) {
  if(!plain(plan)||!['text','image'].includes(plan.operation))fail('ARK_LIVE_PLAN_REQUIRED');
  const keys=['schemaVersion','operation','model','prompt','maxRequests','maxCostCny','estimatedCostCny','approved','approvalId','approvedAt','expiresAt',...fields[plan.operation]];
  if(Object.keys(plan).length!==keys.length||keys.some(key=>!Object.hasOwn(plan,key)))fail('ARK_LIVE_PLAN_FIELDS');
  if(plan.schemaVersion!==1||plan.approved!==true||plan.maxRequests!==1)fail('ARK_LIVE_APPROVAL_REQUIRED');
  if(typeof plan.approvalId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(plan.approvalId))fail('ARK_LIVE_APPROVAL_REQUIRED');
  if(!utc(plan.approvedAt)||!utc(plan.expiresAt)||Date.parse(plan.approvedAt)>now||Date.parse(plan.expiresAt)<=now||Date.parse(plan.expiresAt)-Date.parse(plan.approvedAt)>86400000)fail('ARK_LIVE_APPROVAL_EXPIRED');
  if(typeof plan.model!=='string'||!/^(?:doubao-[a-z0-9-]+|ep-[a-zA-Z0-9-]+)$/.test(plan.model))fail('ARK_LIVE_MODEL_REQUIRED');
  if(typeof plan.prompt!=='string'||!plan.prompt.trim()||plan.prompt.length>2000)fail('ARK_LIVE_PROMPT_LIMIT');
  if(!Number.isFinite(plan.maxCostCny)||plan.maxCostCny<=0||plan.maxCostCny>100||!Number.isFinite(plan.estimatedCostCny)||plan.estimatedCostCny<=0||plan.estimatedCostCny>plan.maxCostCny)fail('ARK_LIVE_COST_APPROVAL_REQUIRED');
  if(plan.operation==='text'&&(!Number.isInteger(plan.maxOutputTokens)||plan.maxOutputTokens<1||plan.maxOutputTokens>1024))fail('ARK_LIVE_OUTPUT_LIMIT');
  if(plan.operation==='text'&&(!plain(plan.thinking)||Object.keys(plan.thinking).length!==1||plan.thinking.type!=='disabled'))fail('ARK_LIVE_THINKING_LIMIT');
  if(plan.operation==='image'&&plan.size!=='1536x1536')fail('ARK_LIVE_IMAGE_LIMIT');
  return structuredClone(plan);
}
const safeUsage=value=>plain(value)?Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens'].filter(key=>Number.isFinite(value[key])&&value[key]>=0).map(key=>[key,value[key]])):null;
/** testTransport is explicitly labeled SIMULATED; it never reads process.env or default fetch. */
export async function runArkLiveProbe({enabled=false,plan,environment,testTransport,signal,now=()=>Date.now()}={}) {
  if(enabled!==true)fail('ARK_LIVE_DISABLED');
  plan=validateLivePlan(plan,{now:now()});
  const simulated=testTransport!==undefined;
  if(simulated&&typeof testTransport!=='function')fail('ARK_LIVE_TEST_TRANSPORT');
  const key=simulated?'SIMULATOR_ONLY_NOT_A_REAL_KEY':(environment??process.env).ARK_API_KEY;
  if(typeof key!=='string'||!key.trim())fail('ARK_LIVE_KEY_REQUIRED');
  if(!simulated&&key.trim()==='SIMULATOR_ONLY_NOT_A_REAL_KEY')fail('ARK_LIVE_DUMMY_KEY');
  if(signal?.aborted)fail('ARK_LIVE_CANCELLED_BEFORE_REQUEST');
  const fetchImpl=simulated?testTransport:globalThis.fetch;
  if(typeof fetchImpl!=='function')fail('ARK_LIVE_TRANSPORT_UNAVAILABLE');
  const startedAt=new Date(now()).toISOString(),body=plan.operation==='text'
    ?{model:plan.model,messages:[{role:'user',content:plan.prompt}],stream:false,max_completion_tokens:plan.maxOutputTokens,thinking:plan.thinking}
    :{model:plan.model,prompt:plan.prompt,size:plan.size,response_format:'b64_json',output_format:'png'};
  const result={schemaVersion:1,mode:'live',evidenceType:simulated?'SIMULATED':'LIVE_RUN',realApiCalled:!simulated,
    transport:simulated?'test-double':'official-network',adapterVerified:false,approvalId:plan.approvalId,
    operation:plan.operation,model:plan.model,attemptedRequests:1,maxRequests:1,retries:0,fallbacks:0,
    approvedMaxCostCny:plan.maxCostCny,estimatedCostCny:plan.estimatedCostCny,
    costLimitType:'preflight-estimate-only-not-provider-billing-cap',startedAt};
  // Bound lifetime even if the caller omits a signal; cancellation never triggers another request.
  const timeout=AbortSignal.timeout(120000),boundedSignal=signal?AbortSignal.any([signal,timeout]):timeout;
  try {
    const response=await fetchImpl(ARK_LIVE_ENDPOINT+(plan.operation==='text'?'/chat/completions':'/images/generations'),{
      method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+key.trim()},
      body:JSON.stringify(body),signal:boundedSignal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
    result.httpStatus=response.status;
    if(!response.ok)return {...result,status:'FAIL',code:'ARK_LIVE_HTTP',finishedAt:new Date(now()).toISOString()};
    const payload=await response.json();
    if(boundedSignal.aborted)throw new Error('cancelled');
    let observed;
    if(plan.operation==='text') {
      const text=payload?.choices?.[0]?.message?.content;
      if(typeof text!=='string'||!text.trim())fail('ARK_LIVE_EMPTY_TEXT');
      observed={textCharacters:text.length,usage:safeUsage(payload.usage)};
    } else {
      if(!Array.isArray(payload?.data)||payload.data.length!==1)fail('ARK_LIVE_IMAGE_COUNT');
      const image=payload.data[0],data=image?.b64_json;
      if(typeof data!=='string'||data.length>80000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length%4)fail('ARK_LIVE_IMAGE_DATA');
      const bytes=Buffer.from(data,'base64');
      if(image.output_format&&image.output_format!=='png')fail('ARK_LIVE_IMAGE_DATA');
      let png;try{png=inspectPng(bytes);}catch{fail('ARK_LIVE_IMAGE_DATA');}
      observed={images:1,bytes:bytes.length,mimeType:'image/png',width:png.width,height:png.height,pngValidation:png.validation,usage:safeUsage(payload.usage)};
    }
    return {...result,status:'PASS',observed,finishedAt:new Date(now()).toISOString()};
  } catch(error) {
    // Never return upstream messages, URLs, payloads, headers, prompts, credentials, or causes.
    const code=boundedSignal.aborted?'ARK_LIVE_CANCELLED':/^ARK_LIVE_(EMPTY_TEXT|IMAGE_COUNT|IMAGE_DATA)$/.test(error?.code||'')?error.code:'ARK_LIVE_TRANSPORT_OR_RESPONSE';
    return {...result,status:'FAIL',code,finishedAt:new Date(now()).toISOString()};
  }
}
