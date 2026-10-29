# R-003 — 有序模拟请求生命周期

版本 `0.1.0`；独立版本和创建/更新时间见 `catalog.json`（UTC）。唯一实现 `index.js`；旧 shared/core.js 的 createSimulatorCore 为同一函数兼容转发，Gemini/Ark 公共接口不变。

## 目标、依赖及接口

关系：把 F-004@0.1.0 的 fixture 参数绑定/精确匹配，Fetch 请求归一化，接纳队列和受控响应交付联接成封闭有序脚本。只依赖 F-004 与 JS Fetch/Abort/Stream 原语；不依赖生产 src、供应商实现、文件系统或真实 fetch。

`createSimulatorCore({fixture,revision,parameters={},clock=()=>0,scheduler})` 返回 `{fetch,inspect,assertComplete,dispose}`。fixture/revision 在创建时防御性拷贝；fixture 为可信非空 JSON 脚本，引用参数必须在 fixture 声明。`fetch(input,init)` 接受 URL 或 Request；body 仅 JSON string（Request 的 clone 可读取），Headers 归一化后交给 F-004 精确匹配。无未知路由回退、无真实网络。

## 状态、共享责任与副作用

每个实例独占 consumed/entered/pending/active、事件/错误列表、admission Promise、cleanup 集合和 disposal AbortController。模块级无可变状态。inspect 返回防御性副本；revision 仅记录调用者提供的标识，模块不验证其来源真实性。clock/scheduler 是调用者持有的外部能力：clock 应同步、只读且不抛出；scheduler 应为异步 setTimeout/clearTimeout 语义，允许多个实例共用但其 timer ID 应独立。同步执行 setTimeout callback 的 scheduler 不在支持条件中。

fetch 会在提供的 scheduler 登记/清理 timer，监听/移除 signal，创建 Response 并写入本实例日志；对 Request 只读取 clone，流读取取消通过 cancel 克隆分支且不等待 tee sibling。调用者控制原 Request 流，不能据此保证原始流已关闭。无磁盘、全局 fetch 改写或密钥读取。

接纳按 fetch 调用次序串行，包括异步 Request body 读取；仅接纳串行，延迟响应可独立完成。匹配后消耗一步；匹配失败不消耗并锁存脱敏错误，后续成功不能洗掉 failed。未知/额外步骤也是错误。assertComplete 要求无锁存失败、所有步骤消耗、无 active/pending；不是每个已消耗请求都成功响应的声明（取消的匹配请求仍算已消耗）。

## 取消、错误和终止

请求在排队/归一化/交付期收到 abort 都拒绝原 signal.reason；未匹配请求不消耗。dispose 幂等关闭本实例并唤醒排队、读取和挂起交付；未来请求拒绝 SIMULATOR_DISPOSED。交付清理 pending/timer/listener，另一个实例不受影响。

fixture reject 为受控 TypeError；延迟/hang 需要 scheduler，否则 SIMULATOR_CONFIGURATION。错配/配置错误写入本实例锁存失败，差异只记录安全字段名，不记录 prompt/credentials/URL 值。挂起 fixture 在无 abort/dispose 时刻意不终止；不设置隐藏的真实时间超时。

## 最低效果与证据

H-R-003 直接导入本模块，观察匹配顺序、第二响应完成时第一响应仍 pending、取消清理与独立挂起实例处置。必需测试 `tests/shared-simulator-session.test.js` 补充错误锁存、输入/日志隔离、排队取消与 Request 流释放；原 Gemini/Ark 17+17 场景在既有测试中回归。模块卡以 schema 5 文件级归属绑定独立和共享测试，不声称每条测试专属一个模块。

全部仅 LOCAL/SIMULATED 样本；无外部 API、恶意 JS fixture 隔离或所有调度的形式证明，F/C/H/Q 保持 UNKNOWN。
