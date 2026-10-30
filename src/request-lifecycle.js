/** 开发态课题：请求显示的是哪种可观察阶段，谁终止计时？
 * 状态/边界：每活动工作区一个计时器租约，默认2个工作区；30分钟截止。
 * 扩展：新增阶段须有实际传输/内容信号，截止策略另行论证。
 * 契约：docs/contracts/request-lifecycle.json；局部宿主不替代完整 F/C/H/Q。
 */
import { AppError } from './app-error.js';
/** Owns request presentation and timers; timestamps alone never establish model activity. */
export function createRequestLifecycle({app,get,esc,clock=globalThis}) {
const {setTimeout,clearTimeout,setInterval,clearInterval}=clock;
const stops=new Map();
// These phases describe observed transport evidence, never inferred private thinking.
const REQUEST_DEADLINE_MS = 30 * 60 * 1000;
function loadingPresentation(d, now = Date.now()) {
  const phase = d.requestPhase || 'waiting_headers';
  const active = phase === 'reasoning' || phase === 'output';
  const waited = Math.max(0, (now - (d.requestPhaseAt || now)) / 1000);
  const label = ({waiting_headers:'等待响应头',headers_received:'已收到响应头，等待回复',first_chunk:'已收到数据，等待回复',reasoning:'已收到模型思考信号',output:'正在接收输出'})[phase] || '等待回复';
  return {phase, active, slow:!active && waited >= 15, long:!active && waited >= 45,
    duration:active ? .5 : 1.25,
    label:label + (!active && waited>=45 ? '；等待较久，尚未判定失败，可取消' : '；可随时取消')};
}
function loadingMarkup(d) {
  const x=loadingPresentation(d);
  return `<div class="api-loading" data-phase="${x.phase}" data-active="${x.active}" data-slow="${x.slow}" data-long="${x.long}" title="${esc(x.label)}" role="status" aria-label="${esc(x.label)}"><span class="api-spinner" aria-hidden="true"></span><span class="api-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span><span class="sr-only">${esc(x.label)}</span></div>`;
}
function paintLoading(d, announce=false) {
  if (get() !== d) return;
  const node=app.querySelector('.api-loading'); if(!node) return;
  const x=loadingPresentation(d);
  node.dataset.phase=x.phase;node.dataset.active=String(x.active);node.dataset.slow=String(x.slow);node.dataset.long=String(x.long);
  node.title=x.label;
  const spinner=node.querySelector('.api-spinner');
  // CSS duration remains constant. Synchronize the existing animation timeline
  // before changing rate, rather than recomputing its phase on each timer tick.
  if(spinner?.dataset?.speed !== String(x.duration)){
    for(const animation of spinner?.getAnimations?.() || []){
      if(animation.animationName === 'api-spin' && typeof animation.updatePlaybackRate === 'function') animation.updatePlaybackRate(.8/x.duration);
    }
    if(spinner?.dataset)spinner.dataset.speed=String(x.duration);
  }
  if(announce){node.setAttribute('aria-label',x.label);const live=node.querySelector('.sr-only');if(live)live.textContent=x.label;}
}
function requestPhase(d, phase) {
  if(!d.busy || !['waiting_headers','headers_received','first_chunk','reasoning','output'].includes(phase))return;
  if(phase==='first_chunk' && ['reasoning','output'].includes(d.requestPhase))return;
  if(d.requestPhase===phase)return;
  d.requestPhase=phase;d.requestPhaseAt=Date.now();paintLoading(d,true);
}
function beginLoading(d) {
  d.requestPhase='waiting_headers';d.requestPhaseAt=Date.now();d.requestTimedOut=false;
  stops.get(d)?.();
  const controller=d.controller;
  const tick=setInterval(()=>paintLoading(d),1000);
  const deadline=setTimeout(()=>{if(controller.signal.aborted)return;d.requestTimedOut=true;controller.abort();},REQUEST_DEADLINE_MS);
  const stop = ()=>{clearInterval(tick);clearTimeout(deadline);if(stops.get(d)===stop)stops.delete(d);};
  stops.set(d,stop);
  return stop;
}
function requestError(d,error) {
  return d.requestTimedOut ? new AppError('CLIENT_TIMEOUT','客户端等待已达 30 分钟，已停止等待；供应商可能已经计费。可检查日志后手动重试，未自动重试。') : error;
}

return {loadingPresentation,loadingMarkup,paintLoading,requestPhase,beginLoading,requestError,dispose(){for(const [d,stop] of stops){d.controller?.abort();stop();}}};
}
