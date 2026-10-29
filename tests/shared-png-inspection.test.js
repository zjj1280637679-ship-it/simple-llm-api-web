import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {inspectPng} from '../module-library/functions/png-inspection/index.mjs';
import {inspectPng as legacyInspect} from '../module-library/test-resources/shared/png.mjs';

const SAMPLE='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==';
const sample=()=>Buffer.from(SAMPLE,'base64');
const crc32=data=>{let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
function chunk(type,data=Buffer.alloc(0)) {
  const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);
  out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;
}
function png({interlaced=0,raw=Buffer.from([0,0,128,255,255]),compressed=deflateSync(raw)}={}) {
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;header[12]=interlaced;
  return Buffer.concat([sample().subarray(0,8),chunk('IHDR',header),chunk('IDAT',compressed),chunk('IEND')]);
}

test('PNG compatibility entry exposes the unique governed implementation',()=>{
  assert.equal(legacyInspect,inspectPng);
});
test('PNG inspection returns measured dimensions and bounded decoded size without modifying input',()=>{
  const input=sample(),before=Buffer.from(input),result=inspectPng(input);
  assert.deepEqual(result,{width:1,height:1,bitDepth:8,colorType:6,interlaced:false,bytes:input.length,decodedBytes:5,validation:'complete-chunks-crc-zlib-noninterlaced'});
  assert.deepEqual(input,before);result.width=999;
  assert.equal(inspectPng(input).width,1);
  assert.deepEqual(inspectPng(new Uint8Array(input)),inspectPng(input));
});
test('PNG inspection rejects a changed CRC without echoing bytes',()=>{
  const bad=sample();bad[29]^=1;
  assert.throws(()=>inspectPng(bad),error=>error.message==='INVALID_PNG');
});
test('PNG inspection rejects incomplete signature/chunks and data after IEND',()=>{
  const input=sample();
  for(const bad of [Buffer.alloc(0),input.subarray(0,7),input.subarray(0,20),input.subarray(0,-1),Buffer.concat([input,Buffer.from([0])])])
    assert.throws(()=>inspectPng(bad),/INVALID_PNG/);
});
test('PNG inspection enforces caller byte, pixel and dimension ceilings',()=>{
  const input=sample();
  assert.equal(inspectPng(input,{maxBytes:input.length,maxPixels:1,maxDimension:1}).width,1);
  for(const limits of [{maxBytes:input.length-1},{maxPixels:0},{maxDimension:0}])
    assert.throws(()=>inspectPng(input,limits),/INVALID_PNG/);
});
test('PNG inspection rejects malformed zlib, incorrect decoded size and illegal row filter',()=>{
  for(const input of [png({compressed:Buffer.from('not zlib')}),png({raw:Buffer.from([0,1,2,3])}),png({raw:Buffer.from([0,1,2,3,4,5])}),png({raw:Buffer.from([5,1,2,3,4])})])
    assert.throws(()=>inspectPng(input),/INVALID_PNG/);
  assert.equal(inspectPng(png()).decodedBytes,5);
});
test('PNG inspection explicitly rejects interlaced format outside its supported subset',()=>{
  assert.throws(()=>inspectPng(png({interlaced:1})),/INVALID_PNG/);
});
