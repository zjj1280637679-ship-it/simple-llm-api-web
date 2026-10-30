# v0.3.0 认识论与开发态结构修订

基线 `25edb6b861de1766cd2b3097241cc79df92e071a`，2026-10-30（北京时间）。本轮使判断责任成为代码结构，并保留已有产品路径和显式证据范围。

| 原位置的问题 | 当前处理 | 可独立验证的边界 |
| --- | --- | --- |
| core 同时管地址、网络、解释和业务 | api-target、request-transport、app-error 独立；core 保留协议 facade 并兼容重导出 | 原目标绑定、凭据观察、取消、脱敏和无自动重试回归 |
| JSON 与 SSE 各写结束规则 | completion-evidence 统一解释；completion-policy 单独表达入口策略 | 未知标记和明确不完整区分；JSON 缺字段兼容与 SSE framing 分别判断 |
| 图片回执内联在两个消费者 | image-evidence 负责纯效果投影，image-delivery 负责真实解码资源 | 空集合不全绿、尺寸偏差不删除文件、不由工作区存入推导持久化 |
| 页面 completed 被消费者过度理解的风险 | 保留兼容字段，增加 request-outcome 的独立结果坐标 | complete/unknown 与 returned、goalSatisfied 不互相替代 |
| 契约多处仍为 declared-effect | 21 块均明确课题、具体目标、状态范围、反例、扩展点及证明义务 | 字段完整性可检查；充分性与全域准入仍需独立论证 |
| 形式化没有可执行的局部入口 | 加入真实纯函数的 680/820 组合有限检查及 CI 命令 | 明确抽象/实现/宿主信任缺口，不声称完整证明 |
| 目录导言版本口径旧 | 按当前 catalog 重写导言，保留旧报告在固定提交 | 模块版本与宿主版本分别读取 |

默认网页交互没有增加批准步骤；没有真实密钥、付费调用或新模型能力验收。外部原生响应的未知状态仍按声明兼容策略处理，没有被自动改成失败或“任务成功”。

当前 core 的协议体编码、agent 的工具循环及 workbench 的配置/渲染仍是后续进一步分解的候选；它们没有因为依赖变少就自动满足完整形式证明。新结构的价值由可分开变更的判断责任与反例支持，而非文件数量。

本轮完整结果见 [v0.3.0 VALIDATION.md](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/0105e7f1657b10e5faa224442896c25dcde1b3b4/VALIDATION.md)，输入与命令输出身份见 [v0.3.0 review.json](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/0105e7f1657b10e5faa224442896c25dcde1b3b4/development/evidence/review.json)。知识图随后绑定本轮具体源提交生成，不覆盖或改写旧快照。
