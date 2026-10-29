import test from 'node:test';
import assert from 'node:assert/strict';
import {copyNativeJSON, NATIVE_JSON_LIMITS} from '../src/native-json.js';

test('native JSON preserves business keys and opaque values without prototype mutation', () => {
  const value = JSON.parse('{"__proto__":{"polluted":true},"constructor":"type","apiKey":"business label","signature":"opaque","prototype":0}');
  const copy = copyNativeJSON(value);
  assert.deepEqual(copy, value);
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  assert.equal(Object.prototype.polluted, undefined);
  assert.notEqual(copy.__proto__, value.__proto__);
});

test('shared acyclic values are copied independently and input is not changed', () => {
  const shared = {text:'value'}, input = [shared, shared];
  const output = copyNativeJSON(input);
  output[0].text = 'changed';
  assert.equal(output[1].text, 'value');
  assert.equal(shared.text, 'value');
  assert.deepEqual(copyNativeJSON(Object.assign(Object.create(null), {value:null})), {value:null});
});

test('non-JSON inputs and cycles fail explicitly instead of losing information', () => {
  const cycle = {}; cycle.child = cycle;
  for (const value of [cycle, undefined, NaN, Infinity, 1n, () => {}, new Date(), new Map(), Symbol()]) {
    assert.throws(() => copyNativeJSON(value), {code:'NATIVE_JSON'});
  }
});

test('accessors are rejected without invoking them; extra/hidden/symbol keys are not silently lost', () => {
  let invoked = false;
  const accessor = Object.defineProperty({}, 'value', {enumerable:true, get() { invoked = true; return 1; }});
  const hidden = Object.defineProperty({}, 'hidden', {value:1});
  for (const value of [accessor, hidden, {[Symbol()]:1}, Object.assign([1], {extra:2}), [,1]]) {
    assert.throws(() => copyNativeJSON(value), {code:'NATIVE_JSON'});
  }
  assert.equal(invoked, false);
});

test('declared depth and node budgets bound a copy attempt', () => {
  let value = 0;
  for (let i = 0; i < NATIVE_JSON_LIMITS.depth; i++) value = [value];
  assert.doesNotThrow(() => copyNativeJSON(value));
  assert.throws(() => copyNativeJSON([value]), {code:'NATIVE_JSON'});
  assert.throws(() => copyNativeJSON(Array(NATIVE_JSON_LIMITS.nodes).fill(0)), {code:'NATIVE_JSON'});
});
