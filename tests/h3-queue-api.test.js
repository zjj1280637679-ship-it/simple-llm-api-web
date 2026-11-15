import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { createQueueClient, normalizeBaseUrl, validateTask, validateId, QueueApiError } from '../h3-queue/api.js';

const URL = 'https://queue.example.test';
const KEY = 'synthetic-test-key-please-never-commit-real-keys';
const client = fn => createQueueClient({ url: URL, key: KEY, fetchImpl: fn });
const response = data => Response.json(data);
const baseTask = () => ({ title:'镜头', prompt:'Use <Picture 1>. A person flies.', ref_images:['role.png'], ref_videos:[], ref_audios:[],
  width:864, height:480, duration:5, turbo:true, priority:10, seed:-1 });

test('endpoint normalizes optional /api/v1 and refuses secret-bearing or insecure endpoints', () => {
  assert.equal(normalizeBaseUrl('https://queue.example.test/api/v1/'), URL);
  assert.equal(normalizeBaseUrl('https://queue.example.test/proxy/api/v1'), URL+'/proxy');
  assert.equal(normalizeBaseUrl('http://localhost:8000'), 'http://localhost:8000');
  for(const candidate of ['http://queue.example.test','https://name:pw@queue.example.test','https://queue.example.test/?api_key=secret',
    'https://queue.example.test/#fragment','javascript:alert(1)','https://queue.example.test/a%2fb']) {
    assert.throws(() => normalizeBaseUrl(candidate), QueueApiError);
  }
});

test('validates task ID, parameters and independent media tag order', () => {
  assert.equal(validateId('123'),123);
  for(const id of [0,-1,'1/2','../../status',1.5,'abc']) assert.throws(() => validateId(id));
  const input = baseTask();input.ref_images = ['role.png','second.png'];input.ref_videos = ['movement.mp4'];
  assert.deepEqual(validateTask(input).ref_images,['role.png','second.png']);
  assert.equal(validateTask(input).seed,-1);
  for(const invalid of [ { prompt:'' }, { ref_images:Array(10).fill('x') }, { ref_videos:Array(4).fill('x') },
    { width:-1 }, { duration:0 }, { priority:1.5 }, { seed:-2 }, { turbo:'true' } ]) {
    assert.throws(() => validateTask({ ...baseTask(), ...invalid }), QueueApiError);
  }
});

test('status uses X-API-Key, not URL, bearer or query auth', async () => {
  const calls=[];
  const api=client(async (url, options) => { calls.push({ url, options }); return response({ ok:true, queue:{ PENDING:1 } }); });
  const result=await api.status();
  assert.equal(result.queue.PENDING,1);
  assert.equal(calls[0].url, URL+'/api/v1/status');
  assert.equal(calls[0].options.headers['X-API-Key'],KEY);
  assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.equal(calls[0].options.credentials,'omit');
  assert.equal(calls[0].options.referrerPolicy,'no-referrer');
  assert.equal(calls[0].options.redirect,'error');
});

test('upload sends multipart files and consumes ordered server filenames', async () => {
  const files=[new File(['a'],'picture.png'),new File(['v'],'movie.mp4')];
  const api=client(async (url, options) => {
    assert.equal(url,URL+'/api/v1/upload');
    assert.equal(options.method,'POST');
    assert.equal(options.headers['Content-Type'],undefined);
    assert.deepEqual(options.body.getAll('files').map(f=>f.name),['picture.png','movie.mp4']);
    return response({ ok:true, uploaded:[{ filename:'picture.png',size_bytes:1 },{ filename:'movie.mp4',size_bytes:1 }] });
  });
  assert.deepEqual((await api.upload(files)).map(x=>x.filename),['picture.png','movie.mp4']);
});

test('task submit, batch and control actions use documented routes and bodies', async () => {
  const calls=[];
  const api=client(async (url, options) => {
    calls.push([url,options.method, typeof options.body === 'string'?JSON.parse(options.body):undefined]);
    if(url.endsWith('/tasks/batch')) return response({ok:true,task_ids:[2,3]});
    if(url.endsWith('/tasks') && options.method === 'POST') return response({ok:true,task_id:1,task:{id:1,status:'PENDING'}});
    return response({ok:true});
  });
  assert.equal((await api.createTask(baseTask())).id,1);
  await api.createBatch([baseTask(),baseTask()]);
  await api.taskAction(1,'top');await api.taskAction(1,'cancel');await api.taskAction(1,'retry');await api.taskAction(1,'delete');
  await api.queueAction('pause');await api.queueAction('resume');await api.queueAction('clear');
  assert.deepEqual(calls.map(x=>[x[0].slice(URL.length),x[1]]),[
    ['/api/v1/tasks','POST'],['/api/v1/tasks/batch','POST'],['/api/v1/tasks/1/top','POST'],
    ['/api/v1/tasks/1/cancel','POST'],['/api/v1/tasks/1/retry','POST'],['/api/v1/tasks/1','DELETE'],
    ['/api/v1/queue/pause','POST'],['/api/v1/queue/resume','POST'],['/api/v1/queue/clear','POST']]);
  assert.equal(calls[0][2].seed,-1);assert.equal(calls[1][2].tasks.length,2);
});

test('list filter and numeric lookup protect against mismatched task identity', async () => {
  const calls=[];
  const api=client(async (url) => {
    calls.push(url);
    return url.includes('?') ? response({ok:true,tasks:[{id:5,status:'PENDING'}]}) : response({ok:true,task:{id:5,status:'PENDING'}});
  });
  assert.equal((await api.listTasks({status:'PENDING',limit:50})).length,1);
  assert.equal((await api.task(5)).id,5);
  assert.ok(calls[0].includes('/api/v1/tasks?limit=50&status=PENDING'));
  await assert.rejects(client(async()=>response({ok:true,task:{id:8,status:'PENDING'}})).task(5), /不匹配/);
  await assert.rejects(client(async()=>response({ok:true, unexpected:[]})).listTasks(), /tasks\/items/);
});

test('status errors redact secrets and lost task acknowledgements are unknown, not retryable success', async () => {
  await assert.rejects(client(async()=>new Response(JSON.stringify({ok:false,error:'bad '+KEY}),{status:401})).status(),e => !e.message.includes(KEY) && e.status===401);
  let submits=0;
  await assert.rejects(client(async()=>{submits++;throw new TypeError('connection lost '+KEY);}).createTask(baseTask()), e => e.unknown === true && !e.message.includes(KEY));
  assert.equal(submits,1);
});

test('binary video uses authenticated route and returns playable blob without URL key leakage', async () => {
  const bytes=new Uint8Array([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);
  const progress=[];
  const api=client(async (url, options) => {
    assert.equal(url, URL+'/api/v1/tasks/123/video');
    assert.equal(options.headers['X-API-Key'],KEY);
    return new Response(bytes,{headers:{'Content-Type':'video/mp4','Content-Length':String(bytes.length)}});
  });
  const blob=await api.video(123,(loaded)=>progress.push(loaded));
  assert.equal(blob.type,'video/mp4');
  assert.equal(blob.size,bytes.length);
  assert.equal(progress.at(-1),bytes.length);
});
