# 当前验证范围

项目 v0.6.2；2026-11-04（北京时间）。审查基线 `df4f04b1685d7de09572f904f4c6f32c5ff66d10`。本轮目标、反例和实现见 [Gemini 适配记录](docs/reviews/2026-11-04-gemini-adaptation.md)，理想效果谓词见 [GEMINI_ADAPTATION](design/GEMINI_ADAPTATION.md)。

| 验证 | 本轮结果与范围 |
| --- | --- |
| 完整回归 | 446 项：445 通过、1 跳过、0 失败；Node 24.22.1；[原始输出](development/evidence/review-tests.txt) |
| 语法 / 构建 | 生产、宿主、有限模型、脚本及 CLI 通过；51 个白名单产物；相对依赖与重复构建一致性通过 |
| 最简宿主 | 35 个分别通过；源、契约、宿主及字面传递导入有指纹 |
| 有限模型 | 5 个模型；本轮新增 324 个 Gemini 能力/参数组合；已有 80 次历史解释比较、2,916 次图片参数组合转移、 680 类结束组合、820 个图片效果列表组合、1,555 条历史 / 7,465 查询；[范围与未证明义务](development/models/README.md) |
| 证据对应 | 输入及命令输出的指纹由 `npm run review:evidence` 检查；[执行记录](development/evidence/review.json)；不独立鉴定记录真实性 |
| 资料复核 | 本轮核对 Google 官方 GenerateContent / Model / thinking 资料并记录日期与链接；没有真实密钥调用或全文快照 |
| 知识图 | 冻结到具体项目源提交；另有结构/漂移检测宿主；[当前入口](knowledge/README.md) |

唯一跳过项是可选 MCP SDK 对合成 peer 的互操作测试，未安装 SDK，不计通过。没有真实密钥或付费模型请求。完整形式证明、抽象对应、全部真实宿主条件、成功替代途径池和阶段投影等效性仍有独立义务；35 块完整 F/C/H/Q 保持 UNKNOWN。

新增回归覆盖三值能力、模型回执绑定/撤销、采样与思考收缩、默认省略、false/0、停止序列与数值校验、思考字段合并、跨协议隔离、模型方法筛选、未知模型手选格式、历史与持久化保真。先前交互回归保留。合成传输/DOM 不代替真实 API 与浏览器。

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

PR/main 均执行以上本地检查；main 仅发布 dist。有限模型不会发网络请求。部署和实际浏览器观察另记于本轮知识快照，不从本地通过推断浏览器、输入法或上游调用已通过。

## 实网验收优先级

[逐路径实网验收表](docs/LIVE_ACCEPTANCE.md)将四协议文本流式列为当前最高优先级；本地回归、生产部署与实网通过分别记录。WebMCP / 网页 CLI / MCP 传输明确为 [实验性](docs/EXPERIMENTAL.md)。`qa/` 验收辅助脚本的离线自检见 [记录](docs/reviews/2026-10-30-entry-acceptance.md)，不代替真实供应商闭环。

## 历史范围

- [v0.5.0 验证](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/84152a50cf15b4ae1bad82674dbe2129f3b9587d/development/evidence/review.json)：424 项中 423 通过、1 跳过，31 个宿主。
- [v0.4.0 验证](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/84152a50cf15b4ae1bad82674dbe2129f3b9587d/VALIDATION.md)：409 项中 408 通过、1 跳过，26 个宿主。
- [v0.3.0 验证](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/0105e7f1657b10e5faa224442896c25dcde1b3b4/VALIDATION.md)：391 通过、1 跳过，21 个宿主。
- [v0.2.0 验证](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/70290ba6f00b9035f94ecde7ac95849b5ea190a5/VALIDATION.md)：377 通过、1 跳过，14 个宿主。

历史浏览器和 Ark 图片真实报告保留当时条件与构建身份，不因文档更新延续为当前版本实测。
