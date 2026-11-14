/** MiniMax-H3 ref2va browser transport. No GPU ownership, polling loop or storage.
 * POST acknowledgements, task completion and local delivery remain separate facts.
 * Contract: docs/contracts/video-api.json; host observations are not live GPU proof. */
import {recordNetwork,setLogSecrets} from './logs.js';
import {describeTransport} from './transport-evidence.js';

const MIB=1024*1024, JOB_ID=/^[a-f0-9]{32}$/, REQUEST_ID=/^[A-Za-z0-9._:-]{1,128}$/;
const STATUSES=new Set(['queued','running','cancel_requested','succeeded','failed','cancelled']);
export const VIDEO_DEFAULTS=Object.freeze({seconds:5,width:960,height:544,steps:50,seed:42,attention_backend:'auto',acceleration_lora:'none'});
export const VIDEO_ACCELERATION=Object.freeze({attention_backends:Object.freeze(['auto','native','_native_flash']),acceleration_loras:Object.freeze(['none','lightx2v-ref2va-4step'])});
export const VIDEO_LIMITS=Object.freeze({files:12,image:9,video:3,audio:3,fileBytes:32*MIB,totalBytes:64*MIB,
  prompt:4000,minSeconds:5,maxSeconds:14.375,minDimension:256,maxDimension:1344,maxPixels:1344*768,
  minSteps:2,maxSteps:50,maxSeed:2147483647,downloadBytes:256*MIB});
export const VIDEO_EXTENSIONS=Object.freeze({image:Object.freeze(['.jpg','.jpeg','.png','.webp']),
  video:Object.freeze(['.mp4','.mov','.webm']),audio:Object.freeze(['.wav','.mp3','.m4a','.flac','.ogg'])});
export class VideoApiError extends Error {
  constructor(code,message,{httpStatus=null,unknown=false,jobId=null,idempotencyKey=null,retryAfter=null}={}) {
    super(message);this.name='VideoApiError';Object.assign(this,{code,httpStatus,unknown,jobId,idempotencyKey,retryAfter});
  }
}
const fail=(code,message,details)=>{throw new VideoApiError(code,message,details);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const aborted=()=>new VideoApiError('CANCELLED','已停止本次网络操作；服务器任务是否结束仍需查询。');
const checkAbort=signal=>{if(signal?.aborted)throw aborted();};
function validJobId(id){if(typeof id!=='string'||!JOB_ID.test(id))fail('INPUT','任务 ID 应为 32 位小写十六进制字符。');return id;}

export function normalizeVideoEndpoint(value) {
  if(typeof value!=='string'||!value.trim())fail('ENDPOINT','请填写自建视频 API 地址。');
  let url;try{url=new URL(value.trim());}catch{fail('ENDPOINT','视频 API 地址无效。');}
  const loopback=url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.hostname==='[::1]';
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))||url.username||url.password||url.search||url.hash)
    fail('ENDPOINT','请使用 HTTPS API 地址（本机允许 HTTP），地址不能包含凭据、查询参数或片段。');
  // The notebook exports an origin; /v1 is accepted as a convenience without doubling it.
  const path=url.pathname.replace(/\/+$/,'').replace(/\/v1$/,'');
  if(/%(?:2f|5c|2e)/i.test(path)||path.includes('\\'))fail('ENDPOINT','API 路径不能包含编码的路径分隔符。');
  return url.origin+path;
}

