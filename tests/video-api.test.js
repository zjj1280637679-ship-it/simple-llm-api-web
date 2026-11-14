import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {File} from 'node:buffer';
import {createVideoClient,normalizeVideoEndpoint,validateVideoRequest,validateVideoCapabilities,validateVideoAcceleration,VIDEO_DEFAULTS,VIDEO_LIMITS,VideoApiError} from '../src/video-api.js';
import {clearNetworkLogs,getNetworkLogs} from '../src/logs.js';

const capabilities=(turbo=false,ready=false)=>({schema_version:1,instance_id:'instance-a',workflow:'ref2va',precision:'bf16',quantization:false,model_ready:ready,defaults:{attention_backend:'auto',acceleration_lora:'none',steps:50},options:{attention_backends:['auto','native','_native_flash'].map(id=>({id,supported:true,configured:true,ready})),acceleration_loras:[{id:'none',supported:true,configured:true,ready,steps:{min:2,max:50,default:50}},{id:'lightx2v-ref2va-4step',supported:true,configured:turbo,ready:turbo&&ready,steps:{min:5,max:5,required:5,denoiser_evaluations:4},reason:turbo?'':'未在启动配置中预加载'}]}});

const ID='a'.repeat(32), OTHER='b'.repeat(32), KEY='synthetic-video-client-test-key-0001';
const ref=(kind='image',name='reference.png',body='fixture')=>({kind,file:new File([body],name)});
const input=(overrides={})=>({prompt:'An amber paper kite turns above a pale blue sea.',files:[ref()],...overrides});
const client=(fetchImpl,options={})=>createVideoClient({url:'https://api.example.test',key:KEY,fetchImpl,cryptoImpl:webcrypto,retryDelayMs:0,...options});
const job=(status='queued',extra={})=>({id:ID,status,...extra});
const manifest=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const errorCode=code=>error=>error instanceof VideoApiError&&error.code===code;
const rangeResponse=(bytes,start,end)=>new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}});

test('endpoint normalization permits secure origins and explicit loopback development',()=>{
  assert.equal(normalizeVideoEndpoint(' https://api.example.test/v1/ '),'https://api.example.test');
  assert.equal(normalizeVideoEndpoint('https://api.example.test/proxy/v1'),'https://api.example.test/proxy');
  for(const host of ['localhost','127.0.0.1','[::1]'])assert.equal(normalizeVideoEndpoint(`http://${host}:8000/`),`http://${host}:8000`);
  for(const url of ['http://example.com','https://user:pass@example.com','https://example.com/?key=x','https://example.com/#x','file:///tmp/api','javascript:alert(1)','https://example.com/a%2fb'])
    assert.throws(()=>normalizeVideoEndpoint(url),errorCode('ENDPOINT'));
});

test('client refuses weak credentials, invalid budgets and unsupported fetch',()=>{
  assert.throws(()=>client(()=>{},{key:'short'}),errorCode('KEY'));
  assert.throws(()=>client(()=>{},{key:'x'.repeat(32)+'\nheader'}),errorCode('KEY'));
  for(const options of [{timeoutMs:0},{uploadTimeoutMs:600001},{chunkBytes:0},{downloadConcurrency:5},{downloadRetries:4},{maxDownloadBytes:513*1024*1024}])
    assert.throws(()=>client(()=>{},options),errorCode('INPUT'));
  assert.throws(()=>client(null),errorCode('NETWORK'));
});

test('validation matches reference order and normal service defaults without mutating inputs',()=>{
  const files=[ref('video','scene.MP4'),ref('audio','sound.mp3'),ref('image','subject.webp')];
  const value=validateVideoRequest(input({files,width:'512',height:'288',steps:'8',seed:'0'}));
  assert.deepEqual(value.files.map(item=>item.kind),['video','audio','image']);
  assert.equal(value.files[0].file,files[0].file);assert.notEqual(value.files,files);
  assert.deepEqual([value.width,value.height,value.steps,value.seed],[512,288,8,0]);
  const defaults=validateVideoRequest(input());
  for(const [key,value] of Object.entries(VIDEO_DEFAULTS))assert.equal(defaults[key],value);
  assert.equal(defaults.steps,50);
  assert.doesNotThrow(()=>validateVideoRequest(input({prompt:'🪁'.repeat(4000)})));
});

