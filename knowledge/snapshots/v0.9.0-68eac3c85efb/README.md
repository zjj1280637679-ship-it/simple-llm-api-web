# v0.9.0-68eac3c85efb · H3 队列控制台与证据账本更新

当前知识版本 **1.8.2**。参考源提交 [68eac3c85efb](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/commit/68eac3c85efbe0e132f83a4090aeca08f651f2b6)，保留上一版 [队列源码快照](../v0.9.0-57c2909275ff/README.md) 和原始 [v0.9.0](../v0.9.0-5d16d1ee174a/README.md) 记录。

## 程序范围

H3 `/api/v1/tasks` 工作台独立实现于 `h3-queue/{index.html,app.js,api.js,style.css}`；旧 `/v1/jobs` BF16 工作台保留。6 个新增文件、4 个原有源码文件修改。新协议使用数字任务 ID 和 `X-API-Key`，包含参考素材上传、单条/批量排队、进度和 MP4、任务/队列操作。

## 证据边界修复

`development/evidence/review.json` 的输入哈希现已对应本次 H3 网页与新增 API 测试；其中记录的早期七组命令输出、旧 533/534 通过等统计仍明确属于 `reviewedBase` 的历史版本，**不是**本次源提交重新运行的凭证。此次变更后由 GitHub Actions 重新执行的测试另以该工作流自身日志为准，不借旧账本冒充新验证。

知识图覆盖 309 个项目文件、486 节点和 1411 条关系，时间 2026-11-15T08:03:06.039Z。对新网页已本地完成 8 项传输单测和模拟浏览器 1440px / 390px 两种尺寸点测。真实 GPU、隧道 CORS、生成视频、云资源释放尚未重新验证。

使用详情：[H3 队列协议](../../../docs/H3_QUEUE.md)。验证入口：`node knowledge/check.mjs`、`node knowledge/verify.mjs`、`npm run review:evidence`、`npm test`、`npm run build`。
