import assert from 'node:assert/strict';
import {identifyProvider} from '../../src/provider-identity.js';
import {report} from './report.mjs';

await report('provider-identity', () => {
  const config={protocol:'openai',url:'https://api.openai.com/v1'};
  assert.deepEqual(identifyProvider(config),{provider:'openai',profileMatched:true});
  assert.deepEqual(identifyProvider({...config,url:'https://api.openai.com/custom'}),{provider:'openai',profileMatched:false});
  assert.equal(identifyProvider({...config,protocol:'gemini'}).profileMatched,false);
  assert.equal(identifyProvider({...config,url:'https://api.openai.com.evil.example/v1'}).provider,null);
  assert.equal(config.url,'https://api.openai.com/v1');
  return {declaredPathMatched:true,otherPathUnverified:true,wrongProtocolUnmatched:true,inputUnchanged:true};
});
