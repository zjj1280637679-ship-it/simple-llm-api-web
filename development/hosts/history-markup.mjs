import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {historyMarkup} from '../../src/history-markup.js';
import {makeData} from './conversation-fixture.mjs';
await report('history-markup',async()=>{const html=historyMarkup({entries:[{id:'one',title:'<script>',data:makeData(),updatedAt:'2026-10-30T08:00:00Z'}],activeId:'one'});assert.ok(!html.includes('<script>'));assert.match(html,/aria-current="true"/);assert.match(html,/更多工具/);assert.match(html,/conversation-export/);return {escapedTitle:true,currentIdentity:true,managementActions:true};});
