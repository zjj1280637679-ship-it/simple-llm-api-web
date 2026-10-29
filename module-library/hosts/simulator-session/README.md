# H-R-003 — 有序模拟请求生命周期宿主

目标：直接调用 R-003，把 F-004 的精确匹配与异步接纳、响应交付、abort/dispose 关系连成可观察的闭合实验。运行 `node module-library/hosts/simulator-session/run.mjs` 或 `npm run modules:host -- R-003`。

只提供两步 inline 请求脚本、手动 scheduler、AbortController 和断言；不导入生产请求构造器或供应商资源。第二响应必须在第一响应仍 pending 时可得，但匹配顺序为 1、2；取消第一请求后 pending/timer 为 0。另一个挂起实例被 dispose，必须立即拒绝且不影响已完成实例。最小环境不含 UI、API key 或真实网络。版本/UTC 时间见 hosts/catalog.json。

报告 SIMULATED，局部验证的是受控脚本关系而非外部 API 可用或所有并发调度。完整 Node 请求流/异常回归见模块卡 tests。
