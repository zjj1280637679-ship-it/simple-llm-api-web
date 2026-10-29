export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function reasoningContentMarkup(m) {
  if (!m.reasoningText) return '';
  return `<details class="reasoning-content" data-reasoning-message="${m.id}" ${m.reasoningOpen !== false ? 'open' : ''}>
<summary>模型公开思考${m.incomplete ? ' · 未完成' : ''}</summary>
<div class="reasoning-text">${esc(m.reasoningText)}</div>
</details>`;
}

export function tabsMarkup(page) {
  return `<div class="tabs" role="tablist" aria-label="页面导航">${[['chat', '对话'], ['image', '图片'], ['logs', '日志']].map(([id, label]) => `<button role="tab" aria-selected="${page === id}" class="tab ${page === id ? 'active' : ''}" data-action="tab" data-tab="${id}">${label}</button>`).join('')}</div>`;
}
