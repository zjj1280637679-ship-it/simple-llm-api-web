import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {historyMarkup,historyListMarkup} from '../../src/history-markup.js';
import {makeData} from './conversation-fixture.mjs';
await report('history-markup',async()=>{const input={entries:[{id:'one',title:'<script>',data:makeData(),updatedAt:'2026-10-30T08:00:00Z'}],activeId:'one'};const html=historyMarkup(input);assert.ok(!html.includes('<script>'));assert.match(html,/aria-current="true"/);assert.match(html,/更多工具/);assert.match(html,/conversation-export/);assert.doesNotMatch(historyListMarkup(input),/<input|history-query/);assert.match(historyListMarkup({entries:[],activeId:'one'}),/没有匹配/);return {escapedTitle:true,currentIdentity:true,managementActions:true,resultProjectionExcludesEditor:true};});
