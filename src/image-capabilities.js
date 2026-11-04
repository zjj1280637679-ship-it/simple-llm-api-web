/** Provider/model-specific image presets. No credentials, storage, network or implicit model guesses. */
export const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3';
export const ARK_FLASH_MODEL = 'doubao-seedream-5-0-flash-260915';
export const ARK_PRO_MODEL = 'doubao-seedream-5-0-pro-260628';
export const GEMINI_MODEL = 'gemini-nano-banana-2.1';
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
    invalid('IMAGE_OPTIONS','图片尺寸超出当前登记的方舟像素面积或长宽比范围。');
  return pixels;
}
function oneKPreset(ratio) {
  const [width,height] = ratio.split(':').map(Number), proportion = width / height;
  const pixels = [Math.round(Math.sqrt(1024 ** 2 * proportion) / 16) * 16, Math.round(Math.sqrt(1024 ** 2 / proportion) / 16) * 16];
  return validateArkPixels(pixels);
}
export const GEMINI_CAPABILITY = deepFreeze({
  id:GEMINI_MODEL,label:'Nano Banana 2.1',protocol:'gemini',
  sizes:['1K','2K','4K'],defaultSize:'1K',defaultRatio:'1:1',thinkingLevels:['minimal','medium','high'],sendImageSize:true,
  presetSource:'official',presetSources:{'1K':'official','2K':'official','4K':'official'},presetNotes:'本地收录的 Google 比例与尺寸参考；实际返回尺寸会单独检查，当前账号可用性以请求结果为准。',
  ratios:GEMINI_PIXELS.map(([ratio,pixels]) => ({ratio,pixelsBySize:Object.fromEntries([['1K',1],['2K',2],['4K',4]].map(([size,scale]) => [size,pixels.map(value => value * scale)]))})),
});
// Only exact, dated model identities; unknown aliases never inherit a neighbouring model.
// Source and conflicting Lite ratio wording: docs/IMAGE_ADAPTATION.md (2026-11-04).
const standardRatios=GEMINI_PIXELS.filter(([ratio])=>!['1:4','4:1','1:8','8:1'].includes(ratio));
function geminiCapability(id,label,sizes,ratios,thinkingLevels=[],sendImageSize=true) {
  return deepFreeze({id,label,protocol:'gemini',sizes,defaultSize:'1K',defaultRatio:'1:1',thinkingLevels,sendImageSize,
    presetSource:'official-reference',presetNotes:'按当前模型收录比例与分辨率；实际像素和账号可用性以上游响应为准。',
    // Do not extrapolate another model's pixel grid. Decode actual output separately.
    ratios:ratios.map(([ratio])=>({ratio,pixelsBySize:{}}))});
}
const GEMINI=new Map([
  [GEMINI_MODEL,GEMINI_CAPABILITY],
  ['gemini-3.1-flash-image',geminiCapability('gemini-3.1-flash-image','Nano Banana 2',['512','1K','2K','4K'],GEMINI_PIXELS,['minimal','high'])],
  ['gemini-3.1-flash-lite-image',geminiCapability('gemini-3.1-flash-lite-image','Nano Banana 2 Lite',['1K'],standardRatios,['minimal','high'])],
  ['gemini-3-pro-image',geminiCapability('gemini-3-pro-image','Nano Banana Pro',['1K','2K','4K'],standardRatios)],
  ['gemini-2.5-flash-image',geminiCapability('gemini-2.5-flash-image','Nano Banana',['1K'],standardRatios,[],false)],
]);
export const IMAGE_FIELDS=Object.freeze(['imageResponseMode','imageThinkingLevel']);
export const IMAGE_PREFERENCES=Object.freeze([...IMAGE_FIELDS,'imagePreferredRatio','imagePreferredSize']);
/** Preferences survive incompatible models; only applicable fields enter a request. */
export function imageEffectiveSettings(config,settings={}) {
  const cap=getImageCapabilities(config);
  const gemini=cap?.protocol==='gemini';
  const responseMode=gemini&&settings.imageResponseMode==='image'?'image':'text-image';
  const thinkingLevel=gemini&&cap.thinkingLevels?.includes(settings.imageThinkingLevel)?settings.imageThinkingLevel:'';
  return {responseMode:gemini?responseMode:null,thinkingLevel,
    dormantThinking:Boolean(settings.imageThinkingLevel&&!thinkingLevel)};
}
export function imageGenerationConfig(config,options,settings={}) {
  const cap=getImageCapabilities(config);
  if(cap?.protocol!=='gemini')return null;
  const effective=imageEffectiveSettings(config,settings);
  return {responseModalities:effective.responseMode==='image'?['IMAGE']:['TEXT','IMAGE'],
    imageConfig:{aspectRatio:options.aspectRatio,...(cap.sendImageSize?{imageSize:options.imageSize}:{})},
    ...(effective.thinkingLevel?{thinkingConfig:{thinkingLevel:effective.thinkingLevel.toUpperCase()}}:{})};
}
export function imageSelection(config,current,preferences={}) {
  const cap=getImageCapabilities(config);if(!cap)return null;
  const ratio=preferences.imagePreferredRatio??current.aspectRatio,size=preferences.imagePreferredSize??current.imageSize;
  return {aspectRatio:cap.ratios.some(x=>x.ratio===ratio)?ratio:cap.defaultRatio,imageSize:cap.sizes.includes(size)?size:cap.defaultSize};
}
function arkCapability(model, label) {
  return deepFreeze({
    id:model,label,protocol:'ark',sizes:['1K','1.5K','2K'],defaultSize:'2K',defaultRatio:'1:1',
    presetSource:'mixed',presetSources:{'1K':'app-preset','1.5K':'official-reference','2K':'official-reference'},
    presetNotes:'1K 为应用预设；1.5K / 2K 为本地收录的参考尺寸。实际尺寸单独检查；比例可能因像素取整略有差异。',
    ratios:ARK_REFERENCE.map(([ratio,oneHalfK,twoK]) => ({ratio,pixelsBySize:{'1K':oneKPreset(ratio),'1.5K':validateArkPixels(oneHalfK),'2K':validateArkPixels(twoK)}})),
  });
}
const ARK = new Map([
  [ARK_FLASH_MODEL,arkCapability(ARK_FLASH_MODEL,'Seedream 5.0 Flash')],
  [ARK_PRO_MODEL,arkCapability(ARK_PRO_MODEL,'Seedream 5.0 Pro')],
]);

