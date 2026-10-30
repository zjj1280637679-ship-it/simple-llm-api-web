import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationBook,MAX_CONVERSATIONS} from '../src/conversation-book.js';
import {snapshotConversations,migrateConversations,restoreConversations,replayConversationJournal} from '../src/conversation-archive.js';
import {snapshotWorkspace,snapshotJournal} from '../src/persistence.js';
import {makeData,makePage} from '../development/hosts/conversation-fixture.mjs';
import {canNavigateSettings} from '../src/settings-navigation.js';
const create=()=>{let id=0;return createConversationBook({makeData,id:()=>`c${++id}`,now:()=> '2026-10-30T10:00:00.000Z'});};
const capture=book=>snapshotConversations({book,page:'chat',nextId:30});
test('conversation ownership survives switching; card histories and drafts are independent',()=>{
 const book=create(),a=book.current();a.data.chat.draft='first';a.data.chat.messages.push({id:1,type:'card',kind:'api',version:1,values:{}});
 const b=book.create();assert.notEqual(a.data.chat,b.data.chat);b.data.chat.draft='second';book.select(a.id);
 assert.equal(book.current().data.chat.draft,'first');assert.equal(book.owner(b.data.chat),b);assert.equal(a.data.chat.messages.length,1);
 assert.equal(book.select('missing'),null);assert.equal(book.activeId,a.id);book.rename(b.id,'Needle');assert.deepEqual(book.list('needle').map(e=>e.id),[b.id]);
 b.data.chat.busy=true;assert.equal(book.remove(b.id),null);b.data.chat.busy=false;assert.equal(book.remove(b.id),b);
 for(let i=book.entries.length;i<MAX_CONVERSATIONS;i++)book.create();assert.throws(()=>book.create(),{code:'CONVERSATION_LIMIT'});
});
test('archive round trip preserves native protocol content and both sessions without credentials',()=>{
 const book=create(),a=book.current();a.data.chat.api.key='secret-key';a.data.chat.history=[{role:'assistant',raw:{thoughtSignature:'opaque',constructor:'ordinary'}}];a.data.chat.messages=[{id:1,type:'card',kind:'connection',version:1,values:{url:'https://example.com/v1',key:'secret-key'}}];
 const b=book.create();b.data.chat.draft='second';const archive=capture(book);assert.ok(!JSON.stringify(archive).includes('secret-key'));
 const restored=restoreConversations(archive,makePage);assert.equal(restored.activeId,b.id);assert.equal(restored.entries[0].data.chat.history[0].raw.constructor,'ordinary');assert.equal(restored.entries[0].data.chat.api.key,'');assert.equal(restored.entries[1].data.chat.draft,'second');
 assert.throws(()=>migrateConversations({...archive,activeId:'missing'}),{code:'SCHEMA'});
 assert.throws(()=>migrateConversations({...archive,entries:[archive.entries[0],archive.entries[0]]}),{code:'SCHEMA'});
 assert.throws(()=>migrateConversations({...archive,views:{unowned:{top:0,bottom:false}}}),{code:'SCHEMA'});
});
test('legacy workspace migrates once, retaining drafts, history and reading positions',()=>{
 const data=makeData();data.chat.draft='legacy draft';const old=snapshotWorkspace({data,page:'logs',nextId:2,views:{chat:{top:125,bottom:false}}});old.schema=1;
 const migrated=migrateConversations(old);assert.equal(migrated.entries.length,1);assert.equal(migrated.activeId,'legacy');assert.equal(migrated.views['legacy:chat'].top,125);assert.equal(migrated.entries[0].snapshot.workspaces.chat.draft,'legacy draft');assert.deepEqual(migrateConversations(migrated),migrated);
});
test('journal replay binds the named conversation rather than whichever is currently selected',()=>{
 const book=create(),a=book.current(),b=book.create();const archive=capture(book);a.data.chat.draft='latest first';
 const journal={schema:1,owner:'one',sequence:1,baseRevision:0,patch:{...snapshotJournal({data:a.data,page:'chat'}),conversationId:a.id}};
 const replay=replayConversationJournal(archive,journal,{revision:0});assert.equal(replay.status,'replayed');assert.equal(replay.value.entries[0].snapshot.workspaces.chat.draft,'latest first');assert.equal(replay.value.entries[1].snapshot.workspaces.chat.draft,'');
 assert.equal(replayConversationJournal(archive,journal,{revision:1,owner:'two'}).status,'conflict');
 assert.throws(()=>replayConversationJournal(archive,{...journal,patch:{...journal.patch,conversationId:'missing'}},{revision:0}),{code:'SCHEMA'});
 assert.equal(archive.activeId,b.id);assert.equal(archive.entries[0].snapshot.workspaces.chat.draft,'');
});
test('settings relation has exactly the declared four edges and no prototype routes',()=>{
 const expected=new Set(['api:model','api:connection','model:api','connection:api']);
 for(const from of ['api','model','connection','chart','__proto__'])for(const to of ['api','model','connection','chart','__proto__'])assert.equal(canNavigateSettings(from,to),expected.has(`${from}:${to}`));
});
