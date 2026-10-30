/** 开发态课题：各类卡片如何以同一登记方式组合数据、展示与动作？
 * 状态边界：五种已登记类型；具体效果由显式 host 回调提供。
 * 扩展：在一个类型条目中登记视图和动作；历史及导航无需添加特例。
 * 契约：docs/contracts/workbench-cards.json；局部宿主不替代完整 F/C/H/Q。
 */
import {CARD_TYPES,validCard} from './card-types.js';
import {createCardRegistry} from './interaction-cards.js';
import {chartCardMarkup,logCardMarkup,confirmationCardMarkup} from './card-markup.js';

/** This is the composition catalog, not a second dispatcher. A card definition
 * keeps its codec, view, inputs and actions together. Navigation and persistence
 * never need a new kind-specific branch when a data card is added here.
 */
export function createWorkbenchCards(host) {
  const action=(keys,run,whileBusy=false)=>({keys,whileBusy,
    validate:args=>Object.keys(args).length===keys.length&&keys.every(key=>typeof args[key]==='string'),run});
  const settingsAction=(name,keys=[])=>action(keys,context=>host.settingsAction(name,context));
  const fields=kind=>({'field.change':{keys:['key','value'],
    validate:args=>Object.keys(args).length===2&&CARD_TYPES[kind].fields.includes(args.key)&&typeof args.value==='string',
    run:context=>host.field(context)}});
  const definition=(kind,render,actions)=>({...CARD_TYPES[kind],kind,render,actions,validateCard:validCard});
  return createCardRegistry([
    definition('api',host.apiMarkup,{
      ...fields('api'),supplier:settingsAction('supplier'),'choose-supplier':settingsAction('choose-supplier',['index']),
      'pull-models':settingsAction('pull-models'),'choose-model':settingsAction('choose-model',['model']),'toggle-key':settingsAction('toggle-key')
    }),
    definition('model',host.modelMarkup,{
      ...fields('model'),'toggle-input':settingsAction('toggle-input',['modality']),
      'reasoning-toggle':settingsAction('reasoning-toggle'),'reasoning-family':settingsAction('reasoning-family',['family'])
    }),
    definition('chart',chartCardMarkup,{'refresh-chart':action([],({card,workspace})=>{card.values=CARD_TYPES.chart.capture(host.usage(workspace));host.render();return {ok:true};})}),
    definition('logs',logCardMarkup,{'refresh-logs-card':action([],({card})=>{card.values=CARD_TYPES.logs.capture(host.logs());host.render();return {ok:true};})}),
    definition('confirmation',card=>confirmationCardMarkup(card,host.confirmationAvailable(card.id)),{
      'confirm-card':action(['choice'],({card,workspace,args})=>['yes','no'].includes(args.choice)?host.settle(workspace,card.id,args.choice==='yes'):{ok:false,reason:'invalid-choice'},true)
    })
  ]);
}
