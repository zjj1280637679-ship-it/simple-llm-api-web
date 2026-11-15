# v0.9.0-54bb3b6aead2 · MiniMax H3 中转站独立入口

知识版本 **1.8.3**，项目源提交 [54bb3b6aead2](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/commit/54bb3b6aead2e00055e59cc9330ad0e2c734f5dc)；前一版[H3 队列知识快照](../v0.9.0-68eac3c85efb/README.md)继续保留。

## 程序范围

新增 h3-relay/index.html。与 h3-queue 控制台共享 /api/v1/* API、上传、任务控制与页面样式，只通过静态 profile 隔离保存的 URL 与任务 ID。API Key 仅保存在各页面内存中；中转站 URL 需使用者填写，旧 /v1/jobs 视频页面不变。

生产构建增加新入口，并为共享 JS/CSS 加构建版本参数。单独运行过原队列 8 项 API 单测和新页 2 项静态结构/路径测试，合计 10 项通过。

## 证据边界

本图覆盖 311 项目文件、489 节点、1417 条关系，源 Git tree 1f7ecf5a4b72893ebe72ffb50498c1f661278e89。

development/evidence/review.json 已按本次变更刷新输入哈希，但其历史 533/534 测试计数和七个输出仍属于旧 reviewedBase；当前完整测试/构建由 GitHub Actions 重新执行和记录。没有完成真实中转站 CORS、GPU 生成或 MP4 下载验收。

[H3 协议与使用说明](../../../docs/H3_QUEUE.md)。
