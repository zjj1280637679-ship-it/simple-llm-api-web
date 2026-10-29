import { createWorkbench } from './workbench.js';

// The browser host owns one mounted composition for this document's lifetime.
const workbench = createWorkbench();
try { await workbench.ready; }
catch {
  workbench.dispose();
  document.getElementById('app').textContent = '页面初始化失败；请刷新重试。已有本机存档不会因此主动删除。';
}
