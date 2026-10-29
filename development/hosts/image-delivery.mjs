import assert from 'node:assert/strict';
import {createImageDelivery} from '../../src/image-delivery.js';
import {report} from './report.mjs';
await report('image-delivery',async()=>{
  let released=0;const host=createImageDelivery({urls:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:()=>released++},decode:async()=>({width:1,height:1})});const [image]=await host.prepare([{mimeType:'image/png',data:'iVBORw0KGgo='}],[1024,1024]);assert.equal(image.checks.decoded,'passed');assert.equal(image.checks.dimensions,'mismatch');host.dispose();assert.equal(released,1);return {syntheticDecoder:true,dimensionMismatchRetained:true,objectURLReleased:true};
});
