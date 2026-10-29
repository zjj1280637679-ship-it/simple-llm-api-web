import assert from 'node:assert/strict';
import {esc, tabsMarkup, reasoningContentMarkup} from '../../src/view-markup.js';
import {report} from './report.mjs';
await report('view-markup',async()=>{
  assert.equal(esc('<x>'),'&lt;x&gt;');assert.match(tabsMarkup('image'),/aria-selected="true"[^>]*data-tab="image"/);assert.ok(!reasoningContentMarkup({reasoningText:'<script>',id:1}).includes('<script>'));return {escapedContent:true,selectedTab:true};
});
