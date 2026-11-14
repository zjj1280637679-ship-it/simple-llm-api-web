import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {createVideoWorkspace} from '../../src/video-workspace.js';
import {report} from './report.mjs';

const capabilities=(turbo=false,ready=false)=>({schema_version:1,instance_id:'instance-a',workflow:'ref2va',precision:'bf16',quantization:false,model_ready:ready,defaults:{attention_backend:'auto',acceleration_lora:'none',steps:50},options:{attention_backends:['auto','native','_native_flash'].map(id=>({id,supported:true,configured:true,ready})),acceleration_loras:[{id:'none',supported:true,configured:true,ready,steps:{min:2,max:50,default:50}},{id:'lightx2v-ref2va-4step',supported:true,configured:turbo,ready:turbo&&ready,steps:{min:5,max:5,required:5,denoiser_evaluations:4},reason:turbo?'':'未在启动配置中预加载'}]}});

await report('video-workspace',async()=>{
  const id='a'.repeat(32),job={id,instance_id:'synthetic-instance',status:'queued',waiting_for:'model_ready'};
  let serialized='',submits=0,cancels=0,downloads=0,created=0,revoked=0;
  const store={getItem:()=>serialized||null,setItem:(key,value)=>{serialized=value;}};
  const clock={now:()=>1000,setTimeout:()=>1,clearTimeout(){}};
  const clientFactory=()=>({
    capabilities:async()=>({...capabilities(true,false),instance_id:'synthetic-instance'}),
    system:async()=>({instance_id:'synthetic-instance',model_ready:false,queue:{admission_open:true}}),
    submit:async()=>{submits++;return {...job};},job:async()=>({...job}),
    cancel:async()=>{cancels++;job.status='cancelled';return {...job};},
    download:async()=>{downloads++;return {blob:new Blob(['video']),bytes:5,filename:'synthetic.mp4'};}
  });
  const options={document:{},window:{location:{pathname:'/host/'},URL:{createObjectURL:()=>{created++;return 'blob:host';},revokeObjectURL:()=>revoked++}},clock,clientFactory,storage:store,cryptoImpl:null};
  const ui=createVideoWorkspace(options);ui.mount({querySelector:()=>null});
  ui.setConnection({url:'https://synthetic.example',key:'host-secret-never-persist'});await ui.connect();
  ui.handleInput({dataset:{videoField:'draft'},value:'A new amber pinwheel beside a teal lake'});ui.addFiles([new File(['reference'],'synthetic.png')]);ui.handleInput({dataset:{videoField:'acceleration_lora'},value:'lightx2v-ref2va-4step'});await ui.submit();assert.equal(submits,0);assert.equal(ui.snapshot().options.steps,50);await ui.handleClick({dataset:{action:'video-turbo-steps'}});await ui.submit();
  assert.equal(submits,1);assert.equal(ui.snapshot().jobs[0].status,'queued');assert.match(ui.snapshot().jobs[0].label,/等待模型/);
  assert.doesNotMatch(serialized,/host-secret|pinwheel|synthetic.png/);await ui.cancelJob(id);assert.equal(ui.snapshot().jobs[0].status,'cancelled');assert.equal(cancels,1);
  job.id='b'.repeat(32);job.status='queued';ui.handleInput({dataset:{videoField:'draft'},value:'A new violet origami boat on a silver stream'});ui.addFiles([new File(['second-reference'],'second.png')]);await ui.submit();
  job.status='succeeded';job.artifact={bytes:5};await ui.refreshJob(job.id);assert.equal(downloads,0);await ui.downloadJob(job.id);assert.equal(created,1);assert.equal(ui.snapshot().jobs[1].mediaReady,true);
  ui.dispose();assert.equal(revoked,1);assert.equal(cancels,1);
  const restored=createVideoWorkspace(options);assert.equal(restored.snapshot().keyPresent,false);assert.equal(restored.snapshot().jobs.length,2);assert.equal(submits,2);await restored.cancelJob(id);assert.equal(cancels,1);restored.dispose();
  return {queuedBeforeModelReady:true,turboRequiresExplicitFiveSteps:true,onlyExplicitSubmissions:true,independentSecretFreeStorage:true,serverCancellationObserved:true,mediaOnDemand:true,disposedResourceReleased:true,reloadDoesNotResubmit:true};
});
