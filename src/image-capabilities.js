/** Provider/model-specific image presets. No credentials, storage, network or implicit model guesses. */
export const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3';
export const ARK_FLASH_MODEL = 'doubao-seedream-5-0-flash-260915';
export const ARK_PRO_MODEL = 'doubao-seedream-5-0-pro-260628';
const GEMINI_MODEL = 'gemini-nano-banana-2.1';
const GEMINI_PIXELS = [
  ['1:1',[1024,1024]],['1:4',[512,2048]],['1:8',[384,3072]],['2:3',[848,1264]],
  ['3:2',[1264,848]],['3:4',[896,1200]],['4:1',[2048,512]],['4:3',[1200,896]],
  ['4:5',[928,1152]],['5:4',[1152,928]],['8:1',[3072,384]],['9:16',[768,1376]],
  ['16:9',[1376,768]],['21:9',[1584,672]],
];
// Ark official reference sizes are examples, not an exhaustive dimensions whitelist.
// 1K is deliberately an application preset: target area 1024², nearest multiples of 16.
const ARK_REFERENCE = [
  ['1:1',[1536,1536],[2048,2048]], ['4:3',[1792,1344],[2368,1776]],
  ['3:4',[1344,1792],[1776,2368]], ['16:9',[2048,1152],[2816,1584]],
  ['9:16',[1152,2048],[1584,2816]], ['3:2',[1872,1248],[2496,1664]],
  ['2:3',[1248,1872],[1664,2496]], ['21:9',[2352,1008],[3136,1344]],
];
export const ARK_SIZE_LIMITS = Object.freeze({minArea:921600,maxArea:4624220,minRatio:1/16,maxRatio:16});
const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze); Object.freeze(value);
  }
  return value;
};
function invalid(code, message) { const error = new Error(message); error.name = 'ImageCapabilityError'; error.code = code; throw error; }
export function validateArkPixels(pixels) {
  if (!Array.isArray(pixels) || pixels.length !== 2 || pixels.some(value => !Number.isInteger(value) || value <= 0))
    invalid('IMAGE_OPTIONS','图片尺寸必须是正整数宽高。');
  const [width,height] = pixels, area = width * height, ratio = width / height;
  if (area < ARK_SIZE_LIMITS.minArea || area > ARK_SIZE_LIMITS.maxArea || ratio < ARK_SIZE_LIMITS.minRatio || ratio > ARK_SIZE_LIMITS.maxRatio)
    invalid('IMAGE_OPTIONS','图片尺寸超出火山方舟当前模型的像素面积或长宽比范围。');
  return pixels;
}
function oneKPreset(ratio) {
  const [width,height] = ratio.split(':').map(Number), proportion = width / height;
  const pixels = [Math.round(Math.sqrt(1024 ** 2 * proportion) / 16) * 16, Math.round(Math.sqrt(1024 ** 2 / proportion) / 16) * 16];
  return validateArkPixels(pixels);
}
const GEMINI = deepFreeze({
  id:GEMINI_MODEL,label:'Nano Banana 2.1',protocol:'gemini',
  sizes:['1K','2K','4K'],defaultSize:'1K',defaultRatio:'1:1',
  presetSource:'official',presetSources:{'1K':'official','2K':'official','4K':'official'},presetNotes:'Google 官方比例与分辨率参考尺寸',
  ratios:GEMINI_PIXELS.map(([ratio,pixels]) => ({ratio,pixelsBySize:Object.fromEntries([['1K',1],['2K',2],['4K',4]].map(([size,scale]) => [size,pixels.map(value => value * scale)]))})),
});
function arkCapability(model, label) {
  return deepFreeze({
    id:model,label,protocol:'ark',sizes:['1K','1.5K','2K'],defaultSize:'2K',defaultRatio:'1:1',
    presetSource:'mixed',presetSources:{'1K':'app-preset','1.5K':'official-reference','2K':'official-reference'},
    presetNotes:'1K 为应用预设；1.5K / 2K 为官方参考尺寸。比例可能因像素取整略有差异。',
    ratios:ARK_REFERENCE.map(([ratio,oneHalfK,twoK]) => ({ratio,pixelsBySize:{'1K':oneKPreset(ratio),'1.5K':validateArkPixels(oneHalfK),'2K':validateArkPixels(twoK)}})),
  });
}
const ARK = new Map([
  [ARK_FLASH_MODEL,arkCapability(ARK_FLASH_MODEL,'Seedream 5.0 Flash')],
  [ARK_PRO_MODEL,arkCapability(ARK_PRO_MODEL,'Seedream 5.0 Pro')],
]);

export function getImageCapabilities(config) {
  const model = typeof config?.model === 'string' ? config.model.trim() : '';
  if (config?.protocol === 'gemini' && model.replace(/^models\//,'') === GEMINI_MODEL) return GEMINI;
  if (config?.protocol === 'ark') return ARK.get(model) || null;
  return null;
}

export function normalizeImageOptions(config, options = {}) {
  const capability = getImageCapabilities(config);
  if (!capability) invalid('IMAGE_MODEL','此协议或模型尚未配置已验证的图片能力。');
  const aspectRatio = options.aspectRatio ?? capability.defaultRatio;
  const imageSize = options.imageSize ?? capability.defaultSize;
  const entry = capability.ratios.find(item => item.ratio === aspectRatio);
  if (!entry || !capability.sizes.includes(imageSize)) invalid('IMAGE_OPTIONS','图片比例或分辨率不受当前模型支持。');
  const pixels = [...entry.pixelsBySize[imageSize]];
  if (capability.protocol === 'ark') validateArkPixels(pixels);
  return {aspectRatio,imageSize,pixels,...(capability.protocol === 'ark' ? {size:pixels.join('x')} : {})};
}

export function getImageTool(config) {
  const capability = getImageCapabilities(config);
  if (!capability) return null;
  return {
    name:'image_generate',
    description:`Generate one image in the image workbench using ${capability.label}. User approval is required for each paid call. Omitted ratio/size defaults to ${capability.defaultRatio}/${capability.defaultSize}. No shell or other commands are available.`,
    parameters:{type:'object',properties:{
      prompt:{type:'string',description:'Complete description of the image to generate.'},
      aspectRatio:{type:'string',enum:capability.ratios.map(item => item.ratio)},
      imageSize:{type:'string',enum:[...capability.sizes]},
    },required:['prompt']},
  };
}
