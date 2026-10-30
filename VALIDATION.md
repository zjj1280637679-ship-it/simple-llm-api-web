# 当前验证范围

项目 v0.4.0；2026-10-30（北京时间）。审查基线 `0105e7f1657b10e5faa224442896c25dcde1b3b4`，交互卡结构修订见 [记录](docs/reviews/2026-10-30-cards.md)，设计依据见 [EPISTEMIC_DESIGN](design/EPISTEMIC_DESIGN.md)。

| 验证 | 当前结果与范围 |
| --- | --- |
| 完整回归 | 409 项：408 通过、1 跳过、0 失败；Node 24.22.1；[原始输出](development/evidence/review-tests.txt) |
| 语法 / 构建 | 生产、宿主、有限模型、脚本及 CLI 通过；42 个白名单产物；相对依赖与重复构建一致性通过 |
| 最简宿主 | 26 个分别通过；源、契约、宿主及字面传递导入有指纹 |
| 有限模型 | 结束解释/接纳 680 类组合；图片效果 820 个列表组合及伪造回执；卡片位置 1,555 条历史 / 7,465 查询；[条件与未证明义务](development/models/README.md) |
| 证据对应 | 174 个输入与命令输出的指纹 MATCH；[记录](development/evidence/review.json)；不独立鉴定记录真实性 |
| 资料复核 | 保留旧来源、时间、缺失快照与实测；本轮未重新验证上游模型能力 |
| 知识图 | 冻结到本轮具体源提交，另有结构/漂移检测宿主；当前入口见 [knowledge](knowledge/README.md) |

唯一跳过项是可选 MCP SDK 对合成 peer 的互操作测试，未安装 SDK，不计通过。没有真实密钥或付费模型请求。完整形式证明、抽象对应、真实宿主条件、成功替代途径池和阶段投影等效性并未由上述测试完成；26 块完整 F/C/H/Q 保持 UNKNOWN。

本轮新增回归检查历史末项、旧卡事件、异步晚到、一次性确认、取消、未知卡版本和 schema 1→2 迁移。已有判断回归继续检查：未来结束标记与明确截断的不同解释、缺 JSON 标记的兼容接纳与 SSE framing、空图片集合不全绿、工作区回执不能升级持久化/可见/目标，以及真实工作台组合在正常返回时继续传递 unknown。

```sh
npm run check
npm test
npm run hosts
npm run models
npm run build
npm run review:health
npm run review:sources
npm run review:evidence
node knowledge/check.mjs
node knowledge/verify.mjs
```

PR/main 均执行以上本地检查；main 仅发布 dist。有限模型不会发网络请求。部署成功和实际浏览器观察另行记录于本轮知识快照；不能从本地通过推断浏览器或上游调用已通过。

## 实网验收优先级

[逐路径实网验收表](docs/LIVE_ACCEPTANCE.md)将四协议文本流式列为当前最高优先级；本地回归、生产部署与实网通过分别记录。WebMCP / 网页 CLI / MCP 传输明确为 [实验性](docs/EXPERIMENTAL.md)。v0.4.0 的确认卡取消与页面注册观察不覆盖完整外部工具调用返回链路。

新增验收辅助脚本位于 `qa/`，独立离线检查结果见 [本轮记录](docs/reviews/2026-10-30-entry-acceptance.md)。上表 409 项是原生产输入集的历史回归结果，不包含该辅助脚本，也不因文档更新而改写原始执行时间。

## 历史范围

[v0.2.0 验证入口](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/70290ba6f00b9035f94ecde7ac95849b5ea190a5/VALIDATION.md)记录 377 通过、1 跳过及 14 宿主；[当时浏览器观察](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/70290ba6f00b9035f94ecde7ac95849b5ea190a5/docs/reviews/2026-10-30-browser.md)的构建身份不覆盖本轮。更早的 Ark 图片真实报告及旧 PR 候选均保留其原条件，没有通过改写日期延续到当前版本。

[v0.3.0 验证](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/0105e7f1657b10e5faa224442896c25dcde1b3b4/VALIDATION.md)记录当时的 391 通过、1 跳过和 21 宿主。
