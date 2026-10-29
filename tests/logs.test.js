import test from 'node:test';
import assert from 'node:assert/strict';
import { setLogSecrets, updateActiveLogSecrets, recordNetwork, getNetworkLogs, clearNetworkLogs, exportNetworkLogs, sanitizeLogValue, renderNetworkLogs, subscribeNetworkLogs } from '../src/logs.js';

test('credentials redacted in headers, queries, echoed prompts, errors and encoded key', () => {
  clearNetworkLogs();
  setLogSecrets(['secret-ONE+/']);
  recordNetwork({ source: 'network', endpoint: 'https://example.com/a?key=unknown&X-Amz-Signature=another&safe=yes', requestHeaders: {Authorization:'Bearer secret-ONE+/', 'x-goog-api-key':'secret-ONE+/'}, requestPayload:{ prompt:'echo secret-ONE+/ or secret-ONE%2B%2F', password:'pw'}, responsePayload:'secret-ONE+/', error:new Error('echo secret-ONE+/') });
  const output = exportNetworkLogs();
  for (const value of ['secret-ONE+/', 'secret-ONE%2B%2F', 'unknown', 'another', '"pw"']) assert.equal(output.includes(value), false, value);
  assert.match(output, /REDACTED/);
  assert.match(output, /safe=yes/);
});
test('registration accumulates and retroactively scrubs known credentials', () => {
  clearNetworkLogs();
  recordNetwork({ requestPayload:'prior-key' });
  setLogSecrets(['prior-key']);
  setLogSecrets(['new-key']);
  recordNetwork({ requestPayload:'prior-key new-key secret-ONE+/' });
  assert.doesNotMatch(exportNetworkLogs(), /prior-key|new-key|secret-ONE/);
});
test('real, mock, unknown; exact errors/cancellation, and request ID upsert preserved', () => {
  clearNetworkLogs();
  recordNetwork({ requestId:'a', source:'network', status:'pending', startedAt:'2026-01-01' });
  recordNetwork({ requestId:'a', source:'network', status:429, durationMs:12, error:{code:'HTTP',message:'rate limited'} });
  recordNetwork({ requestId:'b', source:'mock', error:{code:'CANCELLED'} });
  recordNetwork({ requestId:'c' });
  const rows = getNetworkLogs();
  assert.equal(rows.length, 3);
  assert.equal(rows[0].status, 429);
  assert.equal(rows[0].startedAt, '2026-01-01');
  assert.equal(rows[0].durationMs, 12);
  assert.equal(rows[1].error.code, 'CANCELLED');
  assert.equal(rows[1].source, 'mock');
  assert.equal(rows[2].source, 'unknown');
});
test('binary and oversized values bounded; cycles safe', () => {
  const cyclic = {}; cyclic.me = cyclic;
  const result = sanitizeLogValue({b64_json:'A'.repeat(100000), data:'data:image/png;base64,AA==', binary:new Uint8Array(100), text:'x'.repeat(100000), cyclic});
  assert.equal(result.b64_json.omitted, 'base64');
  assert.equal(result.b64_json.characters, 100000);
  assert.equal(result.data.mimeType, 'image/png');
  assert.equal(result.binary.bytes, 100);
  assert.match(result.text, /TRUNCATED/);
  assert.equal(result.cyclic.me, '[Circular]');
  const huge = sanitizeLogValue(Object.fromEntries(Array.from({length:100}, (_, i) => [i, 'x'.repeat(10000)])));
  assert.ok(JSON.stringify(huge).length < 66000);
});
test('memory ring, copies, subscription isolation and clear', () => {
  clearNetworkLogs();
  let count = 0;
  const off = subscribeNetworkLogs(() => {count++; throw new Error('UI failed');});
  for (let i=0;i<105;i++) recordNetwork({requestId:`r${i}`,source:'mock'});
  const rows = getNetworkLogs();
  assert.equal(rows.length, 100); assert.equal(rows[0].requestId,'r5');
  rows[0].source = 'network';
  assert.equal(getNetworkLogs()[0].source,'mock');
  clearNetworkLogs(); off();
  assert.equal(count,106); assert.equal(getNetworkLogs().length,0);
});
test('renderer treats hostile payload as text, never HTML', () => {
  clearNetworkLogs();
  const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  recordNetwork({source:'network',endpoint:'https://example.com',responsePayload:payload});
  const elements = [];
  const doc = {createElement(tag) { const node = {tag,children:[],append(...children){this.children.push(...children);},set innerHTML(_) {throw new Error('unsafe HTML');}}; elements.push(node); return node; }};
  const container = {ownerDocument:doc,replaceChildren(){},append(){}};
  renderNetworkLogs(container);
  assert.ok(elements.some(node => node.tag === 'pre' && node.textContent.includes(payload)));
});

