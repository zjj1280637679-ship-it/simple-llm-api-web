# 当前验证范围

项目 v0.3.0；2026-10-30（北京时间）。审查基线 `25edb6b861de1766cd2b3097241cc79df92e071a`，认识论结构修订见 [记录](docs/reviews/2026-10-30-epistemic.md)，设计依据见 [EPISTEMIC_DESIGN](design/EPISTEMIC_DESIGN.md)。

| 验证 | 当前结果与范围 |
| --- | --- |
| 完整回归 | 392 项：391 通过、1 跳过、0 失败；Node 24.22.1；[原始输出](development/evidence/review-tests.txt) |
| 语法 / 构建 | 生产、宿主、有限模型、脚本及 CLI 通过；37 个白名单产物；相对依赖与重复构建一致性通过 |
| 最简宿主 | 21 个分别通过；源、契约、宿主及字面传递导入有指纹 |
| 有限模型 | 结束解释/接纳 680 类组合；图片效果 820 个列表组合及伪造回执；[条件与未证明义务](development/models/README.md) |
| 证据对应 | 154 个输入与命令输出的指纹 MATCH；[记录](development/evidence/review.json)；不独立鉴定记录真实性 |
| 资料复核 | 保留旧来源、时间、缺失快照与实测；本轮未重新验证上游模型能力 |
| 知识图 | 冻结到本轮具体源提交，另有结构/漂移检测宿主；当前入口见 [knowledge](knowledge/README.md) |

唯一跳过项是可选 MCP SDK 对合成 peer 的互操作测试，未安装 SDK，不计通过。没有真实密钥或付费模型请求。完整形式证明、抽象对应、真实宿主条件、成功替代途径池和阶段投影等效性并未由上述测试完成；21 块完整 F/C/H/Q 保持 UNKNOWN。

新增回归同时检查：未来结束标记与明确截断的不同解释、缺 JSON 标记的兼容接纳与 SSE framing、空图片集合不全绿、工作区回执不能升级持久化/可见/目标，以及真实工作台组合在正常返回时继续传递 unknown。

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

## 历史范围

[v0.2.0 验证入口](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/70290ba6f00b9035f94ecde7ac95849b5ea190a5/VALIDATION.md)记录 377 通过、1 跳过及 14 宿主；[当时浏览器观察](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/70290ba6f00b9035f94ecde7ac95849b5ea190a5/docs/reviews/2026-10-30-browser.md)的构建身份不覆盖本轮。更早的 Ark 图片真实报告及旧 PR 候选均保留其原条件，没有通过改写日期延续到当前版本。