test('validation rejects audio-only, file limits and malformed metadata before upload',()=>{
  const fake=(name,size)=>({name,size,arrayBuffer(){},stream(){}});
  for(const files of [[],[ref('audio','voice.wav')],Array.from({length:10},()=>ref()),
    [ref(),...Array.from({length:4},()=>ref('video','video.mp4'))],
    [{kind:'image',file:fake('big.png',VIDEO_LIMITS.fileBytes+1)}],
    [{kind:'image',file:fake('zero.png',0)}],
    Array.from({length:3},()=>({kind:'image',file:fake('large.png',32*1024*1024)})),
    [ref('image','wrong.gif')],[ref('unknown','what.png')],[{kind:'image',file:{name:'fake.png',size:1}}]])
    assert.throws(()=>validateVideoRequest(input({files})),errorCode('INPUT'));
});

test('validation enforces aligned geometry and actual generation bounds',()=>{
  for(const invalid of [{prompt:' '},{prompt:'x'.repeat(4001)},{seconds:15},{seconds:4.99},{seconds:null},
    {width:257},{width:256.5},{width:1344,height:1344},{width:0},{height:''},
    {steps:1},{steps:51},{steps:2.5},{seed:-1},{seed:2147483648},{seed:true}])
    assert.throws(()=>validateVideoRequest(input(invalid)),errorCode('INPUT'));
  assert.doesNotThrow(()=>validateVideoRequest(input({seconds:14.375,width:1344,height:768,steps:2,seed:2147483647})));
});

test('BF16 acceleration is explicit and Turbo refuses incompatible steps without coercion',()=>{
  for(const invalid of [{attention_backend:'sage'},{attention_backend:'flash3'},{acceleration_lora:'https://example.test/arbitrary.safetensors'},{acceleration_lora:'lightx2v-ref2va-4step',steps:4},{acceleration_lora:'lightx2v-ref2va-4step',steps:8}])
    assert.throws(()=>validateVideoRequest(input(invalid)),errorCode('INPUT'));
  const value=validateVideoRequest(input({attention_backend:'_native_flash',acceleration_lora:'lightx2v-ref2va-4step',steps:5}));
  assert.equal(value.steps,5);assert.equal(value.attention_backend,'_native_flash');
  assert.throws(()=>validateVideoAcceleration(value,capabilities(false)),errorCode('CAPABILITIES'));
  assert.doesNotThrow(()=>validateVideoAcceleration(value,capabilities(true,false)));
});

test('capability discovery validates precision, schema and step semantics with Bearer authentication',async()=>{
  let target;const api=client(async(url,options)=>{target=url;assert.equal(options.headers.Authorization,`Bearer ${KEY}`);return Response.json(capabilities(true));});
  assert.equal((await api.capabilities()).precision,'bf16');assert.equal(target,'https://api.example.test/v1/capabilities');
  for(const mutate of [value=>value.precision='fp8',value=>value.quantization=true,value=>delete value.instance_id,value=>value.instance_id='',value=>value.workflow='t2v',value=>value.schema_version=2,value=>value.options.attention_backends.push(value.options.attention_backends[0]),value=>value.options.acceleration_loras[1].steps.required=4,value=>value.options.acceleration_loras[0].steps.max=51]){
    const value=capabilities(true);mutate(value);assert.throws(()=>validateVideoCapabilities(value),errorCode('CAPABILITIES'));
  }
});

test('multipart preserves explicit native Flash and Turbo controls',async()=>{
  let form;const api=client(async(url,options)=>{form=options.body;return Response.json(job(),{status:202});});
  await api.submit(input({attention_backend:'_native_flash',acceleration_lora:'lightx2v-ref2va-4step',steps:5}),'turbo-request');
  assert.equal(form.get('attention_backend'),'_native_flash');assert.equal(form.get('acceleration_lora'),'lightx2v-ref2va-4step');assert.equal(form.get('steps'),'5');
});