test('active cross-workspace keys protect echoes without archiving typed prefixes', () => {
  clearNetworkLogs();
  updateActiveLogSecrets(['chat-unused-credential', 'image-unused-credential']);
  recordNetwork({responsePayload:'chat-unused-credential image-unused-credential'});
  assert.doesNotMatch(exportNetworkLogs(), /chat-unused-credential|image-unused-credential/);
  clearNetworkLogs();
  updateActiveLogSecrets(['A']);
  updateActiveLogSecrets(['ABCD']);
  recordNetwork({responsePayload:'A normal text ABCD'});
  assert.equal(getNetworkLogs()[0].responsePayload, 'A normal text [REDACTED]');
  setLogSecrets(['ABCD']);
  updateActiveLogSecrets([]);
  clearNetworkLogs();
  recordNetwork({responsePayload:'old ABCD stays protected'});
  assert.doesNotMatch(exportNetworkLogs(), /ABCD/);
});
test('small provider binary data and opaque continuity tokens omitted', () => {
  const result = sanitizeLogValue({inlineData:{mimeType:'image/png',data:'AA=='}, b64_json:'AA==', data:'plain text', thoughtSignature:'opaque', thought_signature:'opaque', encrypted_content:'opaque'});
  assert.equal(result.inlineData.data.omitted,'base64');
  assert.equal(result.b64_json.omitted,'base64');
  assert.equal(result.data,'plain text');
  assert.equal(result.thoughtSignature,'[REDACTED]');
  assert.equal(result.thought_signature,'[REDACTED]');
  assert.equal(result.encrypted_content,'[REDACTED]');
});

test('wide nested primitive arrays cannot bypass total serialized budget', () => {
  for (const value of [null, true, 123456789, '\u0000'.repeat(10000)]) {
    const payload = Array.from({length:100}, () => Array.from({length:100}, () => Array.from({length:100}, () => value)));
    const serialized = JSON.stringify(sanitizeLogValue(payload));
    assert.ok(serialized.length < 65000, `serialized size: ${serialized.length}`);
    assert.match(serialized, /TRUNCATED/);
  }
});

test('encoded known secrets redact mixed percent hex case without folding credential letters', () => {
  setLogSecrets(['synthetic+cred/byte']);
  const variants = ['synthetic%2Bcred%2Fbyte','synthetic%2bcred%2fbyte','synthetic%2Bcred%2fbyte','synthetic%2bcred%2Fbyte'];
  for (const value of variants) assert.equal(sanitizeLogValue(value), '[REDACTED]');
  assert.equal(sanitizeLogValue('Synthetic%2bcred%2fbyte'), 'Synthetic%2bcred%2fbyte');
});

test('editable prefixes are read-time projections and never destroy stored envelopes', () => {
  clearNetworkLogs(); updateActiveLogSecrets([]);
  recordNetwork({requestId:'sample',source:'network',status:200,requestPayload:'status report',responsePayload:'synthetic-final-entered-key'});
  updateActiveLogSecrets(['s']);
  const temporary = getNetworkLogs()[0];
  assert.equal(temporary.status,200);
  assert.ok(Object.hasOwn(temporary,'requestId'));
  assert.ok(Object.hasOwn(temporary,'source'));
  updateActiveLogSecrets(['synthetic-final-entered-key']);
  const final = getNetworkLogs()[0];
  assert.equal(final.requestId,'sample');
  assert.equal(final.source,'network');
  assert.equal(final.requestPayload,'status report');
  assert.equal(final.responsePayload,'[REDACTED]');
  assert.doesNotMatch(exportNetworkLogs(), /synthetic-final-entered-key/);
  recordNetwork({requestId:'next',source:'network',requestPayload:'synthetic-final-entered-key'});
  assert.equal(getNetworkLogs()[1].requestPayload,'[REDACTED]');
  updateActiveLogSecrets([]);
});
