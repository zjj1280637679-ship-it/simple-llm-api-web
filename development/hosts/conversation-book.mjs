import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {createConversationBook,conversationId} from '../../src/conversation-book.js';
import {makeData} from './conversation-fixture.mjs';
await report('conversation-book',async()=>{let id=0;const book=createConversationBook({makeData,id:()=>`test-${++id}`});const first=book.current(),second=book.create();second.data.chat.draft='second';book.select(first.id);assert.equal(book.owner(second.data.chat),second);assert.equal(first.data.chat.draft,'');second.data.chat.busy=true;assert.equal(book.remove(second.id),null);assert.notEqual(conversationId({}),conversationId({}));return {independentDrafts:true,lateEffectOwner:true,busyDeletionRejected:true,httpDevelopmentIdentity:true};});
