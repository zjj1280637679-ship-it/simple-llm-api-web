import assert from 'node:assert/strict';
import {copyNativeJSON} from '../../src/native-json.js';
import {report} from './report.mjs';

await report('native-json', () => {
  const input = JSON.parse('{"constructor":"business","apiKey":"schema-field","__proto__":{"value":1},"signature":"opaque"}');
  const output = copyNativeJSON(input);
  assert.deepEqual(output,input);
  output.__proto__.value = 2;
  assert.equal(input.__proto__.value,1);
  assert.equal(Object.prototype.value,undefined);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => copyNativeJSON(cycle),{code:'NATIVE_JSON'});
  return {businessKeysPreserved:true,inputUnchanged:true,prototypeUnchanged:true,cycleRejected:true};
});
