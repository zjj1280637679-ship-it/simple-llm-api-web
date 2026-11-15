# v0.9.0-fb2495807347 · DeepSeek 搜索函数工具

项目源提交 [fb2495807347](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/commit/fb249580734792a4628a541ab649a7bf895fe54c)，知识版本 **1.9.0**；前一版 [千问官方模板快照](../v0.9.0-5a0d7da300f5/README.md) 保留历史内容。

## 本次生产变更

「对话 → 模型设置 → 更多参数」新增联网搜索设置。搜索服务来源默认选择 DeepSeek 官方，开关默认关闭，启用后当前文本模型可按需要通过函数调用 web_search 发送查询给固定的 https://api.deepseek.com/v1/tools/search。Gemini、OpenAI 兼容、Ark 的函数调用沿用已有工具链；Anthropic 工具协议本次未适配。

独立搜索 Key 保存在工作区内存 WeakMap，不进入模型卡片、对话持久存储、草稿保护或日志；主模型为官方 DeepSeek 时在没有单独搜索 Key 的情况下可复用它的普通 API Key。搜索词由模型生成，发送到 DeepSeek，单次最多返回五条有限摘要；搜索不自动重试，共享每轮四次工具预算。搜索结果视为不可信外部内容。

新增 src/web-search.js 和 tests/web-search.test.js，更新 agent、workbench、模型设置、两类本机快照白名单及生产构建白名单。对外参考 https://api-docs.deepseek.com/guides/search/；Search API 的成功请求可能单独计费。

## 验证边界

该快照仅固定 314 个项目文件、494 个知识节点、1442 条关系的源码身份。新增的搜索接口测试与模拟 Agent/UI 验收不代表真实 CORS、用户密钥权限、云端搜索质量、模型实际触发次数或账单已验证；本轮完整测试和 Pages 发布需要以 GitHub Actions 的当前运行记录为准。development/evidence/review.json 的历史运行日志/统计不改写为当前证据。

验证入口：node knowledge/check.mjs、node knowledge/verify.mjs、npm test、npm run build。
