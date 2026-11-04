/** 图片参数的浅层选择投影；能力事实来自调用方，选择本身不发请求。
 * 常用集合是当前产品策略；完整比例集合仍可达。两维独立修改，不默默重置另一维。
 * 契约：docs/contracts/image-options-markup.json；浏览器布局与供应商效果另验。
 */
import {esc} from './view-markup.js';
export const COMMON_IMAGE_RATIOS=Object.freeze(['1:1','16:9','9:16']);
export function changeImageOption(capability,current,axis,value) {
  if(!capability || !['ratio','size'].includes(axis))return null;
  const next={aspectRatio:current.aspectRatio,imageSize:current.imageSize,...(axis==='ratio'?{aspectRatio:value}:{imageSize:value})};
  return capability.ratios.some(item=>item.ratio===next.aspectRatio)&&capability.sizes.includes(next.imageSize)?next:null;
}
export function imageOptionsMarkup(capability,current) {
  if(!capability)return '<p class="model-note">当前模板未配置此模型的图片参数，请在设置中选择已支持的图片模型。</p>';
  const ratios=capability.ratios.map(item=>item.ratio);
  const common=COMMON_IMAGE_RATIOS.filter(ratio=>ratios.includes(ratio)),more=ratios.filter(ratio=>!common.includes(ratio));
  const button=(axis,value,selected)=>`<button type="button" class="chip ${selected?'sel':''}" data-action="set-image-option" data-axis="${axis}" data-value="${esc(value)}" aria-label="${axis==='ratio'?'比例':'分辨率'} ${esc(value)}" aria-pressed="${selected}">${esc(value)}</button>`;
  const pixels=capability.ratios.find(item=>item.ratio===current.aspectRatio)?.pixelsBySize[current.imageSize];
  return `<div class="matrix-model">${esc(capability.label)}</div>
<div class="image-choice-group"><span>常用比例</span><div class="chips">${common.map(ratio=>button('ratio',ratio,ratio===current.aspectRatio)).join('')}</div></div>
<div class="image-choice-group"><span>分辨率</span><div class="chips">${capability.sizes.map(size=>button('size',size,size===current.imageSize)).join('')}</div></div>
${more.length?`<details class="image-more-ratios"><summary>更多比例${more.includes(current.aspectRatio)?` · ${esc(current.aspectRatio)}`:''}</summary><div class="chips">${more.map(ratio=>button('ratio',ratio,ratio===current.aspectRatio)).join('')}</div></details>`:''}
<output class="image-selection" aria-live="polite">${esc(current.aspectRatio)} · ${esc(current.imageSize)}${pixels?` · ${esc(pixels.join('×'))}`:''}</output>
${capability.presetNotes?`<p class="matrix-notice">${esc(capability.presetNotes)}</p>`:''}`;
}
