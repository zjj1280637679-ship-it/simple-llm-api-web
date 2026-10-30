import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {createConversationBook} from '../../src/conversation-book.js';
import {snapshotConversations,restoreConversations} from '../../src/conversation-archive.js';
import {makeData,makePage} from './conversation-fixture.mjs';
await report('conversation-archive',async()=>{const book=createConversationBook({makeData});book.current().data.chat.api.key='synthetic';book.create().data.chat.draft='second';const saved=snapshotConversations({book,page:'chat',nextId:2});assert.ok(!JSON.stringify(saved).includes('synthetic'));const restored=restoreConversations(saved,makePage);assert.equal(restored.entries.length,2);assert.equal(restored.entries[1].data.chat.draft,'second');return {twoConversations:true,credentialsExcluded:true};});