test('upload sends ordered multipart, one Bearer request and no manually invented boundary',async()=>{
  const calls=[];
  const api=client(async(url,options)=>{calls.push({url,options});return Response.json(job('queued',{waiting_for:'model_ready'}),{status:202});});
  const value=await api.submit(input({files:[ref('video','scene.mp4'),ref('image','still.png'),ref('audio','sound.wav')],steps:8}),'new-task.1');
  assert.equal(value.status,'queued');assert.equal(value.waiting_for,'model_ready');assert.equal(calls.length,1);
  const {url,options}=calls[0];assert.equal(url,'https://api.example.test/v1/jobs');assert.equal(options.method,'POST');
  assert.equal(options.headers.Authorization,`Bearer ${KEY}`);assert.equal(options.headers['Idempotency-Key'],'new-task.1');
  assert.equal(options.headers['Content-Type'],undefined);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
  assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');
  assert.deepEqual(options.body.getAll('files').map(file=>file.name),['scene.mp4','still.png','sound.wav']);
  assert.equal(options.body.get('kinds'),'["video","image","audio"]');assert.equal(options.body.get('steps'),'8');
});

test('preflight validation and already aborted signals never dispatch a POST',async()=>{
  let calls=0;const api=client(async()=>{calls++;return Response.json(job());});
  await assert.rejects(api.submit(input(),'not valid'),errorCode('INPUT'));
  await assert.rejects(api.submit(input({files:[]}),'valid-key'),errorCode('INPUT'));
  const controller=new AbortController();controller.abort();
  await assert.rejects(api.submit(input(),'valid-key',{signal:controller.signal}),error=>error.code==='CANCELLED'&&!error.unknown);
  assert.equal(calls,0);
});

test('lost upload acknowledgement is unknown, preserves request identity and never retries POST',async()=>{
  let calls=0;const api=client(async()=>{calls++;throw new TypeError('network failed '+KEY);});
  await assert.rejects(api.submit(input(),'persisted-key'),error=>{
    assert.equal(error.code,'SUBMISSION_UNKNOWN');assert.equal(error.unknown,true);assert.equal(error.idempotencyKey,'persisted-key');
    assert.equal(error.jobId,null);assert.ok(!error.message.includes(KEY));return true;
  });
  assert.equal(calls,1);
});

test('server unknown submission carries recovery ID but foreign status URLs never receive credentials',async()=>{
  const urls=[];const api=client(async(url)=>{urls.push(url);return urls.length===1?
    Response.json({detail:{message:'outcome unknown',job_id:ID,status_url:'https://evil.invalid/steal',idempotency_key:'original'}},{status:503}):
    Response.json(job('running',{status_url:'https://evil.invalid/steal'}));});
  let unknown;try{await api.submit(input(),'original');}catch(error){unknown=error;}
  assert.equal(unknown.code,'SUBMISSION_UNKNOWN');assert.equal(unknown.jobId,ID);assert.equal(unknown.httpStatus,503);
  assert.equal((await api.job(unknown.jobId)).status,'running');
  assert.deepEqual(urls,['https://api.example.test/v1/jobs',`https://api.example.test/v1/jobs/${ID}`]);
});

test('explicit upload rejection remains distinct from outcome unknown',async()=>{
  for(const status of [401,409,413,422,429,507]){
    let calls=0;const api=client(async()=>{calls++;return Response.json({detail:'rejected'},{status,headers:{'Retry-After':'5'}});});
    await assert.rejects(api.submit(input(),'key'),error=>error.code==='HTTP'&&error.httpStatus===status&&!error.unknown&&error.retryAfter===5);
    assert.equal(calls,1);
  }
});

test('malformed successful POST response is unknown, not proof of rejected generation',async()=>{
  for(const response of [new Response('not json',{status:202}),Response.json({status:'queued'},{status:202}),Response.json(job('invented'),{status:202})]){
    let calls=0;const api=client(async()=>{calls++;return response;});
    await assert.rejects(api.submit(input(),'recover-key'),error=>error.code==='SUBMISSION_UNKNOWN'&&error.unknown);
    assert.equal(calls,1);
  }
});

