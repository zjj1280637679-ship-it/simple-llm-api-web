/** 图片参数的浅层选择投影；能力事实来自调用方，选择本身不发请求。
 * 常用集合是当前产品策略；完整比例集合仍可达。两维独立修改，不默默重置另一维。
 * 契约：docs/contracts/image-options-markup.json；浏览器布局与供应商效果另验。
 */
import {getImageCapabilities,imageEffectiveSettings} from './image-capabilities.js';
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

/** Image-only controls. Text sampling, JSON output and tools have no image-page field. */
export function imageSettingsMarkup(card,config,settings,current) {
  const cap=getImageCapabilities(config);
  if(!cap)return '<p class="model-note">当前应用尚未适配此图片模型，请返回设置选择已适配模型；不代表上游没有图片能力。</p>';
  const effective=imageEffectiveSettings(config,settings);
  const select=(label,key,items,value)=>`<div class="formfield"><label for="${key}${card.id}">${label}</label><select id="${key}${card.id}" data-card="${card.id}" data-key="${key}">${items.map(([v,t])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(t)}</option>`).join('')}</select></div>`;
  const levels={minimal:'最少',medium:'中等',high:'高'};
  const dormant=effective.dormantThinking?`<p class="model-note">已保存思考偏好 ${esc(settings.imageThinkingLevel)}，当前模型不适用，本次使用 API 默认。</p>`:'';
  const ratioDormant=settings.imagePreferredRatio&&settings.imagePreferredRatio!==current.aspectRatio;
  const sizeDormant=settings.imagePreferredSize&&settings.imagePreferredSize!==current.imageSize;
  return `<p class="model-note">${esc(cap.label)} · ${esc(current.aspectRatio)} · ${esc(current.imageSize)}</p>
${ratioDormant||sizeDormant?`<p class="model-note">已保存的${ratioDormant?`比例 ${esc(settings.imagePreferredRatio)}`:''}${ratioDormant&&sizeDormant?' / ':''}${sizeDormant?`分辨率 ${esc(settings.imagePreferredSize)}`:''}暂不适用；当前使用上方参数，切回兼容模型会恢复。</p>`:''}
${cap.protocol==='gemini'?`<details data-setting-section="image-gemini"><summary>Gemini 图片参数</summary>
${select('返回内容','imageResponseMode',[['','文字 + 图片（默认）'],['image','仅图片']],settings.imageResponseMode==='image'?'image':'')}
${cap.thinkingLevels?.length?select('图片思考强度','imageThinkingLevel',[['','API 默认'],...cap.thinkingLevels.map(v=>[v,levels[v]])],effective.thinkingLevel):'<p class="model-note">当前模型未开放可选思考等级，已收起该控制。</p>'}${dormant}
</details>`:''}<div class="formfield"><label>输出格式</label><output class="block-value">上游原始格式</output></div><p class="model-note">生成张数以上游返回为准。</p>`;
}
export function imageSnapshotRows(values) {
  const context=values.displayContext, image=context?.image;
  return [
    ['模型',context?.model||'未记录'],['比例',image?.aspectRatio||'未记录'],['分辨率',image?.imageSize||'未记录'],
    ['返回内容',image?image.responseMode==='image'?'仅图片':image.responseMode==='text-image'?'文字 + 图片':'上游图片':'未记录'],
    ['图片思考强度',image?image.thinkingLevel||'API 默认':'未记录'],
    ...(image?.dormantThinking?[['保留的思考偏好（未应用）',values.imageThinkingLevel]]:[]),
    ['输出格式','上游原始格式'],['生成张数','以上游返回为准']
  ];
}
