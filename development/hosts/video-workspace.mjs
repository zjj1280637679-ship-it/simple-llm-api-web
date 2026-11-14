import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {createVideoWorkspace} from '../../src/video-workspace.js';
import {report} from './report.mjs';

await report('video-workspace',async()=>{
  const id='a'.repeat(32),job={id,instance_id:'synthetic-instance',status:'queued',waiting_for:'model_ready'};
  let serialized='',submits=0,cancels=0,downloads=0,created=0,revoked=0;
  const store={getItem:()=>serialized||null,setItem:(key,value)=>{serialized=value;}};
  const clock={now:()=>1000,setTimeout:()=>1,clearTimeout(){}};
  const clientFactory=()=>({
    system:async()=>({instance_id:'synthetic-instance',model_ready:false,queue:{admission_open:true}}),
    submit:async()=>{submits++;return {...job};},job:async()=>({...job}),
    cancel:async()=>{cancels++;job.status='cancelled';return {...job};},
    download:async()=>{downloads++;return {blob:new Blob(['video']),bytes:5,filename:'synthetic.mp4'};}
  });
  const options={document:{},window:{location:{pathname:'/host/'},URL:{createObjectURL:()=>{created++;return 'blob:host';},revokeObjectURL:()=>revoked++}},clock,clientFactory,storage:store,cryptoImpl:null};
  const ui=createVideoWorkspace(options);ui.mount({querySelector:()=>null});
  ui.setConnection({url:'https://synthetic.example',key:'host-secret-never-persist'});await ui.connect();
  ui.handleInput({dataset:{videoField:'draft'},value:'A new amber pinwheel beside a teal lake'});ui.addFiles([new File(['reference'],'synthetic.png')]);await ui.submit();
  assert.equal(submits,1);assert.equal(ui.snapshot().jobs[0].status,'queued');assert.match(ui.snapshot().jobs[0].label,/等待模型/);
  assert.doesNotMatch(serialized,/host-secret|pinwheel|synthetic.png/);await ui.cancelJob(id);assert.equal(ui.snapshot().jobs[0].status,'cancelled');assert.equal(cancels,1);
  job.id='b'.repeat(32);job.status='queued';ui.handleInput({dataset:{videoField:'draft'},value:'A new violet origami boat on a silver stream'});ui.addFiles([new File(['second-reference'],'second.png')]);await ui.submit();
  job.status='succeeded';job.artifact={bytes:5};await ui.refreshJob(job.id);assert.equal(downloads,0);await ui.downloadJob(job.id);assert.equal(created,1);assert.equal(ui.snapshot().jobs[1].mediaReady,true);
  ui.dispose();assert.equal(revoked,1);assert.equal(cancels,1);
  const restored=createVideoWorkspace(options);assert.equal(restored.snapshot().keyPresent,false);assert.equal(restored.snapshot().jobs.length,2);assert.equal(submits,2);await restored.cancelJob(id);assert.equal(cancels,1);restored.dispose();
  return {queuedBeforeModelReady:true,onlyExplicitSubmissions:true,independentSecretFreeStorage:true,serverCancellationObserved:true,mediaOnDemand:true,disposedResourceReleased:true,reloadDoesNotResubmit:true};
});
