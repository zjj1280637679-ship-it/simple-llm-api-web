# 当前验证范围

项目 **v0.8.0**；2026-11-15（北京时间）。原项目保留文本、图片与存档兼容，新增自建视频工作区。审查基线 `04c6787fe4f944d3b6273767b4043a8bca2fc32c`。

| 验证 | 结果与范围 |
| --- | --- |
| 完整前端回归 | 517 项：516 通过、1 跳过、0 失败；Node 24.22.2；[原始输出](development/evidence/review-tests.txt) |
| 视频模块 | 23 项传输与 34 项工作区测试；未知提交、取消竞态、实例绑定、凭据撤销、上传前存档、错误 ID 恢复、在途与缓存预算 |
| 语法 / 构建 | 通过；54 个白名单产物，相对模块与样式使用统一内容指纹；重复构建一致性通过 |
| 最简宿主 | 38 个本地宿主通过；源、契约、宿主及传递导入有指纹 |
| 有限模型 | 原有 6 个模型通过；范围见 [模型说明](development/models/README.md)，未把视频异步系统冒充完整有限模型 |
| 浏览器 | 混合上传、多任务排队、指定取消、运行中取消、阶段查询、MP4预览和保存、刷新恢复、原页面草稿及手机布局通过；[具体条件与观察](docs/reviews/2026-11-15-video-browser.md) |
| 配套 API | CORS窄修复，584 项 CPU 回归通过、8 项跳过、1 条既有 Starlette 弃用警告；当前笔记原位更新、读回字节一致，原 console 布局保持 |
| 证据对应 | `npm run review:evidence` MATCH，220 个输入；[执行记录](development/evidence/review.json)；检查指纹对应，不独立证明记录真实性 |
| 资料与知识图 | 既有来源一致性检查通过；新图绑定具体已提交项目基线，保留历史图；[当前入口](knowledge/README.md) |

前端唯一跳过项是未安装可选 MCP SDK 的合成 peer 互操作测试，不计通过。本轮没有真实付费模型调用，也没有分配云 GPU。浏览器连接实际 API 路由与模拟管理器，下载对象是新建 FFmpeg 测试图；不是本轮 A100 视频生成。此前 A100 原生 BF16 验收只属于当时后端版本，不能替代当前网页真实 GPU 验收。

文本、图片的既有行为由完整合成回归覆盖，浏览器额外检查了切页与草稿保留；不宣称重新实测所有供应商。本轮独立审查复现并修复三项：未回执时刷新丢失身份、缓存外并行下载突破载荷预算、错误恢复 ID 解除未知提交防重。38 块完整 F/C/H/Q 仍为 UNKNOWN，有限样例与一次浏览器成功均不构成全称证明。

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

PR/main 均执行这些检查；main 仅发布 dist。配套服务的实际GPU生成另需连接当前可用实例；本轮不消耗GPU预算。[视频使用说明](docs/VIDEO_API.md) · [v0.8.0 更新](docs/releases/v0.8.0.md)

## 历史范围

- [v0.7.0 验证](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/04c6787fe4f944d3b6273767b4043a8bca2fc32c/VALIDATION.md)：457 项中456通过、1跳过，36个宿主；图片适配实网记录保留其当时版本和条件。
- [v0.5.0 验证](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/84152a50cf15b4ae1bad82674dbe2129f3b9587d/development/evidence/review.json)：424 项中423通过、1跳过，31个宿主。
- [v0.4.0 验证](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/84152a50cf15b4ae1bad82674dbe2129f3b9587d/VALIDATION.md)：409 项中408通过、1跳过，26个宿主。

历史观察不因文档更新延续为当前版本实测。