export function getImageCapabilities(config) {
  const model = typeof config?.model === 'string' ? config.model.trim() : '';
  if (config?.protocol === 'gemini') return GEMINI.get(model.replace(/^models\//,'')) || null;
  if (config?.protocol === 'ark') return ARK.get(model) || null;
  return null;
}

export function normalizeImageOptions(config, options = {}) {
  const capability = getImageCapabilities(config);
  if (!capability) invalid('IMAGE_MODEL','当前应用尚未配置此协议或模型的图片参数；这不代表供应商不具备图片能力。');
  const aspectRatio = options.aspectRatio ?? capability.defaultRatio;
  const imageSize = options.imageSize ?? capability.defaultSize;
  const entry = capability.ratios.find(item => item.ratio === aspectRatio);
  if (!entry || !capability.sizes.includes(imageSize)) invalid('IMAGE_OPTIONS','当前应用预设未收录此图片比例或分辨率；请核对目标模型后补充适配。');
  const pixels = entry.pixelsBySize[imageSize] ? [...entry.pixelsBySize[imageSize]] : null;
  if (capability.protocol === 'ark') validateArkPixels(pixels);
  return {aspectRatio,imageSize,pixels,...(capability.protocol === 'ark' ? {size:pixels.join('x')} : {})};
}

export function getImageTool(config) {
  const capability = getImageCapabilities(config);
  if (!capability) return null;
  return {
    name:'image_generate',
    description:`Generate images in the configured workbench using ${capability.label}. This host obtains approval for each call that may consume API quota. Omitted ratio/size defaults to ${capability.defaultRatio}/${capability.defaultSize}. Other commands are not registered in this host.`,
    parameters:{type:'object',properties:{
      prompt:{type:'string',description:'Complete description of the image to generate.'},
      aspectRatio:{type:'string',enum:capability.ratios.map(item => item.ratio)},
      imageSize:{type:'string',enum:[...capability.sizes]},
    },required:['prompt']},
  };
}