function number(value,fallback,label,{min,max,integer=false}={}) {
  if(value===undefined)value=fallback;
  if(typeof value==='string'&&value.trim())value=Number(value);
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))
    fail('INPUT',`${label}需为 ${min}–${max} 范围内的${integer?'整数':'数值'}。`);
  return value;
}
export function validateVideoCapabilities(value) {
  if(!object(value)||value.schema_version!==1||value.workflow!=='ref2va'||value.precision!=='bf16'||value.quantization!==false||!object(value.options)||typeof value.instance_id!=='string'||!value.instance_id||value.instance_id.length>128)
    fail('CAPABILITIES','服务未提供兼容的 ref2va / 原生 BF16 能力信息；可以查询已有任务，暂不提交新任务。');
  for(const [name,ids] of Object.entries(VIDEO_ACCELERATION)) {
    const options=value.options[name];
    if(!Array.isArray(options)||!options.length||options.some(item=>!object(item)||typeof item.id!=='string'||typeof item.supported!=='boolean'||typeof item.configured!=='boolean'||typeof item.ready!=='boolean')||new Set(options.map(item=>item.id)).size!==options.length)
      fail('CAPABILITIES','服务的加速能力列表无效，请重新连接查询。');
    if(!options.some(item=>item.id===ids[0]))fail('CAPABILITIES','服务缺少必要的基础生成选项。');
    if(name==='acceleration_loras')for(const item of options.filter(item=>ids.includes(item.id))) {
      const steps=item.steps;
      if(!object(steps)||!Number.isInteger(steps.min)||!Number.isInteger(steps.max)||steps.min<2||steps.max>50||steps.min>steps.max||
        steps.required!==undefined&&(!Number.isInteger(steps.required)||steps.required<steps.min||steps.required>steps.max)||
        item.id==='lightx2v-ref2va-4step'&&(steps.min!==5||steps.max!==5||steps.required!==5||steps.denoiser_evaluations!==4))
        fail('CAPABILITIES','服务的加速步数约束不兼容，请更新服务后重新连接。');
    }
  }
  return value;
}
export function validateVideoAcceleration(input,capabilities) {
  const attention_backend=input.attention_backend??VIDEO_DEFAULTS.attention_backend;
  const acceleration_lora=input.acceleration_lora??VIDEO_DEFAULTS.acceleration_lora;
  if(!VIDEO_ACCELERATION.attention_backends.includes(attention_backend)||!VIDEO_ACCELERATION.acceleration_loras.includes(acceleration_lora))
    fail('INPUT','请选择受支持的原生 BF16 注意力后端和加速 LoRA。');
  const steps=number(input.steps,VIDEO_DEFAULTS.steps,'推理步数',{min:2,max:50,integer:true});
  if(acceleration_lora==='lightx2v-ref2va-4step'&&steps!==5)fail('INPUT','LightX2V Turbo 必须显式设为 5 步（4 次模型评估）；当前步数未更改。');
  if(capabilities!==undefined) {
    validateVideoCapabilities(capabilities);
    for(const [list,id] of [['attention_backends',attention_backend],['acceleration_loras',acceleration_lora]]) {
      const option=capabilities.options[list].find(item=>item.id===id);
      if(!option?.supported||!option.configured)fail('CAPABILITIES',`所选${list==='attention_backends'?'注意力后端':'加速 LoRA'}未在此服务配置：${option?.reason||id}。`);
      if(list==='acceleration_loras'&&(steps<option.steps.min||steps>option.steps.max||option.steps.required!==undefined&&steps!==option.steps.required))
        fail('INPUT',`所选加速 LoRA 要求 ${option.steps.required??`${option.steps.min}–${option.steps.max}`} 步；请显式调整步数。`);
    }
  }
  return {attention_backend,acceleration_lora,steps};
}
export function validateVideoRequest(input) {
  if(!object(input))fail('INPUT','视频请求无效。');
  if(typeof input.prompt!=='string'||!input.prompt.trim()||[...input.prompt].length>VIDEO_LIMITS.prompt)
    fail('INPUT','请填写 1–4000 字的视频描述。');
  const files=input.files;
  if(!Array.isArray(files)||files.length<1||files.length>VIDEO_LIMITS.files)fail('INPUT','请添加 1–12 个参考文件。');
  let total=0;const counts={image:0,video:0,audio:0};
  for(const item of files) {
    if(!object(item)||!Object.hasOwn(VIDEO_EXTENSIONS,item.kind))fail('INPUT','参考类型必须是图片、视频或音频。');
    const file=item.file,extension=typeof file?.name==='string'?file.name.slice(file.name.lastIndexOf('.')).toLowerCase():'';
    if(!VIDEO_EXTENSIONS[item.kind].includes(extension)||!file||typeof file.arrayBuffer!=='function'||typeof file.stream!=='function')
      fail('INPUT','参考文件格式不受支持。');
    if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>VIDEO_LIMITS.fileBytes)fail('INPUT','单个参考文件须大于 0 且不超过 32 MiB。');
    total+=file.size;counts[item.kind]++;
  }
  if(total>VIDEO_LIMITS.totalBytes)fail('INPUT','参考文件合计不能超过 64 MiB。');
  if(counts.image>9||counts.video>3||counts.audio>3)fail('INPUT','最多 9 张图片、3 段视频和 3 段音频。');
  if(!counts.image&&!counts.video)fail('INPUT','至少添加一张图片或一段视频；不能只提交文本或音频。');
  const seconds=number(input.seconds,VIDEO_DEFAULTS.seconds,'视频时长',{min:5,max:14.375});
  const width=number(input.width,VIDEO_DEFAULTS.width,'宽度',{min:256,max:1344,integer:true});
  const height=number(input.height,VIDEO_DEFAULTS.height,'高度',{min:256,max:1344,integer:true});
  if(width%32||height%32||width*height>VIDEO_LIMITS.maxPixels)fail('INPUT','宽高须为 32 的倍数，且总像素不超过 1,032,192。');
  return {prompt:input.prompt,files:files.map(({kind,file})=>({kind,file})),seconds,width,height,
    ...validateVideoAcceleration(input),
    seed:number(input.seed,VIDEO_DEFAULTS.seed,'随机种子',{min:0,max:2147483647,integer:true})};
}

