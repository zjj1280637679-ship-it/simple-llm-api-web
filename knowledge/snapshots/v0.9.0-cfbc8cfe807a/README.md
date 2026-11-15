# v0.9.0-cfbc8cfe807a · DeepSeek 搜索工具测试修正

源提交 [cfbc8cfe807a](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/commit/cfbc8cfe807a754cc71775ca2dddc0d43f4cabce)；知识版本 **1.9.1**。前一版 [DeepSeek 搜索工具](../v0.9.0-fb2495807347/README.md) 的程序设计与已执行的测试记录仍保持。

## 本轮修复

同步 `tests/app-controls.test.js` 的两项夹具：不再把无返回值的设置操作误认为含 `ok` 的操作；模拟官方 DeepSeek 主连接前先冻结旧 API 卡，防止测试 DOM 旧字段覆盖人工设置的 Key。这些是测试环境约束，不是改变搜索工具运行算法。

新快照覆盖 314 项文件、494 节点、1442 条关系；输入哈希对应源 Git tree `3d4ee78461bc236be15401d2136ee64953a0a67e`。完整回归、GitHub Pages 构建与部署以本次 Actions 记录为准。未实测真实 DeepSeek Key、浏览器 CORS、外部网页返回内容或独立计费结果。