test('bounded deadlines cover fetch and response body; upload timeout remains unknown',async()=>{
  const hung=()=>new Promise(()=>{});
  await assert.rejects(client(hung,{timeoutMs:15}).system(),errorCode('TIMEOUT'));
  await assert.rejects(client(hung,{uploadTimeoutMs:15}).submit(input(),'timeout-key'),error=>error.code==='SUBMISSION_UNKNOWN'&&error.unknown);
  const stream=new ReadableStream({start(){},cancel(){}});
  await assert.rejects(client(async()=>new Response(stream),{timeoutMs:15}).system(),errorCode('TIMEOUT'));
});

test('aborting a dispatched POST preserves unknown outcome rather than claiming cancellation',async()=>{
  const controller=new AbortController();let started;
  const ready=new Promise(resolve=>{started=resolve;});
  const api=client(async()=>{started();return new Promise(()=>{});});
  const pending=api.submit(input(),'abort-key',{signal:controller.signal});await ready;controller.abort();
  await assert.rejects(pending,error=>error.code==='SUBMISSION_UNKNOWN'&&error.unknown);
});

test('job queries enforce identity and use no server-provided route',async()=>{
  const api=client(async()=>Response.json({id:OTHER,status:'succeeded'}));
  await assert.rejects(api.job(ID),errorCode('RESPONSE'));
  assert.throws(()=>api.job('../file'),errorCode('INPUT'));
  const malformed=client(async()=>Response.json(job('invented')));
  await assert.rejects(malformed.job(ID),errorCode('RESPONSE'));
});

test('cancel acknowledgement preserves actual running or terminal server state',async()=>{
  const states=['cancel_requested','succeeded','cancelled'];let calls=0;
  const api=client(async(url,options)=>{assert.equal(url,`https://api.example.test/v1/jobs/${ID}/cancel`);assert.equal(options.method,'POST');
    assert.equal(options.body,undefined);return Response.json(job(states[calls++]),{status:202});});
  for(const state of states)assert.equal((await api.cancel(ID)).status,state);
  const lost=client(async()=>{throw new Error('lost');});
  await assert.rejects(lost.cancel(ID),error=>error.code==='CANCEL_UNKNOWN'&&error.unknown&&error.jobId===ID);
});

test('JSON response budget and invalid JSON are bounded observable failures',async()=>{
  await assert.rejects(client(async()=>new Response('x',{headers:{'Content-Length':String(1024*1024+1)}})).system(),errorCode('RESPONSE'));
  await assert.rejects(client(async()=>Response.json(['not','object'])).system(),errorCode('RESPONSE'));
  assert.equal((await client(async()=>Response.json({api_ready:true,model_ready:false})).system()).model_ready,false);
});

test('authenticated Range download is concurrent within budget, ordered and verified',async()=>{
  const bytes=new TextEncoder().encode('abcdefghijklmnopqrstuvwx'),calls=[],progress=[];
  let active=0,peak=0;
  const api=client(async(url,options)=>{
    assert.equal(url,`https://api.example.test/v1/jobs/${ID}/file`);assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,`Bearer ${KEY}`);
    const [_,a,b]=/^bytes=(\d+)-(\d+)$/.exec(options.headers.Range),start=Number(a),end=Number(b);calls.push([start,end]);
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,start===4?12:2));active--;
    return rangeResponse(bytes,start,end);
  },{chunkBytes:4,downloadConcurrency:3});
  const result=await api.download(ID,{...manifest(bytes),url:'https://evil.invalid/file'},{onProgress:value=>progress.push(value.loaded)});
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),bytes);assert.equal(result.blob.type,'video/mp4');
  assert.equal(result.filename,`${ID}.mp4`);assert.equal(result.sha256,manifest(bytes).sha256);assert.equal(result.bytes,bytes.length);
  assert.equal(peak,3);assert.equal(calls.length,6);assert.deepEqual(calls[0],[0,3]);
  assert.equal(progress.at(-1),bytes.length);assert.ok(progress.every((value,i)=>i===0||value>progress[i-1]));
});

