import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {createHash,webcrypto} from 'node:crypto';
import {report} from './report.mjs';
import {createVideoClient} from '../../src/video-api.js';

const capabilities=(turbo=false,ready=false)=>({schema_version:1,instance_id:'instance-a',workflow:'ref2va',precision:'bf16',quantization:false,model_ready:ready,defaults:{attention_backend:'auto',acceleration_lora:'none',steps:50},options:{attention_backends:['auto','native','_native_flash'].map(id=>({id,supported:true,configured:true,ready})),acceleration_loras:[{id:'none',supported:true,configured:true,ready,steps:{min:2,max:50,default:50}},{id:'lightx2v-ref2va-4step',supported:true,configured:turbo,ready:turbo&&ready,steps:{min:5,max:5,required:5,denoiser_evaluations:4},reason:turbo?'':'未在启动配置中预加载'}]}});

await report('video-api',async()=>{
  const id='c'.repeat(32),key='synthetic-video-host-credential-0001';
  // Deliberately transport bytes, not a claim to have encoded or decoded a video.
  const bytes=new TextEncoder().encode('synthetic video transport fixture');
  const artifact={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  let postCount=0,getCount=0,rangeCount=0;
  const fetchImpl=async(url,options)=>{
    assert.equal(options.headers.Authorization,`Bearer ${key}`);assert.equal(options.redirect,'error');
    const path=new URL(url).pathname;
    if(options.method==='POST'){
      postCount++;
      if(path.endsWith('/cancel'))return Response.json({id,status:'cancel_requested'},{status:202});
      assert.equal(options.body.get('attention_backend'),'_native_flash');assert.equal(options.body.get('acceleration_lora'),'lightx2v-ref2va-4step');assert.equal(options.body.get('steps'),'5');
      assert.equal(options.body.get('kinds'),'["image"]');assert.equal(options.body.getAll('files')[0].name,'fixture.png');
      return Response.json({id,status:'queued',waiting_for:'model_ready'},{status:202});
    }
    getCount++;
    if(path==='/v1/capabilities')return Response.json(capabilities(true,false));
    if(path==='/v1/system')return Response.json({api_ready:true,model_ready:false,queue:{admission_open:true}});
    if(path.endsWith('/file')){
      rangeCount++;const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(options.headers.Range),start=Number(a),end=Number(b);
      return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}});
    }
    return Response.json({id,status:'succeeded',artifact,file_url:'https://untrusted.example/file'});
  };
  const api=createVideoClient({url:'https://video.example',key,fetchImpl,cryptoImpl:webcrypto,chunkBytes:8});
  assert.equal((await api.system()).model_ready,false);assert.equal((await api.capabilities()).precision,'bf16');
  const submitted=await api.submit({prompt:'A blue paper lantern rises slowly.',files:[{kind:'image',file:new File(['fixture'],'fixture.png')}],width:512,height:288,steps:5,attention_backend:'_native_flash',acceleration_lora:'lightx2v-ref2va-4step'},'host-immutable-request');
  assert.equal(submitted.status,'queued');assert.equal(submitted.waiting_for,'model_ready');
  assert.equal((await api.cancel(id)).status,'cancel_requested');
  const succeeded=await api.job(id);assert.equal(succeeded.status,'succeeded');
  const result=await api.download(id,succeeded.artifact);
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),bytes);assert.equal(result.sha256,artifact.sha256);
  assert.equal(postCount,2);assert.equal(rangeCount,Math.ceil(bytes.length/8));
  return {syntheticTransport:true,realNetwork:false,realGpu:false,postCount,getCount,rangeCount,
    queuedBeforeModelReadyObserved:true,cancelNotAssumedTerminal:true,artifactBytesVerified:true,mediaDecoded:false};
});
