/** 开发态课题：如何共用卡片外壳并区分未知与零？
 * 状态边界：纯字符串生成；输入由类型 codec 校验，DOM 布局另验。
 * 扩展：新展示器返回转义内容并复用 shell。
 * 契约：docs/contracts/card-markup.json；局部宿主不替代完整 F/C/H/Q。
 */
import {esc} from './view-markup.js';

/** One visual shell and bounded, escaped data views. Liveness comes from the host;
 * availability describes this action's conditions and is not persisted on cards.
 */
export function cardShell(card,body,{live,disabled=false}={}) {
  return `<div class="message" data-interaction-card="${card.id}"><div class="card-wrap"><fieldset ${!live||disabled?'disabled':''} class="card-fieldset"><div class="setup-card ${live?'':'old'}">${live?'':'<span class="disabled-tag">历史记录</span>'}${body}</div></fieldset></div></div>`;
}
export function chartCardMarkup(card) {
  const {title,rows=[],note=''}=card.values, maximum=Math.max(1,...rows.map(row=>row.value??0));
  return `<div class="card-type">${esc(title||'用量图表')}</div><dl class="card-chart">${rows.map(row=>`<div class="card-chart-row"><dt>${esc(row.label)}</dt><dd><span class="card-chart-bar" style="width:${row.value===null?0:Math.min(100,100*row.value/maximum)}%"></span><output>${row.value===null?'未知':esc(row.value)}</output></dd></div>`).join('')}</dl><p class="model-note">${esc(note)}</p><button data-action="refresh-chart" data-id="${card.id}">更新此快照</button>`;
}
export function logCardMarkup(card) {
  const {title,entries=[],note=''}=card.values;
  return `<div class="card-type">${esc(title||'日志快照')}</div><p class="model-note">${esc(note)}</p><pre class="card-log">${esc(entries.length?JSON.stringify(entries,null,2):'暂无通讯记录。')}</pre><button data-action="refresh-logs-card" data-id="${card.id}">更新此快照</button>`;
}
export function confirmationCardMarkup(card,available) {
  return `<div class="card-type">${esc(card.values.title||'调用确认')}</div><p class="card-confirmation-text">${esc(card.values.text)}</p><div class="card-actions"><button data-action="confirm-card" data-id="${card.id}" data-choice="yes" ${available?'':'disabled'}>确认</button><button data-action="confirm-card" data-id="${card.id}" data-choice="no" ${available?'':'disabled'}>取消</button></div>${available?'':'<p class="model-note">此记录没有正在等待的调用。需要时请重新发起。</p>'}`;
}
export function unknownCardMarkup(card) { return `<div class="card-type">${esc(card.kind)} · v${esc(card.version??1)}</div><p class="model-note">当前版本没有此卡片的交互实现；保留原始数据。</p><pre class="card-log">${esc(JSON.stringify(card.values,null,2))}</pre>`; }
