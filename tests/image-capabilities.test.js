import test from 'node:test';
import assert from 'node:assert/strict';
import { ARK_FLASH_MODEL, ARK_PRO_MODEL, ARK_SIZE_LIMITS, getImageCapabilities, normalizeImageOptions, getImageTool, validateArkPixels } from '../src/image-capabilities.js';
import { IMAGE_MODEL, imagePixels } from '../src/core.js';
const ark = model => ({protocol:'ark',model:model || ARK_FLASH_MODEL});
const gemini = {protocol:'gemini',model:IMAGE_MODEL};

test('Gemini legacy pixels and 42 capabilities agree exactly', () => {
  const capabilities = getImageCapabilities(gemini);
  assert.equal(capabilities.presetSource,'official');
  assert.equal(capabilities.ratios.length,14);
  for (const row of capabilities.ratios) for (const size of capabilities.sizes)
    assert.equal(row.pixelsBySize[size].join('×'),imagePixels(row.ratio,size));
  assert.deepEqual(normalizeImageOptions(gemini),{aspectRatio:'1:1',imageSize:'1K',pixels:[1024,1024]});
});

test('Ark Flash and Pro expose only supported sizes and clear mixed provenance', () => {
  for (const model of [ARK_FLASH_MODEL,ARK_PRO_MODEL]) {
    const capabilities = getImageCapabilities(ark(model));
    assert.equal(capabilities.ratios.length,8);
    assert.deepEqual(capabilities.sizes,['1K','1.5K','2K']);
    assert.equal(capabilities.defaultSize,'2K');
    assert.equal(capabilities.presetSource,'mixed');
    assert.equal(capabilities.presetSources['1K'],'app-preset');
    assert.equal(capabilities.presetSources['1.5K'],'official-reference');
    assert.deepEqual(normalizeImageOptions(ark(model)),{aspectRatio:'1:1',imageSize:'2K',pixels:[2048,2048],size:'2048x2048'});
  }
  assert.deepEqual(normalizeImageOptions(ark(),{aspectRatio:'16:9',imageSize:'2K'}).pixels,[2816,1584]);
  assert.deepEqual(normalizeImageOptions(ark(),{aspectRatio:'21:9',imageSize:'1.5K'}).pixels,[2352,1008]);
});

test('all Ark presets obey published area and ratio limits', () => {
  for (const row of getImageCapabilities(ark()).ratios) for (const size of ['1K','1.5K','2K']) {
    const [width,height] = row.pixelsBySize[size];
    assert(width * height >= ARK_SIZE_LIMITS.minArea);
    assert(width * height <= ARK_SIZE_LIMITS.maxArea);
    assert(width / height >= ARK_SIZE_LIMITS.minRatio);
    assert(width / height <= ARK_SIZE_LIMITS.maxRatio);
    if (size === '1K') {assert.equal(width % 16,0);assert.equal(height % 16,0);}
    assert.equal(normalizeImageOptions(ark(),{aspectRatio:row.ratio,imageSize:size}).size,`${width}x${height}`);
  }
  assert.throws(() => validateArkPixels([100,100]),error => error.code === 'IMAGE_OPTIONS');
  assert.throws(() => validateArkPixels([1000000,1]),error => error.code === 'IMAGE_OPTIONS');
});

test('unknown models and protocol mismatch never inherit image capability', () => {
  for (const config of [{protocol:'ark',model:'ep-not-mapped'},{protocol:'openai',model:IMAGE_MODEL},{protocol:'gemini',model:ARK_FLASH_MODEL},{protocol:'ark',model:'doubao-seedream-unknown'}]) {
    assert.equal(getImageCapabilities(config),null);
    assert.equal(getImageTool(config),null);
    assert.throws(() => normalizeImageOptions(config),error => error.code === 'IMAGE_MODEL');
  }
  assert.throws(() => normalizeImageOptions(ark(),{imageSize:'4K'}),error => error.code === 'IMAGE_OPTIONS');
  assert.throws(() => normalizeImageOptions(ark(),{aspectRatio:'1:8'}),error => error.code === 'IMAGE_OPTIONS');
});

test('dynamic tool schema only offers selected image provider capabilities', () => {
  const tool = getImageTool(ark());
  assert.equal(tool.name,'image_generate');
  assert.deepEqual(tool.parameters.properties.imageSize.enum,['1K','1.5K','2K']);
  assert(tool.parameters.properties.aspectRatio.enum.includes('21:9'));
  assert(!tool.parameters.properties.aspectRatio.enum.includes('1:8'));
  assert.equal(tool.parameters.properties.model,undefined);
  assert.deepEqual(getImageTool(gemini).parameters.properties.imageSize.enum,['1K','2K','4K']);
});
