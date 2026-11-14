/** Owns reference-video submissions, observations and browser resources.
 * API task completion, cancellation requests and downloaded media are separate facts.
 * Keys/files stay in memory; local history cannot authorize a new submission.
 */
import {createVideoClient, normalizeVideoEndpoint, validateVideoRequest, validateVideoCapabilities, validateVideoAcceleration, VIDEO_DEFAULTS, VIDEO_LIMITS} from './video-api.js';
import {esc} from './view-markup.js';
import {icon} from './icons.js';

const TERMINAL = new Set(['succeeded','failed','cancelled','not_submitted']);
const JOB_ID = /^[a-f0-9]{32}$/;
const FORMATS = {image:['jpg','jpeg','png','webp'],video:['mp4','mov','webm'],audio:['wav','mp3','m4a','flac','ogg']};
const ACCEPT = Object.values(FORMATS).flat().map(ext=>'.'+ext).join(',');
const LABELS = {image:'图片',video:'视频',audio:'音频'};
const TAGS = {image:'Picture',video:'Video',audio:'Audio'};
const MEDIA_BYTES=256*1024*1024,MEDIA_ITEMS=3;
export const VIDEO_WORKSPACE_VERSION = '0.2.0';
const ATTENTION_LABELS={auto:'自动 · PyTorch SDPA',native:'PyTorch SDPA',_native_flash:'PyTorch Flash SDPA'};
const LORA_LABELS={none:'关闭','lightx2v-ref2va-4step':'LightX2V Turbo · 4 次评估'};
function generationChoice(value,effective=false) {
  if(!value||typeof value!=='object'||!Object.hasOwn(ATTENTION_LABELS,value.attention_backend)||!Object.hasOwn(LORA_LABELS,value.acceleration_lora)||!Number.isInteger(value.steps)||value.steps<2||value.steps>50||value.acceleration_lora==='lightx2v-ref2va-4step'&&value.steps!==5)return null;
  if(effective&&(value.attention_backend==='auto'||value.precision!=='bf16'||value.denoiser_evaluations!==value.steps-1))return null;
  return {attention_backend:value.attention_backend,acceleration_lora:value.acceleration_lora,steps:value.steps,...(effective?{precision:value.precision,denoiser_evaluations:value.denoiser_evaluations}:{})};
}
export function videoGenerationLabel(generation) {
  const label=value=>`${ATTENTION_LABELS[value.attention_backend]||value.attention_backend||'未报告'} · ${LORA_LABELS[value.acceleration_lora]||value.acceleration_lora||'未报告'} · ${value.steps??'未报告'} 步${Number.isInteger(value.denoiser_evaluations)?` / ${value.denoiser_evaluations} 次评估`:''}${value.precision?` · ${value.precision.toUpperCase()}`:''}`;
  if(!generation?.requested)return '';
  const requested=generationChoice(generation.requested),effective=generation.effective&&generationChoice(generation.effective,true);
  if(!requested||generation.effective&&!effective)return '生成配置回执格式无效，需核对服务记录。';
  return `请求：${label(requested)}。${effective?`实际：${label(effective)}。`:'实际配置等待 GPU 执行确认。'}`;
}

export function videoJobLabel(job) {
  if(job.status==='submitting')return '正在上传参考';
  if(job.status==='not_submitted')return '未开始上传';
  if(job.status==='unknown')return '提交结果待核对';
  if(job.status==='cancel_requested')return '取消请求已接收 · 等待停止';
  if(job.status==='cancelled')return '已取消';
  if(job.status==='failed')return '生成失败';
  if(job.status==='succeeded')return '已生成';
  const waiting=({model_ready:'等待模型就绪',model_recovery:'等待模型恢复',model_capacity:'等待资源',gpu:'等待 GPU 资源',gpu_lease:'等待 GPU 资源',gpu_wait:'等待 GPU 资源',scheduler:'等待调度',shutdown:'服务正在关闭'})[job.waiting_for];
  if(job.status==='queued')return waiting?`已排队 · ${waiting}`:Number.isInteger(job.queue_position)&&job.queue_position>0?`已排队 · 第 ${job.queue_position} 位`:'已排队';
  if(job.status==='running')return ({prepare:'正在预处理参考',preprocess:'正在预处理参考',preparing:'正在预处理参考',gpu:'正在 GPU 推理',gpu_running:'正在 GPU 推理',gpu_wait:'等待 GPU 资源',encode:'正在编码与校验',encoding:'正在编码与校验',encode_validate:'正在编码与校验',validating:'正在校验视频',encode_wait:'等待编码资源',prepare_wait:'等待预处理资源'})[job.active_phase?.phase] || waiting || '等待执行阶段确认';
  return '等待查询';
}
function jobErrorLabel(job){return job.status==='cancelled'&&job.error==='result_not_committed'?'任务已取消，未提交视频产物':job.error;}

