/** 开发态课题：普通内容如何转义并映射成界面标记？
 * 状态/边界：无持久状态；有限字符串输入，长度由调用宿主约束。
 * 扩展：扩展标记保持动态内容边界，静态结构与业务语义分离。
 * 契约：docs/contracts/view-markup.json；局部宿主不替代完整 F/C/H/Q。
 */
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function reasoningContentMarkup(m) {
  if (!m.reasoningText) return '';
  return `<details class="reasoning-content" data-reasoning-message="${m.id}" ${m.reasoningOpen !== false ? 'open' : ''}>
<summary>模型公开思考${m.incomplete ? ' · 未完成' : ''}</summary>
<div class="reasoning-text">${esc(m.reasoningText)}</div>
</details>`;
}

export function tabsMarkup(page) {
  return `<div class="tabs" role="tablist" aria-label="页面导航">${[['chat', '对话'], ['image', '图片'], ['logs', '历史']].map(([id, label]) => `<button role="tab" aria-selected="${page === id}" class="tab ${page === id ? 'active' : ''}" data-action="tab" data-tab="${id}">${label}</button>`).join('')}</div>`;
}
