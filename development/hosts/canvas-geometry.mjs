import assert from 'node:assert/strict';
import {createCanvasGeometry} from '../../src/canvas-geometry.js';
import {report} from './report.mjs';
await report('canvas-geometry',async()=>{
  const window={},host=createCanvasGeometry({window});const b=host.floatingMenuBounds({top:300,bottom:340},1000,{top:0,height:400});assert.ok(b.top>=8&&b.top+Math.min(1000,b.maxHeight)<=392);assert.equal(typeof window.__llmScrollDiagnostics,'function');host.dispose();assert.equal(window.__llmScrollDiagnostics,undefined);return {boundedMenu:true,diagnosticsReleased:true};
});