export function createVideoWorkspace({document=globalThis.document,window=globalThis.window,clock=globalThis,
  clientFactory=createVideoClient,onChange=()=>{},storage,storageKey,cryptoImpl=globalThis.crypto}={}) {
  const now=()=>typeof clock.now==='function'?clock.now():Date.now();
  let disposed=false,root=null,timer=null,reading=0,downloading=0,reservedMediaBytes=0,sequence=0,storageBlocked=false,configEpoch=0;
  const controllers=new Set(), credentials=new Map(),credentialEpochs=new Map(),instances=new Map(),secrets=new Set();
  const key=storageKey || `llm-video-v1:${(window?.location?.pathname||'/').replace(/index\.html$/,'')}`;
  if(storage===undefined){try{storage=window?.localStorage;}catch{storage=null;}}
  const state={url:'',key:'',draft:'',files:[],options:{...VIDEO_DEFAULTS},jobs:[],settingsOpen:false,
    connected:false,connecting:false,submitting:false,system:null,capabilities:null,capabilitiesError:'',notice:'',error:'',storageError:'',restoreId:''};
  const uid=()=>cryptoImpl?.randomUUID?.() || `video-${now()}-${++sequence}`;
  function clean(message){let text=String(message??'');for(const secret of new Set([state.key,...credentials.values(),...secrets]))if(secret)text=text.split(secret).join('[密钥已隐藏]');return text.slice(0,1200);}
  function endpoint(){return normalizeVideoEndpoint(state.url);}
  function client(url){const apiKey=credentials.get(url);if(!apiKey)throw new Error('请先填写这个 API 的密钥并连接。');return clientFactory({url,key:apiKey});}
  function accessible(job){return !job.instanceMismatch&&credentials.has(job.endpoint)&&instances.has(job.endpoint)&&(!job.instanceId||instances.get(job.endpoint)===job.instanceId);}
  function checkOwner(job){if(!accessible(job))throw new Error(job.instanceMismatch||job.instanceId&&instances.get(job.endpoint)!==job.instanceId?'这是其他服务实例的任务。请连接原实例地址后再查询；未向当前实例发送操作。':'请先连接任务所属的 API。');}
  function openSettings(){state.settingsOpen=true;const node=root?.querySelector('[data-video-settings]');if(node)node.open=true;}
  function resizeDraft(){const node=root?.querySelector('#video-draft');if(node){node.style.height='auto';node.style.height=Math.min(180,Math.max(44,node.scrollHeight||44))+'px';}}
  function publicJob(job){return {uid:job.uid,id:job.id||null,idempotencyKey:job.idempotencyKey||null,endpoint:job.endpoint,instanceId:job.instanceId||null,instanceMismatch:Boolean(job.instanceMismatch||job.instanceId&&instances.has(job.endpoint)&&instances.get(job.endpoint)!==job.instanceId),status:job.status,createdAt:job.createdAt,
    updatedAt:job.updatedAt,queue_position:job.queue_position??null,waiting_for:job.waiting_for??null,
    active_phase:job.active_phase?{phase:job.active_phase.phase}:null,cleanup_complete:job.cleanup_complete===true,generationLabel:clean(videoGenerationLabel(job.generation_options)),generationError:clean(job.generationError),
    label:videoJobLabel(job),error:clean(jobErrorLabel(job)),observationError:clean(job.observationError),downloadState:job.downloadState||'idle',
    downloadedBytes:job.downloadedBytes||0,totalBytes:job.totalBytes||0,mediaReady:Boolean(job.mediaUrl)};}
  function snapshot(){return {version:VIDEO_WORKSPACE_VERSION,url:state.url,keyPresent:Boolean(state.key),connected:state.connected,
    connecting:state.connecting,submitting:state.submitting,admissionOpen:state.system?.queue?.admission_open===true,capabilitiesAvailable:Boolean(state.capabilities),capabilitiesError:clean(state.capabilitiesError),options:{...state.options},files:state.files.map(({kind,file})=>({kind,name:file.name,size:file.size})),
    jobs:state.jobs.map(publicJob),mediaBudget:{limitBytes:MEDIA_BYTES,reservedBytes:reservedMediaBytes,cachedBytes:state.jobs.filter(job=>job.mediaUrl).reduce((sum,job)=>sum+(job.totalBytes||0),0)},notice:clean(state.notice),error:clean(state.error),storageError:state.storageError,disposed};}
  function save(){
    if(storageBlocked)return false;
    if(!storage){state.storageError='本机任务记录不可用；为防止刷新后重复提交，本次不会开始上传。';return false;}
    try{
      const url=(()=>{try{return endpoint();}catch{return '';}})();
      const jobs=state.jobs.filter(job=>job.status!=='not_submitted').map(job=>({uid:job.uid,id:job.id||null,endpoint:job.endpoint,
        instanceId:job.instanceId||null,status:job.status==='submitting'?'unknown':job.status,createdAt:job.createdAt,updatedAt:job.updatedAt,idempotencyKey:job.idempotencyKey||null}));
      storage.setItem(key,JSON.stringify({version:1,url,jobs}));state.storageError='';return true;
    }catch{state.storageError='本机任务记录未保存；新的上传不会开始。已有任务请保留本页并复制任务或请求编号。';return false;}
  }
  function restore(){
    if(!storage)return;
    try{
      const text=storage.getItem(key);if(!text)return;if(text.length>4*1024*1024)throw new Error('oversize');
      const saved=JSON.parse(text);if(saved.version!==1||!Array.isArray(saved.jobs))throw new Error('schema');
      state.url=saved.url?normalizeVideoEndpoint(saved.url):'';
      for(const item of saved.jobs){
        if(!item||!Number.isFinite(item.createdAt)||!Number.isFinite(item.updatedAt)||!['queued','running','cancel_requested','succeeded','failed','cancelled','unknown','unobserved'].includes(item.status))continue;
        let url;try{url=normalizeVideoEndpoint(item.endpoint);}catch{continue;}
        if(item.id!==null&&!JOB_ID.test(item.id))continue;
        if(!item.id&&item.status!=='unknown')continue;
        if(state.jobs.some(job=>job.id&&job.id===item.id&&job.endpoint===url))continue;
        state.jobs.push({uid:uid(),id:item.id,endpoint:url,instanceId:typeof item.instanceId==='string'&&item.instanceId.length<=128?item.instanceId:null,status:item.status,createdAt:item.createdAt,updatedAt:item.updatedAt,
          idempotencyKey:typeof item.idempotencyKey==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(item.idempotencyKey)?item.idempotencyKey:null,
          nextPoll:0,needsObservation:Boolean(item.id),observationError:item.id?'已恢复任务记录；请填写对应 API 密钥后查询。':'请求回执未知；请用请求编号核对服务端日志，再填任务 ID 恢复。不会自动重发。',downloadState:'idle'});
      }
      if(state.jobs.length)state.notice='已恢复任务记录；密钥和参考文件不保存。连接后继续查询，不会重复生成。';
    }catch{storageBlocked=true;state.storageError='本机视频记录无法读取；原记录保持不变，本页新任务不会覆盖它。';}
  }
  restore();
  function notify(){if(disposed)return;patch();onChange({kind:'video-update'});}
  function controller(){const item=new AbortController();controllers.add(item);return item;}
  async function owned(operation){const item=controller();try{return await operation(item.signal);}finally{controllers.delete(item);}}
  function find(id){return state.jobs.find(job=>job.uid===id||job.id===id);}
  function receiveGeneration(job,value){
    if(value===undefined)return;
    const requested=generationChoice(value?.requested),effective=value?.effective==null?null:generationChoice(value.effective,true);
    const same=(a,b)=>a.attention_backend===b.attention_backend&&a.acceleration_lora===b.acceleration_lora&&a.steps===b.steps;
    if(!requested||value?.effective!=null&&!effective){job.generationError='生成配置回执格式无效；保留已知配置，任务操作仍可继续。';return;}
    if(job.generation_options?.requested&&!same(job.generation_options.requested,requested)){job.generationError='服务回报的请求配置与原提交不一致；保留原配置，请核对服务记录。';return;}
    if(effective&&(effective.steps!==requested.steps||effective.acceleration_lora!==requested.acceleration_lora||requested.attention_backend!=='auto'&&effective.attention_backend!==requested.attention_backend)||effective&&job.generation_options?.effective&&!same(job.generation_options.effective,effective)){
      job.generationError='实际配置与请求或此前回执不一致；未将冲突回执标成已确认，请核对服务记录。';return;
    }
    job.generation_options={requested,effective:effective||job.generation_options?.effective||null};job.generationError='';
  }
  function applyObservation(job,value){
    if(disposed)return;
    if(job.id&&value.id!==job.id)throw new Error('返回了不同的任务 ID，未覆盖原记录。');
    const instance=value.instance_id;
    if(typeof instance!=='string'||!instance||instance.length>128)throw new Error('返回的任务缺少服务实例身份，未接纳这次观察。');
    if((job.instanceId&&job.instanceId!==instance)||instances.get(job.endpoint)!==instance){job.nextPoll=Infinity;job.instanceMismatch=true;throw new Error('任务来自不同服务实例，已停止查询和操作；请连接原实例。');}
    if(TERMINAL.has(job.status)&&job.status!==value.status)throw new Error('服务返回了与已知终态冲突的状态，保留原记录等待核对。');
    job.instanceId=instance;
    job.id=value.id;job.status=value.status;job.queue_position=value.queue_position;job.waiting_for=value.waiting_for;
    job.active_phase=value.active_phase;job.cleanup_complete=value.cleanup_complete===true;job.artifact=value.artifact;
    receiveGeneration(job,value.generation_options);
    job.error=typeof value.error==='string'?clean(value.error):value.error?clean(JSON.stringify(value.error)):'';
    job.updatedAt=now();job.needsObservation=false;job.failures=0;job.observationError='';job.nextPoll=now()+2500;
    save();notify();if(job.status==='succeeded'&&job.downloadRequested&&job.artifact&&job.downloadState!=='downloading'&&!job.mediaUrl){job.downloadState='waiting';pumpDownloads();}
  }
  function canPoll(job){return Boolean(job.id&&accessible(job)&&job.nextPoll!==Infinity&&!job.reading&&!job.cancelling&&(!TERMINAL.has(job.status)||job.needsObservation));}
  function schedule(){
    if(disposed)return;if(timer!==null){clock.clearTimeout(timer);timer=null;}
    const candidates=state.jobs.filter(canPoll);if(!candidates.length||reading>=3)return;
    const delay=Math.max(100,Math.min(30000,...candidates.map(job=>(job.nextPoll||0)-now())));
    timer=clock.setTimeout(()=>{timer=null;tick();},delay);timer?.unref?.();
  }
  function tick(){
    if(disposed)return;
    for(const job of state.jobs.filter(job=>canPoll(job)&&(job.nextPoll||0)<=now()).slice(0,3-reading))void refreshJob(job.uid);
    schedule();
  }
  async function refreshJob(id){
    const job=find(id);if(disposed||!job?.id||job.reading||job.cancelling)return;
    try{checkOwner(job);}catch(error){job.observationError=clean(error.message);notify();return;}
    if(reading>=3){job.nextPoll=0;job.needsObservation=true;schedule();return;}
    const epoch=job.observationEpoch||0,credentialEpoch=credentialEpochs.get(job.endpoint),api=client(job.endpoint);
    job.reading=true;reading++;notify();
    try{const value=await owned(signal=>api.job(job.id,{signal}));if(epoch===(job.observationEpoch||0))applyObservation(job,value);}
    catch(error){if(!disposed&&epoch===(job.observationEpoch||0)){job.failures=(job.failures||0)+1;job.observationError=clean(error.message||'查询暂时失败。');job.nextPoll=job.instanceMismatch?Infinity:now()+Math.max((error.retryAfter||0)*1000,Math.min(60000,2500*2**Math.min(job.failures,5)));
      if((error.httpStatus===401||error.httpStatus===403)&&credentialEpochs.get(job.endpoint)===credentialEpoch){credentials.delete(job.endpoint);credentialEpochs.delete(job.endpoint);if(state.url===job.endpoint)state.connected=false;}
      if(error.httpStatus===404){job.needsObservation=false;job.nextPoll=Infinity;job.observationError='此 API 未找到任务。请核对原地址与任务 ID；未重新提交。';}
    }}finally{job.reading=false;reading--;notify();schedule();}
  }
  async function connect(){
    if(disposed||state.connecting)return;
    state.error='';let url,apiKey;
    try{url=endpoint();apiKey=state.key.trim();if(!apiKey)throw new Error('请填写 API 密钥。');clientFactory({url,key:apiKey});}
    catch(error){state.error=clean(error.message);notify();return;}
    const epoch=++configEpoch,api=clientFactory({url,key:apiKey});secrets.add(apiKey);
    state.url=url;state.connecting=true;state.connected=false;state.capabilities=null;state.capabilitiesError='';notify();
    try{
      const [systemResult,capabilityResult]=await Promise.allSettled([owned(signal=>api.system({signal})),owned(signal=>api.capabilities({signal}))]);if(disposed||epoch!==configEpoch)return;
      if(systemResult.status==='rejected')throw systemResult.reason;
      const system=systemResult.value;
      if(typeof system.instance_id!=='string'||!system.instance_id||system.instance_id.length>128)throw new Error('服务未返回有效的实例身份，无法安全连接。');
      credentials.set(url,apiKey);credentialEpochs.set(url,Symbol('connected credential'));instances.set(url,system.instance_id);
      state.connected=true;state.system=system;state.notice=system.queue?.admission_open!==true?'已连接 · 服务暂不接收新任务':system.model_ready===true?'已连接 · 可以生成':'已连接 · 可先排队，等待模型就绪';
      try{if(capabilityResult.status==='rejected')throw capabilityResult.reason;const capability=validateVideoCapabilities(capabilityResult.value);if(capability.instance_id!==system.instance_id)throw new Error('能力信息与当前服务实例不一致，请重新连接。');state.capabilities=capability;}
      catch(error){state.capabilitiesError=clean(error.message||'生成能力查询失败。');state.notice='已连接 · 可查询、取消和下载已有任务；生成能力未确认，暂不提交新任务。';}
      for(const job of state.jobs)if(job.endpoint===url&&job.id){job.instanceMismatch=Boolean(job.instanceId&&job.instanceId!==system.instance_id);job.nextPoll=job.instanceMismatch?Infinity:0;job.needsObservation=true;if(job.instanceMismatch)job.observationError='这是旧服务实例的任务，已停止查询与操作。请连接原实例。';}
      save();schedule();
    }catch(error){if(!disposed&&epoch===configEpoch){state.error=clean(error.message);credentials.delete(url);}}
    finally{if(epoch===configEpoch)state.connecting=false;notify();}
  }
  function setConnection(values){
    const url=normalizeVideoEndpoint(values.url);if(typeof values.key!=='string'||!values.key.trim())throw new Error('连接文件缺少 API 密钥。');
    if(disposed)return;clientFactory({url,key:values.key.trim()});secrets.add(state.key);secrets.add(values.key.trim());credentials.delete(url);configEpoch++;state.connecting=false;state.url=url;state.key=values.key.trim();state.connected=false;state.system=null;state.capabilities=null;state.capabilitiesError='';
    openSettings();state.notice='连接信息已读入本页内存；点击“连接”开始查询。';state.error='';save();
    if(root){const u=root.querySelector('[data-video-field="url"]'),k=root.querySelector('[data-video-field="key"]');if(u)u.value=state.url;if(k)k.value=state.key;}
    notify();
  }
  async function importConnection(file){
    if(!file)return;if(file.size>32768)throw new Error('连接文件超过 32 KiB。');
    const value=JSON.parse(await file.text());if(disposed)return;
    setConnection({url:value.url,key:value.api_key});
  }
  function addFiles(files){
    if(disposed||state.submitting)return;
    const additions=Array.from(files).map(file=>{const ext=file.name.split('.').pop().toLowerCase(),kind=Object.keys(FORMATS).find(k=>FORMATS[k].includes(ext));
      if(!kind)throw new Error(`不支持这个参考文件：${file.name}`);if(file.size<=0||file.size>32*1024*1024)throw new Error('每个参考文件须大于 0 且不超过 32 MiB。');return {kind,file,uid:uid()};});
    const next=[...state.files,...additions];if(next.length>VIDEO_LIMITS.files)throw new Error('参考文件总数不能超过 12 个。');if(next.reduce((total,item)=>total+item.file.size,0)>64*1024*1024)throw new Error('参考文件合计不能超过 64 MiB。');
    for(const [kind,max] of [['image',9],['video',3],['audio',3]])if(next.filter(item=>item.kind===kind).length>max)throw new Error(`${LABELS[kind]}参考最多 ${max} 个。`);
    state.files=next;state.error='';notify();
  }
  async function submit(){
    if(disposed||state.submitting)return;
    state.error='';let url,input;
    try{
      url=endpoint();if(!credentials.has(url)||credentials.get(url)!==state.key.trim())throw new Error('请先连接当前视频 API。');
      if(!state.connected||state.system?.queue?.admission_open!==true)throw new Error('服务暂不接收新任务，请稍后重新连接检查。');
      if(state.jobs.some(job=>job.endpoint===url&&job.status==='unknown'&&!job.id))throw new Error('上次提交结果仍未知，请先用任务 ID 恢复查询，避免重复生成。');
      if(!state.capabilities)throw new Error('生成能力尚未确认，请重新连接；已有任务仍可查询、取消和下载。');
      input={prompt:state.draft.trim(),files:state.files.map(({kind,file})=>({kind,file})),...state.options};validateVideoRequest(input);validateVideoAcceleration(input,state.capabilities);
    }catch(error){state.error=clean(error.message);if(!state.connected)openSettings();notify();return;}
    const job={uid:uid(),id:null,endpoint:url,instanceId:instances.get(url),status:'submitting',createdAt:now(),updatedAt:now(),prompt:input.prompt,
      idempotencyKey:'video-'+uid(),generation_options:{requested:{attention_backend:input.attention_backend,acceleration_lora:input.acceleration_lora,steps:input.steps},effective:null},references:state.files.map(({kind,file})=>({kind,name:file.name})),nextPoll:0,downloadState:'idle'};
    state.jobs.push(job);state.submitting=true;
    // A network abort cannot prove the server did not receive the upload. Journal its
    // unknown identity before the first POST, so a refreshed page cannot silently retry.
    if(!save()){job.status='not_submitted';job.error='上传未开始，因为本机恢复记录未能保存。请解决存储问题后再提交。';state.error=state.storageError;state.submitting=false;notify();return;}
    notify();
    try{
      const result=await owned(signal=>client(url).submit(input,job.idempotencyKey,{signal}));if(disposed)return;
      if(JOB_ID.test(result.id||''))job.id=result.id;applyObservation(job,result);state.files=[];state.draft='';const draft=root?.querySelector('#video-draft');if(draft)draft.value='';resizeDraft();
      state.notice='任务已接收，可以继续提交新的参考视频任务。';
    }catch(error){if(disposed)return;
      job.status=error.unknown||job.id?'unknown':'failed';job.error=clean(error.message);job.updatedAt=now();
      if(error.unknown&&JOB_ID.test(error.jobId||'')){job.id=error.jobId;job.nextPoll=0;job.needsObservation=true;job.observationError='提交回执未知，正在按原任务 ID 核对。';}
      state.error=error.unknown?'提交结果尚未确认；不会自动重发。'+(job.id?'已保留原任务 ID 并继续查询。':'请从服务端记录取得任务 ID 后恢复查询。'):clean(error.message);
      save();
    }finally{state.submitting=false;notify();schedule();}
  }
  async function restoreJob(rawId){
    let id=String(rawId||'').trim(),url;
    try{if(!JOB_ID.test(id))throw new Error('请输入完整的 32 位任务 ID。');url=endpoint();if(!credentials.has(url))throw new Error('请先连接任务所属的 API。');}
    catch(error){state.error=clean(error.message);notify();return;}
    let job=state.jobs.find(item=>item.id===id&&item.endpoint===url);
    if(!job){
      const unknown=state.jobs.find(item=>item.endpoint===url&&item.status==='unknown'&&!item.id);
      if(unknown){
        if(unknown.recovering)return;
        try{checkOwner(unknown);}catch(error){state.error=clean(error.message);notify();return;}
        if(reading>=3){state.error='当前查询已占满并发预算，请稍后再恢复任务。';notify();return;}
        unknown.recovering=true;reading++;notify();
        try{
          const value=await owned(signal=>client(url).job(id,{signal}));if(disposed)return;
          // A user-entered candidate is not evidence of association. Bind only after
          // the endpoint returns a validated job in the original service instance.
          if(value.id!==id)throw new Error('返回的任务 ID 与候选编号不一致，原未知请求保持不变。');
          if(!value.instance_id||value.instance_id!==instances.get(url)||unknown.instanceId&&value.instance_id!==unknown.instanceId)throw new Error('候选任务来自不同服务实例，原未知请求保持不变。');
          applyObservation(unknown,value);state.error='';state.restoreId='';
        }catch(error){if(!disposed){unknown.observationError='候选任务尚未核实，原请求编号和防重保护保持不变。'+clean(error.message);state.error=clean(unknown.observationError);}}
        finally{unknown.recovering=false;reading--;notify();schedule();}
        return;
      }
      job={uid:uid(),id,endpoint:url,instanceId:instances.get(url),status:'unobserved',createdAt:now(),updatedAt:now(),downloadState:'idle'};state.jobs.push(job);
    }
    job.needsObservation=true;job.nextPoll=0;state.error='';state.restoreId='';save();notify();await refreshJob(job.uid);
  }
  async function cancelJob(id){
    const job=find(id);if(disposed||!job?.id||TERMINAL.has(job.status)||job.cancelling)return;
    try{checkOwner(job);}catch(error){job.observationError=clean(error.message);notify();return;}
    job.observationEpoch=(job.observationEpoch||0)+1;job.cancelling=true;job.observationError='';notify();
    try{const value=await owned(signal=>client(job.endpoint).cancel(job.id,{signal}));applyObservation(job,value);}
    catch(error){if(!disposed){job.observationError=error.unknown?'取消回执未知，继续查询原任务；尚未确认已取消。':clean(error.message);job.nextPoll=0;job.needsObservation=true;}}
    finally{job.cancelling=false;notify();schedule();}
  }
  function pumpDownloads(){if(disposed)return;for(const job of state.jobs.filter(j=>j.downloadState==='waiting'&&accessible(j))){if(downloading>=2)break;void downloadJob(job.uid);}}
  function releaseMedia(job){(window?.URL||globalThis.URL).revokeObjectURL(job.mediaUrl);job.mediaUrl=null;job.downloadState='idle';job.mediaReleased=true;}
  function reserveDownload(job){
    const bytes=job.artifact.bytes;
    if(!Number.isSafeInteger(bytes)||bytes<1||bytes>MEDIA_BYTES)throw new Error('视频超出本页 256 MiB 媒体预算，或缺少有效的产物大小。');
    if(reservedMediaBytes+bytes>MEDIA_BYTES)return false;
    const cached=state.jobs.filter(item=>item.mediaUrl).sort((a,b)=>(a.mediaUsed||0)-(b.mediaUsed||0));
    let size=cached.reduce((sum,item)=>sum+(item.totalBytes||0),0);
    while(size+reservedMediaBytes+bytes>MEDIA_BYTES){const old=cached.shift();size-=old.totalBytes||0;releaseMedia(old);}
    job.mediaReservation=bytes;reservedMediaBytes+=bytes;return true;
  }
  function reserveMedia(bytes){
    if(!Number.isSafeInteger(bytes)||bytes<1||bytes>MEDIA_BYTES)throw new Error('视频超出本页 256 MiB 媒体预算。');
    const cached=state.jobs.filter(job=>job.mediaUrl).sort((a,b)=>(a.mediaUsed||0)-(b.mediaUsed||0));
    let size=cached.reduce((sum,job)=>sum+(job.totalBytes||0),0);
    while(cached.length>=MEDIA_ITEMS||size+bytes>MEDIA_BYTES){const job=cached.shift();if(!job)break;size-=job.totalBytes||0;releaseMedia(job);}
  }
  async function downloadJob(id,{saveFile=false}={}){
    const job=find(id);if(disposed||job?.status!=='succeeded')return;
    if(job.mediaUrl){job.mediaUsed=now();if(saveFile)saveMedia(job);return;}
    try{checkOwner(job);}catch(error){job.downloadError=clean(error.message);job.downloadState='failed';notify();return;}
    job.downloadRequested=true;
    job.saveWhenReady=saveFile||job.saveWhenReady;
    if(job.downloadState==='downloading')return;
    if(!job.artifact){job.observationError='请先查询任务，取得已校验的产物信息。';job.needsObservation=true;job.nextPoll=0;notify();schedule();return;}
    if(downloading>=2){job.downloadState='waiting';notify();return;}
    try{if(!reserveDownload(job)){job.downloadState='waiting';notify();return;}}
    catch(error){job.downloadState='failed';job.downloadError=clean(error.message);job.downloadRequested=false;notify();return;}
    downloading++;job.downloadState='downloading';job.downloadedBytes=0;job.totalBytes=job.artifact.bytes||0;job.downloadError='';notify();
    try{
      const result=await owned(signal=>client(job.endpoint).download(job.id,job.artifact,{signal,onProgress:progress=>{if(disposed)return;job.downloadedBytes=typeof progress==='number'?progress:(progress.loaded??progress.downloaded??progress.bytes??0);job.totalBytes=progress?.total??job.totalBytes;notify();}}));
      if(disposed)return;checkOwner(job);if(result.bytes!==job.mediaReservation)throw new Error('实际视频大小与已预留的产物大小不一致。');reserveMedia(result.bytes);job.mediaUrl=(window?.URL||globalThis.URL).createObjectURL(result.blob);job.filename=result.filename||`${job.id}.mp4`;job.downloadState='ready';job.downloadedBytes=result.bytes;job.totalBytes=result.bytes;job.mediaUsed=now();job.mediaReleased=false;job.downloadRequested=false;
      if(job.saveWhenReady){saveMedia(job);job.saveWhenReady=false;}
    }catch(error){if(!disposed){job.downloadState='failed';job.downloadError=clean(error.message);job.downloadRequested=false;}}
    finally{reservedMediaBytes-=job.mediaReservation||0;job.mediaReservation=0;downloading--;notify();pumpDownloads();}
  }
  function saveMedia(job){if(disposed||!job.mediaUrl)return;const link=document.createElement('a');link.href=job.mediaUrl;link.download=job.filename.replace(/[^\w.-]/g,'_');link.click();}
  function fileTags(){const counts={image:0,video:0,audio:0};return state.files.map(item=>({...item,tag:`<${TAGS[item.kind]} ${++counts[item.kind]}>`}));}
  function filesMarkup(){return fileTags().map(item=>`<span class="video-reference"><button type="button" class="video-ref-token" data-action="video-insert-ref" data-uid="${esc(item.uid)}" title="插入参考标记">${esc(item.tag)}</button><span title="${esc(item.file.name)}">${esc(item.file.name)}</span><button type="button" data-action="video-remove-ref" data-uid="${esc(item.uid)}" aria-label="移除 ${esc(item.file.name)}" ${state.submitting?'disabled':''}>×</button></span>`).join('');}
  function optionsMarkup(labels,field){return Object.entries(labels).map(([id,label])=>`<option value="${esc(id)}" ${state.options[field]===id?'selected':''}>${esc(label)}</option>`).join('');}
  function accelerationHint(){
    if(state.capabilitiesError)return state.capabilitiesError+' 已有任务仍可查询、取消和下载。';
    if(!state.capabilities)return state.connecting?'正在查询生成能力…':'连接后显示本服务可用的原生 BF16 加速选项。';
    try{validateVideoAcceleration(state.options,state.capabilities);}catch(error){return clean(error.message);}
    return (state.options.acceleration_lora==='lightx2v-ref2va-4step'?'Turbo 使用 5 个调度点，实际 4 次模型评估。':'关闭加速 LoRA，按所填步数生成。')+' 已配置选项可按服务接纳规则排队；当前执行阶段和实际配置见任务卡。';
  }
  function jobMarkup(job){return `<article class="video-job" data-video-card="${esc(job.uid)}"><div class="video-job-heading"><strong data-video-status></strong><span data-video-time>${new Date(job.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div>${job.prompt?`<p class="video-prompt">${esc(job.prompt)}</p>`:''}<p class="video-job-id"><span data-video-identity-label>任务</span> <span data-video-id></span><button class="video-text-button" type="button" data-action="video-copy-id" data-uid="${esc(job.uid)}">复制</button></p><p class="video-job-note" data-video-generation></p><p class="video-job-note" data-video-note role="status"></p><div class="video-job-actions"><button class="chip" data-action="video-refresh" data-uid="${esc(job.uid)}">查询进度</button><button class="chip" data-action="video-cancel" data-uid="${esc(job.uid)}">取消排队</button><button class="chip" data-action="video-preview" data-uid="${esc(job.uid)}">预览</button><button class="chip" data-action="video-download" data-uid="${esc(job.uid)}">下载视频</button></div><div class="video-media" data-video-media></div><p class="video-job-note" data-video-download-status></p></article>`;}
  function markup(tabsHtml){return `<main class="main video-workspace"><header class="top">${tabsHtml}</header><section class="thread" id="thread" aria-label="视频任务"><div class="thread-inner"><details class="video-settings setup-card" data-video-settings ${state.settingsOpen?'open':''}><summary>视频 API 设置 <span>MiniMax-H3 · ref2va</span></summary><div class="formfield"><label for="video-url">API 地址</label><input class="block-input" id="video-url" data-video-field="url" type="url" autocomplete="off" placeholder="https://…trycloudflare.com" value="${esc(state.url)}"></div><div class="formfield"><label for="video-key">API 密钥</label><input class="block-input" id="video-key" data-video-field="key" type="password" autocomplete="off" placeholder="仅保存在本页内存" value="${esc(state.key)}"></div><div class="video-settings-actions"><button class="chip" type="button" data-action="video-connect">连接</button><button class="chip" type="button" data-action="video-import">导入连接文件</button></div><input type="file" data-video-field="connection" accept=".json,application/json" hidden><p class="video-help">可导入 Colab 的 api-connection.private.json，仅在本页读取。API 密钥和参考文件不会写入本机记录。</p><details class="video-advanced"><summary>生成参数与加速</summary><div class="video-settings-actions"><button class="chip" type="button" data-action="video-preset-normal">常规生成</button><button class="chip" type="button" data-action="video-preset-test">低成本测试</button></div><p class="video-help">常规为 960 × 544 · 50 步；低成本测试为 512 × 288 · 8 步。两种预设都关闭加速 LoRA。</p><div class="video-acceleration-grid"><label>注意力后端<select class="block-input" data-video-field="attention_backend">${optionsMarkup(ATTENTION_LABELS,'attention_backend')}</select></label><label>加速 LoRA<select class="block-input" data-video-field="acceleration_lora">${optionsMarkup(LORA_LABELS,'acceleration_lora')}</select></label></div><p class="video-help" data-video-acceleration-note role="status">${esc(accelerationHint())}</p><button class="chip" type="button" data-action="video-turbo-steps" ${state.options.acceleration_lora==='lightx2v-ref2va-4step'&&state.options.steps!==5?'':'hidden'}>设为 5 步（4 次评估）</button><div class="video-option-grid"><label>时长（秒）<input class="block-input" data-video-field="seconds" type="number" min="5" max="14.375" step="0.125" value="${esc(state.options.seconds)}"></label><label>宽度<input class="block-input" data-video-field="width" type="number" min="256" max="1344" step="32" value="${esc(state.options.width)}"></label><label>高度<input class="block-input" data-video-field="height" type="number" min="256" max="1344" step="32" value="${esc(state.options.height)}"></label><label>步数<input class="block-input" data-video-field="steps" type="number" min="2" max="50" step="1" value="${esc(state.options.steps)}"></label><label>随机种子<input class="block-input" data-video-field="seed" type="number" min="0" max="2147483647" step="1" value="${esc(state.options.seed)}"></label></div></details><details class="video-recover"><summary>恢复已有任务</summary><label class="video-help" for="video-restore-id">填写原 API 的任务 ID，只查询，不重新生成。</label><div class="video-restore-row"><input class="block-input" id="video-restore-id" data-video-field="restoreId" maxlength="32" value="${esc(state.restoreId)}" placeholder="32 位任务 ID"><button class="chip" data-action="video-restore">恢复查询</button></div></details></details><div class="video-notice" data-video-notice role="status"></div><div class="video-error" data-video-error role="alert"></div><div data-video-jobs>${state.jobs.map(jobMarkup).join('')}</div><div class="video-empty" data-video-empty><span>${icon('image',26)}</span><p>让参考动起来</p><small>添加图片或视频，音频可以一起参考。</small></div></div></section><footer class="composer-area video-composer"><div class="video-references" data-video-references>${filesMarkup()}</div><div class="compose"><button class="circle" type="button" data-action="video-add-files" aria-label="添加视频参考文件" title="添加图片、视频或音频">${icon('plus',22)}</button><textarea id="video-draft" data-video-field="draft" rows="1" aria-label="视频提示词" placeholder="描述你想生成的视频…" ${state.submitting?'disabled':''}>${esc(state.draft)}</textarea><button class="send" type="button" data-action="video-submit" aria-label="生成视频" title="提交视频任务" ${state.submitting?'disabled':''}>${icon('up')}</button></div><input type="file" data-video-field="references" accept="${ACCEPT}" multiple hidden><div class="compose-metrics"><button class="video-text-button" type="button" data-action="video-settings">API 设置</button><span data-video-connection></span><span data-video-count></span></div></footer></main>`;}
  function mount(element){root=element;const details=root?.querySelector('[data-video-settings]');details?.addEventListener?.('toggle',()=>{state.settingsOpen=details.open;});patch();resizeDraft();}
  function patch(){
    if(!root||disposed||!root.querySelector('.video-workspace'))return;
    const set=(selector,value)=>{const node=root.querySelector(selector);if(node&&node.textContent!==value)node.textContent=value;};
    set('[data-video-acceleration-note]',accelerationHint());
    for(const [field,list] of [['attention_backend','attention_backends'],['acceleration_lora','acceleration_loras']]){
      const select=root.querySelector(`[data-video-field="${field}"]`);if(!select)continue;
      select.disabled=!state.capabilities||state.submitting;
      for(const option of select.options||[]){const capability=state.capabilities?.options[list].find(item=>item.id===option.value);option.disabled=!capability?.supported||!capability.configured;}
    }
    const turboSteps=root.querySelector('[data-action="video-turbo-steps"]');if(turboSteps)turboSteps.hidden=state.options.acceleration_lora!=='lightx2v-ref2va-4step'||state.options.steps===5;
    set('[data-video-notice]',clean(state.notice));set('[data-video-error]',clean(state.error||state.storageError));
    set('[data-video-connection]',state.connecting?'正在连接…':state.connected?'已连接':'未连接');
    set('[data-video-count]',state.jobs.some(j=>!TERMINAL.has(j.status))?`${state.jobs.filter(j=>j.status==='queued').length} 排队 · ${state.jobs.filter(j=>['running','cancel_requested'].includes(j.status)).length} 执行`:'');
    const connectButton=root.querySelector('[data-action="video-connect"]');if(connectButton)connectButton.disabled=state.connecting;
    const submitButton=root.querySelector('[data-action="video-submit"]');if(submitButton)submitButton.disabled=state.submitting;
    const draft=root.querySelector('#video-draft');if(draft)draft.disabled=state.submitting;
    const referenceArea=root.querySelector('[data-video-references]');if(referenceArea){const html=filesMarkup();if(referenceArea.innerHTML!==html)referenceArea.innerHTML=html;}
    const empty=root.querySelector('[data-video-empty]');if(empty)empty.hidden=state.jobs.length>0;
    const list=root.querySelector('[data-video-jobs]');if(!list)return;
    for(const job of state.jobs){
      let card=list.querySelector(`[data-video-card="${job.uid}"]`);if(!card){list.insertAdjacentHTML('beforeend',jobMarkup(job));card=list.querySelector(`[data-video-card="${job.uid}"]`);}if(!card)continue;
      const text=(selector,value)=>{const node=card.querySelector(selector);if(node&&node.textContent!==value)node.textContent=value;};
      text('[data-video-status]',videoJobLabel(job));text('[data-video-identity-label]',job.id?'任务':'请求编号');text('[data-video-id]',job.id||job.idempotencyKey||'等待提交回执');
      text('[data-video-generation]',clean([videoGenerationLabel(job.generation_options),job.generationError].filter(Boolean).join(' ')));
      text('[data-video-note]',clean(job.observationError||jobErrorLabel(job)||(job.status==='cancel_requested'?'正在执行的 GPU 步骤可能需要先结束；以服务端最终状态为准。':job.status==='unknown'?'回执未知，不会自动重发。请保留本页并核对原任务。':'')));
      const refresh=card.querySelector('[data-action="video-refresh"]');if(refresh)refresh.disabled=!job.id||job.reading||!accessible(job);
      const cancel=card.querySelector('[data-action="video-cancel"]');if(cancel){cancel.hidden=TERMINAL.has(job.status)||!job.id;cancel.disabled=job.cancelling||job.status==='cancel_requested'||!accessible(job);cancel.textContent=job.cancelling?'正在请求取消…':job.status==='queued'?'取消排队':'取消任务';}
      const preview=card.querySelector('[data-action="video-preview"]');if(preview){preview.hidden=job.status!=='succeeded'||Boolean(job.mediaUrl);preview.disabled=job.downloadState==='downloading'||!accessible(job);}
      const download=card.querySelector('[data-action="video-download"]');if(download){download.hidden=job.status!=='succeeded';download.disabled=job.downloadState==='downloading'||!accessible(job)&&!job.mediaUrl;download.textContent=job.downloadState==='failed'?'重新下载':'下载视频';}
      const copy=card.querySelector('[data-action="video-copy-id"]');if(copy)copy.hidden=!job.id&&!job.idempotencyKey;
      const media=card.querySelector('[data-video-media]');if(media&&!job.mediaUrl&&media.querySelector('video'))media.replaceChildren();if(media&&job.mediaUrl&&!media.querySelector('video'))media.innerHTML=`<video controls playsinline preload="metadata" src="${esc(job.mediaUrl)}" aria-label="生成的视频"></video>`;
      text('[data-video-download-status]',job.downloadState==='downloading'?`正在取回视频 ${job.totalBytes>0?Math.min(100,Math.floor(job.downloadedBytes/job.totalBytes*100))+'%':''}`:job.downloadState==='ready'?'已取回并核对视频校验值。':job.downloadState==='failed'?'下载未完成：'+clean(job.downloadError):job.downloadState==='waiting'?'等待本页媒体预算，稍后自动取回。':job.mediaReleased?'预览已释放，需要时可重新取回。':job.status==='succeeded'?'视频已生成，点击预览或下载取回。':'');
    }
  }
  function handleInput(target){
    const field=target?.dataset?.videoField;if(!field||disposed)return false;
    if(field==='draft'){state.draft=target.value;resizeDraft();}
    else if(field==='url'){if(state.url!==target.value){configEpoch++;state.connecting=false;state.url=target.value;state.key='';state.connected=false;state.system=null;state.capabilities=null;state.capabilitiesError='';const keyInput=root?.querySelector('[data-video-field="key"]');if(keyInput)keyInput.value='';}}
    else if(field==='key'){secrets.add(state.key);secrets.add(target.value);try{credentials.delete(endpoint());}catch{}configEpoch++;state.connecting=false;state.key=target.value;state.connected=false;state.system=null;state.capabilities=null;state.capabilitiesError='';schedule();}
    else if(field==='restoreId')state.restoreId=target.value;
    else if(field==='attention_backend'||field==='acceleration_lora')state.options[field]=target.value;
    else if(Object.hasOwn(state.options,field))state.options[field]=target.value===''?'':Number(target.value);
    else return false;
    if(field!=='draft')notify();return true;
  }
  async function handleChange(target){
    const field=target?.dataset?.videoField;if(!field||disposed)return false;
    try{if(field==='references')addFiles(target.files||[]);else if(field==='connection')await importConnection(target.files?.[0]);else return handleInput(target);}
    catch(error){state.error=clean(error.message);notify();}finally{if(field==='references'||field==='connection')target.value='';}return true;
  }
  async function handleClick(element){
    const action=element?.dataset?.action;if(!action?.startsWith('video-')||disposed)return false;
    try{
      if(action==='video-connect')await connect();
      else if(action==='video-submit')await submit();
      else if(action==='video-settings'){openSettings();notify();root?.querySelector('[data-video-settings]')?.scrollIntoView?.({block:'nearest'});}
      else if(action==='video-preset-normal'||action==='video-preset-test'){state.options=action==='video-preset-test'?{...VIDEO_DEFAULTS,width:512,height:288,steps:8}:{...VIDEO_DEFAULTS};for(const [name,value] of Object.entries(state.options)){const field=root?.querySelector(`[data-video-field="${name}"]`);if(field)field.value=String(value);}notify();}
      else if(action==='video-turbo-steps'&&state.options.acceleration_lora==='lightx2v-ref2va-4step'){state.options.steps=5;const field=root?.querySelector('[data-video-field="steps"]');if(field)field.value='5';state.error='';notify();}
      else if(action==='video-add-files')root?.querySelector('[data-video-field="references"]')?.click();
      else if(action==='video-import')root?.querySelector('[data-video-field="connection"]')?.click();
      else if(action==='video-remove-ref'&&!state.submitting){state.files=state.files.filter(item=>item.uid!==element.dataset.uid);notify();}
      else if(action==='video-insert-ref'){const item=fileTags().find(ref=>ref.uid===element.dataset.uid);if(item){const input=root?.querySelector('#video-draft');const pos=input?.selectionStart??state.draft.length;state.draft=state.draft.slice(0,pos)+item.tag+state.draft.slice(pos);if(input){input.value=state.draft;input.focus();input.setSelectionRange?.(pos+item.tag.length,pos+item.tag.length);}}}
      else if(action==='video-restore')await restoreJob(state.restoreId);
      else if(action==='video-refresh')await refreshJob(element.dataset.uid);
      else if(action==='video-cancel')await cancelJob(element.dataset.uid);
      else if(action==='video-preview')await downloadJob(element.dataset.uid);
      else if(action==='video-download')await downloadJob(element.dataset.uid,{saveFile:true});
      else if(action==='video-copy-id'){const job=find(element.dataset.uid),identity=job?.id||job?.idempotencyKey;if(identity){if(!window?.navigator?.clipboard?.writeText)throw new Error('浏览器不支持复制，请手动选择任务或请求编号。');await window.navigator.clipboard.writeText(identity);state.notice=job.id?'已复制任务 ID。':'已复制请求编号，可用于服务端日志核对。';notify();}}
    }catch(error){state.error=clean(error.message);notify();}return true;
  }
  function handleKeydown(event){if(event?.target?.id!=='video-draft')return false;if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void submit();return true;}return false;}
  function dispose(){if(disposed)return;save();disposed=true;if(timer!==null)clock.clearTimeout(timer);for(const item of controllers)item.abort();controllers.clear();credentials.clear();secrets.clear();state.key='';state.files=[];for(const job of state.jobs)if(job.mediaUrl)(window?.URL||globalThis.URL).revokeObjectURL(job.mediaUrl);root=null;}
  return {markup,mount,handleClick,handleInput,handleChange,handleKeydown,snapshot,dispose,
    connect,setConnection,addFiles,submit,restoreJob,refreshJob,cancelJob,downloadJob,importConnection};
}
