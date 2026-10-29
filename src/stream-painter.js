import { replyMetricsMarkup } from './usage.js';
import { reasoningContentMarkup } from './view-markup.js';
/** Updates only the current reply DOM; preserves reader position and disclosure state. */
export function createStreamPainter({app,get,saveLocal,recordScrollDiagnostic,render,messageMarkup,isDisposed=()=>false}) {
function paintStream(d, message) {
  if(isDisposed())return;
  saveLocal();
  if (get() !== d) return;
  const follow = app.scrollHeight - app.clientHeight - app.scrollTop <= 32;
  let node = app.querySelector(`[data-stream-message="${message.id}"]`);
  if (!node) {
    const loading=app.querySelector('.api-loading')?.closest?.('.message');
    if(!loading?.insertAdjacentHTML){render();return;}
    loading.insertAdjacentHTML('beforebegin',messageMarkup(message));
    node=app.querySelector(`[data-stream-message="${message.id}"]`);
    if(!node)return;
  }
  if (message.reasoningText) {
    let reasoning = node.querySelector('.reasoning-content');
    if (!reasoning) {
      node.querySelector('.reply-text').insertAdjacentHTML('beforebegin', reasoningContentMarkup(message));
      reasoning = node.querySelector('.reasoning-content');
    }
    reasoning.querySelector('.reasoning-text').textContent = message.reasoningText;
    reasoning.querySelector('summary').textContent = message.incomplete ? '模型公开思考 · 未完成' : '模型公开思考';
  }
  node.querySelector('.reply-text').textContent = message.text;
  node.querySelector('.assistant-label').textContent = message.incomplete ? '未完成 · 未加入上下文' : message.streaming ? '正在回复…' : '模型回复';
  if (message.metrics && !node.querySelector('.reply-metrics')) node.querySelector('.assistant-message').insertAdjacentHTML('beforeend', `<div class="reply-metrics">${replyMetricsMarkup(message.metrics)}</div>`);
  if (follow) { recordScrollDiagnostic('stream-follow-write',app.scrollHeight-app.scrollTop); app.scrollTop = app.scrollHeight; }
}

return paintStream;
}