test('Range capability probe accepts a whole-file fallback only once',async()=>{
  const bytes=new TextEncoder().encode('whole video fixture');let calls=0;
  const result=await client(async()=>{calls++;return new Response(bytes);},{chunkBytes:3}).download(ID,manifest(bytes));
  assert.equal(calls,1);assert.equal(await result.blob.text(),'whole video fixture');
});

test('only failed download ranges retry; successful earlier ranges are retained',async()=>{
  const bytes=new TextEncoder().encode('abcdefghijkl'),attempts=new Map();
  const api=client(async(url,options)=>{
    const [_,a,b]=/^bytes=(\d+)-(\d+)$/.exec(options.headers.Range),start=Number(a),end=Number(b);
    const count=(attempts.get(start)||0)+1;attempts.set(start,count);
    if(start===4&&count===1)throw new TypeError('one interrupted range');
    return rangeResponse(bytes,start,end);
  },{chunkBytes:4,downloadConcurrency:2});
  assert.equal((await api.download(ID,manifest(bytes))).bytes,12);
  assert.deepEqual([...attempts].sort((a,b)=>a[0]-b[0]),[[0,1],[4,2],[8,1]]);
});

test('download retries are bounded and enforce exact Content-Range',async()=>{
  const bytes=new TextEncoder().encode('abcdefgh');let calls=0;
  const api=client(async()=>{calls++;return new Response(bytes.slice(0,4),{status:206,headers:{'Content-Range':'bytes 1-4/8'}});},{chunkBytes:4,downloadRetries:2});
  await assert.rejects(api.download(ID,manifest(bytes)),errorCode('DOWNLOAD_RANGE'));assert.equal(calls,3);
});

test('hash mismatch, short files and download budget never become playable results',async()=>{
  const bytes=new TextEncoder().encode('good video');
  await assert.rejects(client(async()=>new Response('evil video')).download(ID,manifest(bytes)),errorCode('DOWNLOAD_INTEGRITY'));
  await assert.rejects(client(async()=>new Response('short'),{downloadRetries:0}).download(ID,manifest(bytes)),errorCode('DOWNLOAD_RANGE'));
  let calls=0;const api=client(async()=>{calls++;return new Response(bytes);},{maxDownloadBytes:5});
  await assert.rejects(api.download(ID,manifest(bytes)),errorCode('DOWNLOAD_LIMIT'));
  await assert.rejects(api.download(ID,{bytes:1,sha256:'bad'}),errorCode('DOWNLOAD_INTEGRITY'));
  assert.equal(calls,0);
});

test('download abort stops all active ranges without POST or hidden completion',async()=>{
  const bytes=new TextEncoder().encode('abcdefghijklmnop'),controller=new AbortController();let calls=0,abortedCount=0,notify;
  const active=new Promise(resolve=>{notify=resolve;});
  const api=client(async(url,options)=>{
    calls++;if(calls===1)return rangeResponse(bytes,0,3);
    if(calls===3)notify();
    return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{abortedCount++;reject(new Error('aborted'));},{once:true}));
  },{chunkBytes:4,downloadConcurrency:2});
  const pending=api.download(ID,manifest(bytes),{signal:controller.signal});await active;controller.abort();
  await assert.rejects(pending,errorCode('CANCELLED'));assert.equal(abortedCount,2);assert.equal(calls,3);
});

test('diagnostics record one redacted event per request and never expose form payload or echoed key',async()=>{
  clearNetworkLogs();
  const api=client(async()=>Response.json({detail:`invalid ${KEY}`},{status:401}));
  await assert.rejects(api.submit(input({prompt:'private prompt'}),'audit-key'),error=>!error.message.includes(KEY));
  const logs=getNetworkLogs(),text=JSON.stringify(logs);
  assert.equal(logs.length,1);assert.equal(logs[0].status,401);assert.equal(logs[0].requestPayload,null);
  assert.ok(!text.includes(KEY));assert.ok(!text.includes('private prompt'));assert.equal(logs[0].transport.verified,false);
});
