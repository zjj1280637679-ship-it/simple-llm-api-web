# v0.9.0-57c2909275ff · MiniMax H3 /api/v1 队列扩展

这是独立于现有 `/v1/jobs` BF16 视频工作台的新增网页。知识图来源是 [源码提交 57c2909275ff](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/commit/57c2909275ffb1337b11787432aa3d738acdbeee)，而非本知识发布覆盖提交；原 [v0.9.0 快照](../v0.9.0-5d16d1ee174a/README.md) 不被覆盖。

## 实现与范围

- 入口 `h3-queue/index.html`，纯浏览器原生 JS。服务地址在网页中输入，`X-API-Key` 在内存里发送，绝不写入 Git、地址查询参数或 localStorage。
- `h3-queue/api.js`：图片/视频/音频 multipart 上传、单条/批量 JSON 入队、队列与任务状态查询、暂停/恢复/清理、置顶/取消/重试/删除、鉴权 MP4 取回。
- `h3-queue/app.js`：按类型独立的参考标签、响应式工作台、队列操作确认、临时媒体缓存与任务恢复。
- 原 `src/video-api.js` 未修改；`src/video-workspace.js` 只增加独立入口提示。构建发布白名单及文件清单测试同步增加。

本快照含 309 项源码文件、486 个节点和 1411 条关系。新增文件 6 项、已有文件修改 4 项，源码身份绑定新提交，原研究与真实 GPU 历史观察不视为此次验收结果。

## 已验证和未验证

- 新 API 适配层：Node 模拟响应离线测试 8/8 通过。模拟浏览器操作：桌面 1440×900 与移动端 390×844 均通过上传、提交、批量、任务和队列操作，未发现横向溢出。
- 未连接真实 H3 GPU 服务；CORS、隧道可达、GPU 计算、真实 MP4 解码、计费和资源释放仍需独立验收。
- 查看 [新的队列协议说明](../../../docs/H3_QUEUE.md) 和 [原 BF16 视频协议](../../../docs/VIDEO_API.md)。运行 `node knowledge/check.mjs`、`node knowledge/verify.mjs` 和 `npm test` 可验证文件身份与本地行为。

此快照只声明可核查的源码与本地模拟验证，不声明全部模块已形式证明或外部性能已测量。
