import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotWorkspace,snapshotJournal,replayJournal,MAX_JOURNAL_BYTES} from '../src/persistence.js';
const workspace=()=>({api:{protocol:'gemini',url:'https://example.com/v1',key:'',trustedTarget:'',model:'test',supplier:'test'},model:{inputs:['text'],output:'20'},draft:'',attachments:[],pendingTextId:null,aspectRatio:'1:1',imageSize:'1K',messages:[],history:[],busy:false,lastUsage:null,lastMetrics:null});
function fixture(){return {data:{chat:workspace(),image:workspace()},page:'chat',nextId:30,views:{}};}
function journal(f,extra={}){return {schema:1,owner:'tab-a',sequence:3,baseRevision:4,patch:snapshotJournal(f),cleared:{},...extra};}

test('bounded journal contains draft/settings but no history, attachments, diagnostics or credentials',()=>{
 const f=fixture(),d=f.data.chat;d.api.key='live-secret';d.api.trustedTarget='trusted-secret';d.api.headers={authorization:'header-secret'};d.draft='draft live-secret old-secret';
 d.history=[{role:'assistant',raw:{content:'history-sentinel'}}];d.messages=[{id:1,type:'user',text:'message-sentinel'}];d.attachments=[{base64:'attachment-sentinel'}];d.logs=['log-sentinel'];
 const j=snapshotJournal({...f,secrets:['live-secret','old-secret']}),serialized=JSON.stringify(j);
 for(const text of ['live-secret','old-secret','trusted-secret','header-secret','history-sentinel','message-sentinel','attachment-sentinel','log-sentinel'])assert.ok(!serialized.includes(text),text);
 assert.match(j.workspaces.chat.draft,/draft/);assert.equal(j.workspaces.chat.api.url,'https://example.com/v1');assert.deepEqual(j.workspaces.chat.model,d.model);
});

test('busy journal recovers submitted text rather than empty composer without replaying a request',()=>{
 const f=fixture(),d=f.data.chat;d.busy=true;d.pendingTextId=1;d.messages=[{id:1,type:'user',text:'submitted prompt'}];
 assert.equal(snapshotJournal(f).workspaces.chat.draft,'submitted prompt');assert.equal(snapshotJournal(f).workspaces.chat.busy,undefined);
});

test('immediate reload replays newest draft and settings against matching base revision',()=>{
 const f=fixture(),saved=snapshotWorkspace(f);f.data.chat.draft='new';f.data.chat.model.output='50';f.page='image';
 const r=replayJournal(saved,journal(f),{revision:4,owner:'older-tab',sequence:20});
 assert.equal(r.status,'replayed');assert.equal(r.value.workspaces.chat.draft,'new');assert.equal(r.value.workspaces.chat.model.output,'50');assert.equal(r.value.page,'image');assert.equal(saved.workspaces.chat.draft,'');
});

test('clear tombstone clears only matching workspace content and metrics before reload',()=>{
 const f=fixture();for(const [i,d] of Object.values(f.data).entries()){d.messages=[{id:i+1,type:'user',text:'old'}];d.history=[{role:'user',content:'old'}];d.lastMetrics={usage:{totalTokens:3}};d.pendingTextId=i+1;}
 const saved=snapshotWorkspace(f);f.data.chat.draft='after clear';
 const r=replayJournal(saved,journal(f,{cleared:{chat:3}}),{revision:4});
 assert.equal(r.status,'replayed');for(const key of ['messages','history','attachments'])assert.deepEqual(r.value.workspaces.chat[key],[]);assert.equal(r.value.workspaces.chat.pendingTextId,null);assert.equal(r.value.workspaces.chat.draft,'after clear');assert.deepEqual(r.value.metrics.chat,{lastUsage:null,lastMetrics:null,messages:{}});assert.deepEqual(r.value.workspaces.image,saved.workspaces.image);assert.deepEqual(r.value.metrics.image,saved.metrics.image);
});

test('newer same-owner journal follows already advanced IDB commit',()=>{
 const f=fixture(),saved=snapshotWorkspace(f);f.data.chat.draft='later';const r=replayJournal(saved,journal(f,{sequence:6}),{revision:5,owner:'tab-a',sequence:5});assert.equal(r.status,'replayed');assert.equal(r.value.workspaces.chat.draft,'later');
});

test('already committed same-owner sequence is stale and cannot resurrect old draft or clear',()=>{
 const f=fixture(),saved=snapshotWorkspace(f);f.data.chat.draft='obsolete';for(const sequence of [3,4]){const r=replayJournal(saved,journal(f,{cleared:{chat:2}}),{revision:5,owner:'tab-a',sequence});assert.equal(r.status,'stale');assert.equal(r.value,saved);}
});

test('consumed clear is not re-applied when newer journal only edits draft',()=>{
 const f=fixture();f.data.chat.messages=[{id:1,type:'user',text:'new message after clear'}];f.data.chat.history=[{role:'user',content:'new message after clear'}];const saved=snapshotWorkspace(f);f.data.chat.draft='later';
 const r=replayJournal(saved,journal(f,{sequence:6,cleared:{chat:2}}),{revision:5,owner:'tab-a',sequence:5});assert.equal(r.status,'replayed');assert.deepEqual(r.value.workspaces.chat.messages,saved.workspaces.chat.messages);assert.deepEqual(r.value.workspaces.chat.history,saved.workspaces.chat.history);
});

test('foreign-owner advanced revision and impossible future base are conflicts without changes',()=>{
 const f=fixture(),saved=snapshotWorkspace(f);f.data.chat.draft='stale';for(const record of [{revision:5,owner:'tab-b',sequence:1},{revision:3,owner:'tab-a',sequence:1},{revision:3,owner:'tab-b',sequence:99}]){const r=replayJournal(saved,journal(f),record);assert.equal(r.status,'conflict');assert.equal(r.value,saved);}
});

test('absent journal is a no-op; malformed journal and future tombstones fail closed',()=>{
 const f=fixture(),saved=snapshotWorkspace(f);assert.equal(replayJournal(saved,null).status,'none');
 for(const extra of [{schema:2},{owner:''},{sequence:0},{baseRevision:-1},{cleared:{chat:4}},{patch:{workspaces:{chat:{draft:1}}}}])assert.throws(()=>replayJournal(saved,journal(f,extra),{revision:4}),{code:'SCHEMA'});
});

test('synchronous journal enforces small limit rather than silently truncating draft',()=>{
 const f=fixture();f.data.chat.draft='x'.repeat(MAX_JOURNAL_BYTES);assert.throws(()=>snapshotJournal(f),{code:'JOURNAL'});
});
