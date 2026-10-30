/** 历史页的纯展示投影。会话记录与通讯记录分开；查询/删除/下载由宿主执行。 */
import {esc} from './view-markup.js';
import {conversationTitle} from './conversation-book.js';
export function historyMarkup({entries,activeId,query='',notice=''}) {
  return `<section class="history-page"><div class="history-heading"><h1>历史</h1><button class="chip" data-action="conversation-new">新建会话</button></div>
<label class="history-search">查找会话<input id="history-query" type="search" value="${esc(query)}" placeholder="标题或内容"></label>
<p class="history-notice" role="status">${esc(notice)}</p>
<div class="history-list">${entries.length?entries.map(entry=>`<article class="history-row ${entry.id===activeId?'current':''}">
<button class="history-open" data-action="conversation-open" data-conversation="${esc(entry.id)}" ${entry.id===activeId?'aria-current="true"':''}><strong>${esc(conversationTitle(entry))}</strong><span>${esc(entry.updatedAt.startsWith('1970-01-01')?'旧存档':new Date(entry.updatedAt).toLocaleString('zh-CN'))}${Object.values(entry.data).some(d=>d.busy)?' · 请求进行中':''}${entry.id===activeId?' · 当前':''}</span></button>
<details class="history-row-menu"><summary aria-label="会话操作">···</summary><div><button data-action="conversation-rename" data-conversation="${esc(entry.id)}">重命名</button><button data-action="conversation-export" data-conversation="${esc(entry.id)}">导出</button><button data-action="conversation-delete" data-conversation="${esc(entry.id)}">删除</button></div></details></article>`).join(''):'<p class="empty-history">没有匹配的会话</p>'}</div>
<details class="history-tools"><summary>更多工具</summary><div class="history-tool-grid">
<button class="chip" data-action="local-storage">导入与导出</button><button class="chip" data-action="history-logs">通讯记录</button><button class="chip" data-action="history-storage">本地存储</button>
</div></details></section>`;
}
