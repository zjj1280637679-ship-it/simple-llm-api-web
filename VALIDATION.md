# 当前验证范围

项目 **v0.9.0**；2026-11-15（北京时间）。保留文本、图片、视频及存档兼容，新增逐任务原生 BF16 注意力后端、加速 LoRA、步数控制与请求/实际配置回执。源修改基线为 v0.8.0 发布提交 `84cf1edb3bb5cce4357085190714e019a536f1b4`。

**已完成新版宿主一键冷启动、公网先行上线、下载期排队与取消、三个全新场景生成和下载、服务清理及 Colab VM 释放。** [真实浏览器验收](docs/reviews/2026-11-15-bf16-browser.md)分别记录已观察事实、失败修复与剩余范围。

| 验证 | 结果与范围 |
| --- | --- |
| 完整前端回归 | 534 项：533 通过、1 跳过、0 失败；Node 24.22.2；2026-11-14T21:43:40.977Z 最终本地记录 |
| 视频模块 | 26 项传输、47 项工作区测试；能力与实例绑定、显式 Turbo 步数、上传配置快照、未知提交、取消竞态、恢复、媒体预算与异常配置回执 |
| 语法 / 构建 | 通过；54 个白名单产物，模块与样式使用内容指纹 |
| 最简宿主 | 38 个本地宿主通过；仅支持各宿主声明范围 |
| 有限模型 | 6 个既有模型通过；[模型说明](development/models/README.md)，未将视频异步系统宣称为完整有限模型 |
| 公网网页 / GPU | A100-SXM4-80GB 原生 BF16；图片+视频与纯图片的 Flash/Turbo 5 步、图片+音频的 auto→native/none 8 步，三个全新场景真实生成成功 |
| 排队 / 取消 / 恢复 | 最终下载期两个任务均 queued/waiting_for=model_ready；指定取消未就绪队列任务，保留任务自动生成。含任务 ID 的 503 以原 ID 对账、刷新恢复均无自动重提 |
| 预览 / 下载 | 三个实际生成 MP4 均 readyState=4、无媒体错误；字节数与 SHA-256 匹配、完整音视频解码通过 |
| 服务清理 | 首轮与最终实例均有完整回执；最终 06:20:29 API/模型/隧道/manager 全部退出，cleanup_complete/shutdown_complete=true，GPU 0 MiB、无计算进程、无 kernel 子进程 |
| 配套后端 / 笔记本 CPU | 完整范围 659 通过、8 跳过、1 条既有警告；后续 API 生命周期 106 通过、宿主竞态 53 通过与 Node 2 通过，按各自运行范围记录，不累加 |
| 最终宿主与云 VM | 06:03 一键冷启、06:05 公网 API 先行、06:19:23 第三场景成功；06:21:24 请求释放、06:22 会话管理明确无活动会话；原笔记恢复单启动单元且读回一致 |
| 最终证据 / 知识快照 | 发布前按最终文档与源码重新生成；旧指纹或旧知识快照不自动覆盖本版改动 |

唯一跳过项是未安装可选 MCP SDK 的合成 peer 互操作测试，不计通过。本轮真实视频来源于当前 A100 模型执行；完整前端回归和宿主仍使用合成条件。文本、图片的既有行为由当前回归覆盖，不宣称重新实测所有供应商或所有浏览器。

本地最终命令原始输出位于交付工作区 `work/video-web-v090-final-tests.txt`、`-check.txt`、`-hosts.json`、`-models.json`、`-build.txt`；摘要 `work/video-web-v090-final-summary.json` 保存结果和具体源文件 SHA-256。发布证据生成后，[正式执行记录](development/evidence/review.json)应以其中版本和输入指纹为准；若仍指向旧版本，不能当作 v0.9.0 的 MATCH。

后端 659 项通过的来源为 `work/backend-cpu-validation-20261115.txt`，明确标为已完成工具输出的末段摘录，不是重跑或完整 stdout；后续针对性记录为 `work/backend-api-lifecycle-regression-20261115.txt`、`work/backend-warm-delivery-regression-20261115.txt`。最终宿主复测曾遇界面空白与 Colab 环境重建；本地竞态修复不能证明重建原因。之后新实例已完成一键冷启至平台释放的完整验收，记录保留此前故障。

本轮初始任务因 Colab 可选 torchao 0.10.0 与 PEFT 0.21.2 不兼容而在加载期失败；移除该不使用的可选包并验证原栈不变后成功恢复。API 任务实例回执和网页时效文案也在实测中修正。全部真实任务为 3 成功、2 取消、1 个早期依赖失败；最终提交还出现过含任务 ID 的 503 并成功对账，不能宣称零故障。`pipeline` 观察为首个 Turbo 约 583 秒、后续不同输入的普通任务约 201 秒、最终新实例 Turbo 约 358 秒；输入和冷热条件不相同，**没有得出加速倍数或质量优越性结论**。

38 块完整 F/C/H/Q 仍为 UNKNOWN。有限样例与一次实际生成均不构成全称证明。每份任务 cleanup_complete、服务进程退出和云平台 VM 释放分别观察，不能相互替代。

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

PR/main 执行项目检查，main 发布 dist。[视频使用说明](docs/VIDEO_API.md) · [v0.9.0 更新](docs/releases/v0.9.0.md)

## 历史范围

- [v0.8.0 浏览器验收](docs/reviews/2026-11-15-video-browser.md)：本机实际 API 路由与模拟管理器、合成 MP4；没有分配 GPU。该版 518 项测试中 517 通过、1 跳过，38 宿主；手机布局与原页面草稿观察保留当时范围。[固定版本验证](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/84cf1edb3bb5cce4357085190714e019a536f1b4/VALIDATION.md)。
- [v0.7.0 验证](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/04c6787fe4f944d3b6273767b4043a8bca2fc32c/VALIDATION.md)：457 项中 456 通过、1 跳过，36 宿主；图片适配实网记录保留当时条件。
- [v0.5.0 验证](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/84152a50cf15b4ae1bad82674dbe2129f3b9587d/development/evidence/review.json)：424 项中 423 通过、1 跳过，31 宿主。
- [v0.4.0 验证](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/blob/84152a50cf15b4ae1bad82674dbe2129f3b9587d/VALIDATION.md)：409 项中 408 通过、1 跳过，26 宿主。

历史观察不因文档更新延续为当前版本实测。