function validateJob(value,expected) {
  if(!object(value)||typeof value.id!=='string'||!JOB_ID.test(value.id)||!STATUSES.has(value.status)||(expected&&expected!==value.id))
    fail('RESPONSE','服务返回的任务身份或状态无效；请查询原任务，不要重复提交。');
  return value;
}
function retrySeconds(response) {
  const raw=response.headers?.get('retry-after');
  if(!raw)return null;const n=Number(raw);
  return Number.isFinite(n)&&n>=0?Math.min(n,300):null;
}
async function readBytes(response,maximum,signal) {
  const length=response.headers?.get('content-length');
  if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>maximum)) {
    try{await response.body?.cancel();}catch{}
    fail('RESPONSE','响应长度超过本次读取预算。');
  }
  if(!response.body?.getReader) {
    const bytes=new Uint8Array(await response.arrayBuffer());checkAbort(signal);
    if(bytes.byteLength>maximum)fail('RESPONSE','响应长度超过本次读取预算。');return bytes;
  }
  const reader=response.body.getReader(),parts=[];let size=0,done=false;
  try {
    while(true) {
      checkAbort(signal);const read=await reader.read();checkAbort(signal);
      if(read.done){done=true;break;}
      size+=read.value.byteLength;
      if(size>maximum)fail('RESPONSE','响应长度超过本次读取预算。');
      parts.push(read.value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return bytes;
  } finally {if(!done)try{await reader.cancel();}catch{}reader.releaseLock();}
}
async function readJSON(response,signal) {
  const bytes=await readBytes(response,MIB,signal);
  try {const value=JSON.parse(new TextDecoder().decode(bytes));if(!object(value))throw new Error();return value;}
  catch{fail('RESPONSE','API 返回了无法解析的 JSON 对象。');}
}

export function createVideoClient({url,key,fetchImpl=globalThis.fetch,timeoutMs=30000,uploadTimeoutMs=120000,
  chunkBytes=MIB,downloadConcurrency=3,downloadRetries=2,retryDelayMs=150,maxDownloadBytes=VIDEO_LIMITS.downloadBytes,
  cryptoImpl=globalThis.crypto}={}) {
  const base=normalizeVideoEndpoint(url);
  if(typeof key!=='string'||key.trim().length<32||!/^[\x21-\x7e]+$/.test(key.trim()))fail('KEY','请填写笔记本生成的完整 API 密钥（至少 32 位 ASCII 字符）。');
  const credential=key.trim();
  if(typeof fetchImpl!=='function')fail('NETWORK','当前环境不支持 fetch。');
  for(const [name,value,min,max] of [['timeoutMs',timeoutMs,1,300000],['uploadTimeoutMs',uploadTimeoutMs,1,600000],
    ['chunkBytes',chunkBytes,1,8*MIB],['downloadConcurrency',downloadConcurrency,1,4],['downloadRetries',downloadRetries,0,3],
    ['retryDelayMs',retryDelayMs,0,5000],['maxDownloadBytes',maxDownloadBytes,1,512*MIB]])
    if(!Number.isSafeInteger(value)||value<min||value>max)fail('INPUT',`${name} 超出允许范围。`);
  const scrub=value=>String(value).split(credential).join('[REDACTED]');
  try{setLogSecrets([credential]);}catch{}

  async function request(path,{method='GET',body,signal,headers={},consume=readJSON,timeout=timeoutMs}={}) {
    checkAbort(signal);
    const controller=new AbortController(),started=Date.now();let timer,response,startedFetch=false,logId;
    const log=(status,error)=>{try{logId=recordNetwork({requestId:logId,method,endpoint:base+path,provider:'minimax-h3',transport:describeTransport(fetchImpl),
      startedAt:new Date(started).toISOString(),durationMs:Date.now()-started,status,
      requestHeaders:{Authorization:'[REDACTED]',...Object.fromEntries(Object.entries(headers).filter(([name])=>name.toLowerCase()!=='authorization'))},
      ...(error?{error:{code:error.code||'NETWORK',message:scrub(error.message||'网络操作未完成')}}:{})});}catch{}};
    let rejectDeadline;
    const deadline=new Promise((_,reject)=>{rejectDeadline=reject;timer=setTimeout(()=>{controller.abort();reject(new VideoApiError('TIMEOUT','网络操作超时；可以查询原任务。'));},timeout);});
    const onAbort=()=>{controller.abort();rejectDeadline(aborted());};
    signal?.addEventListener('abort',onAbort,{once:true});
    log('pending');
    try {
      const result=await Promise.race([deadline,(async()=>{
        startedFetch=true;
        response=await fetchImpl(base+path,{method,headers:{Accept:'application/json',Authorization:`Bearer ${credential}`,...headers},
          ...(body===undefined?{}:{body}),signal:controller.signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',mode:'cors'});
        checkAbort(controller.signal);
        if(!response.ok) {
          let detail=null;
          try{detail=await readJSON(response,controller.signal);}catch(error){if(controller.signal.aborted)throw error;}
          const reported=typeof detail?.detail==='string'?detail.detail:typeof detail?.detail?.message==='string'?detail.detail.message:'';
          const jobId=JOB_ID.test(detail?.detail?.job_id||'')?detail.detail.job_id:null;
          throw new VideoApiError('HTTP',`视频 API 返回 HTTP ${response.status}。${reported?' '+scrub(reported).slice(0,500):''}`,
            {httpStatus:response.status,jobId,retryAfter:retrySeconds(response)});
        }
        return consume(response,controller.signal);
      })()]);
      log(response.status);return result;
    } catch(error) {
      const safe=error instanceof VideoApiError?error:new VideoApiError(signal?.aborted?'CANCELLED':'NETWORK',signal?.aborted?'本次网络操作已停止；服务器状态仍需查询。':'连接失败，请检查 API 地址、网络和跨域设置；重定向不会自动跟随。');
      safe.started=startedFetch;log(response?.status||safe.code,safe);throw safe;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
  }
  const endpoint=id=>'/v1/jobs/'+validJobId(id);
  function mutationError(error,kind,idempotencyKey,jobId) {
    // 4xx and 507 are explicit rejection; all other failures after POST dispatch
    // leave the server effect unknown, including an unreadable success response.
    const rejected=error.httpStatus!==null&&(error.httpStatus<500||error.httpStatus===507);
    if(error.started&&!rejected)return new VideoApiError(kind==='submit'?'SUBMISSION_UNKNOWN':'CANCEL_UNKNOWN',
      kind==='submit'?'提交回执未确认，任务可能已接收；请查询原任务，勿重复生成。':'取消回执未确认；请继续查询原任务，不能据此认定已取消。',
      {unknown:true,httpStatus:error.httpStatus,jobId:error.jobId||jobId||null,idempotencyKey:idempotencyKey||null,retryAfter:error.retryAfter});
    return error;
  }
  async function sleep(ms,signal) {
    checkAbort(signal);if(!ms)return;
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);
      const stop=()=>{clearTimeout(timer);reject(aborted());};signal?.addEventListener('abort',stop,{once:true});});
  }
  async function range(id,start,end,total,signal) {
    for(let attempt=0;;attempt++)try {
      return await request(endpoint(id)+'/file',{signal,headers:{Accept:'video/mp4',Range:`bytes=${start}-${end}`},consume:async(response,innerSignal)=>{
        if(response.status!==200&&response.status!==206)fail('DOWNLOAD_RANGE','下载响应不是完整文件或合法范围响应。');
        if(response.status===206&&response.headers.get('content-range')!==`bytes ${start}-${end}/${total}`)
          fail('DOWNLOAD_RANGE','服务返回了不匹配的文件范围，未合并视频。');
        if(response.status===200&&start!==0)fail('DOWNLOAD_RANGE','服务忽略了后续范围请求，未合并视频。');
        const expected=response.status===200?total:end-start+1;
        const bytes=await readBytes(response,expected,innerSignal);
        if(bytes.byteLength!==expected)fail('DOWNLOAD_RANGE','视频范围未完整传输，可重新下载原任务。');
        return {bytes,whole:response.status===200};
      }});
    } catch(error) {
      const retryable=['NETWORK','TIMEOUT','DOWNLOAD_RANGE'].includes(error.code)||error.code==='HTTP'&&(error.httpStatus===429||error.httpStatus>=500);
      if(!retryable||attempt>=downloadRetries||signal?.aborted)throw error;
      await sleep(Math.min(5000,error.retryAfter!==null?error.retryAfter*1000:retryDelayMs*2**attempt),signal);
    }
  }
  return Object.freeze({
    system:({signal}={})=>request('/v1/system',{signal}),
    capabilities:({signal}={})=>request('/v1/capabilities',{signal,consume:async(response,innerSignal)=>validateVideoCapabilities(await readJSON(response,innerSignal))}),
    async submit(input,idempotencyKey,{signal}={}) {
      checkAbort(signal);const value=validateVideoRequest(input);
      if(typeof idempotencyKey!=='string'||!REQUEST_ID.test(idempotencyKey))fail('INPUT','提交前需生成并保留本次唯一请求标识。');
      const form=new FormData();
      try{for(const item of value.files)form.append('files',item.file,item.file.name);}
      catch{fail('INPUT','参考文件必须是浏览器可上传的 File 或 Blob。');}
      form.append('kinds',JSON.stringify(value.files.map(item=>item.kind)));
      for(const name of ['prompt','seconds','width','height','steps','seed','attention_backend','acceleration_lora'])form.append(name,String(value[name]));
      try{return await request('/v1/jobs',{method:'POST',body:form,signal,headers:{'Idempotency-Key':idempotencyKey},timeout:uploadTimeoutMs,
        consume:async(response,innerSignal)=>validateJob(await readJSON(response,innerSignal))});}
      catch(error){throw mutationError(error,'submit',idempotencyKey);}
    },
    job:(id,{signal}={})=>request(endpoint(id),{signal,consume:async(response,innerSignal)=>validateJob(await readJSON(response,innerSignal),id)}),
    async cancel(id,{signal}={}) {
      const path=endpoint(id)+'/cancel';
      try{return await request(path,{method:'POST',signal,consume:async(response,innerSignal)=>validateJob(await readJSON(response,innerSignal),id)});}
      catch(error){throw mutationError(error,'cancel',null,id);}
    },
    async download(id,artifact,{signal,onProgress}={}) {
      validJobId(id);checkAbort(signal);
      if(!object(artifact)||!Number.isSafeInteger(artifact.bytes)||artifact.bytes<=0||!/^([a-f0-9]{64})$/.test(artifact.sha256||''))
        fail('DOWNLOAD_INTEGRITY','任务尚未提供有效的视频大小及 SHA-256 校验值。');
      if(artifact.bytes>maxDownloadBytes)fail('DOWNLOAD_LIMIT','视频超过本页的内存下载预算，请使用命令行客户端下载原任务。');
      if(typeof cryptoImpl?.subtle?.digest!=='function')fail('CRYPTO','当前浏览器无法校验 SHA-256，请使用 HTTPS 或 localhost。');
      const total=artifact.bytes,controller=new AbortController();
      const relay=()=>controller.abort();signal?.addEventListener('abort',relay,{once:true});
      let done=0;
      const progress=()=>{try{onProgress?.({loaded:done,total});}catch{}};
      try {
        // Determine actual Range behavior before parallel transfer. A server that
        // ignores Range is read once, never once per competing download worker.
        const first=await range(id,0,Math.min(total,chunkBytes)-1,total,controller.signal);
        const bytes=new Uint8Array(total);bytes.set(first.bytes);done=first.bytes.byteLength;progress();
        if(!first.whole) {
          let next=first.bytes.byteLength;
          const worker=async()=>{while(next<total){checkAbort(controller.signal);const start=next;next+=chunkBytes;
            const part=await range(id,start,Math.min(total,start+chunkBytes)-1,total,controller.signal);
            bytes.set(part.bytes,start);done+=part.bytes.byteLength;progress();}};
          const workers=Array.from({length:Math.min(downloadConcurrency,Math.ceil((total-next)/chunkBytes))},worker);
          try{await Promise.all(workers);}catch(error){controller.abort();await Promise.allSettled(workers);throw error;}
        }
        checkAbort(signal);
        const digest=await cryptoImpl.subtle.digest('SHA-256',bytes);
        checkAbort(signal);const hash=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
        if(hash!==artifact.sha256)fail('DOWNLOAD_INTEGRITY','下载视频的 SHA-256 与任务产物不一致，未提供预览或下载。');
        return {blob:new Blob([bytes],{type:'video/mp4'}),sha256:hash,bytes:total,filename:`${id}.mp4`};
      } finally {signal?.removeEventListener('abort',relay);controller.abort();}
    }
  });
}
