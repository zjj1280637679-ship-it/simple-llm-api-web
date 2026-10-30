import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {requestJSON,subscribeCredentialUse} from '../../src/request-transport.js';
await report('request-transport',async()=>{
  const config={protocol:'openai',url:'https://example.com/v1',trustedTarget:'https://example.com/v1',key:'synthetic-host-key'};
  let observations=0,calls=0;const release=subscribeCredentialUse(()=>observations++);
  const fetchImpl=async()=>{calls++;return Response.json({value:1});};
  assert.equal((await requestJSON(config,'/fixture',{fetchImpl})).value,1);release();await requestJSON(config,'/fixture',{fetchImpl});
  assert.equal(observations,1);assert.equal(calls,2);return {syntheticTransport:true,subscriptionReleased:true,noExtraRetry:true};
});
