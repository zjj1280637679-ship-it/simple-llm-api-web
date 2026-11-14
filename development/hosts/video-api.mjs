import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {createHash,webcrypto} from 'node:crypto';
import {report} from './report.mjs';
import {createVideoClient} from '../../src/video-api.js';

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
      assert.equal(options.body.get('kinds'),'["image"]');assert.equal(options.body.getAll('files')[0].name,'fixture.png');
      return Response.json({id,status:'queued',waiting_for:'model_ready'},{status:202});
    }
    getCount++;
    if(path==='/v1/system')return Response.json({api_ready:true,model_ready:false,queue:{admission_open:true}});
    if(path.endsWith('/file')){
      rangeCount++;const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(options.headers.Range),start=Number(a),end=Number(b);
      return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}});
    }
    return Response.json({id,status:'succeeded',artifact,file_url:'https://untrusted.example/file'});
  };
  const api=createVideoClient({url:'https://video.example',key,fetchImpl,cryptoImpl:webcrypto,chunkBytes:8});
  assert.equal((await api.system()).model_ready,false);
  const submitted=await api.submit({prompt:'A blue paper lantern rises slowly.',files:[{kind:'image',file:new File(['fixture'],'fixture.png')}],width:512,height:288,steps:8},'host-immutable-request');
  assert.equal(submitted.status,'queued');assert.equal(submitted.waiting_for,'model_ready');
  assert.equal((await api.cancel(id)).status,'cancel_requested');
  const succeeded=await api.job(id);assert.equal(succeeded.status,'succeeded');
  const result=await api.download(id,succeeded.artifact);
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),bytes);assert.equal(result.sha256,artifact.sha256);
  assert.equal(postCount,2);assert.equal(rangeCount,Math.ceil(bytes.length/8));
  return {syntheticTransport:true,realNetwork:false,realGpu:false,postCount,getCount,rangeCount,
    queuedBeforeModelReadyObserved:true,cancelNotAssumedTerminal:true,artifactBytesVerified:true,mediaDecoded:false};
});
