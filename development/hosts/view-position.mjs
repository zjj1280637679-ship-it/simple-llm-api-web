import assert from 'node:assert/strict';
import {createViewPosition} from '../../src/view-position.js';
import {report} from './report.mjs';
await report('view-position',async()=>{
  const app={scrollTop:0,scrollHeight:3000,clientHeight:800};let page='chat';const host=createViewPosition({app,document:{},getPage:()=>page});host.restoreViewPosition();app.scrollTop=735;host.rememberViewPosition();page='image';host.restoreViewPosition();assert.equal(app.scrollTop,0);page='chat';host.restoreViewPosition();assert.equal(app.scrollTop,735);host.dispose();return {independentReadingPositions:true};
});
