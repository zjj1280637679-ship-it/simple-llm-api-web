# v0.9.0 文本、图片与可控 BF16 视频快照

知识版本 1.8.0；2026-11-14T22:26:29.660Z。源提交 `5d16d1ee174a63739be16aea4d6d41b056c57a10`，树 `e1954a223848484d925a609c1c0429acd2d06b69`。303 个项目文件、38 个模块/宿主、479 节点、1402 条关系；项目文件与该源树逐字节匹配，历史快照保留。

入口：[视频使用与边界](../../../docs/VIDEO_API.md)、[版本说明](../../../docs/releases/v0.9.0.md)、[最终本地记录](../../../development/evidence/review.json)。先运行 `node knowledge/check.mjs`，再用 `route video`、`show flow:video`、`impact src/video-api.js` 导航。原有 conversation/image/gemini/history 路由保留。

视频页拥有连接、参考文件、能力与任务观察及浏览器资源；服务端拥有持久队列和 GPU 调度。能力 supported/configured 决定选项是否允许请求，ready 描述运行状态；已配置但下载中的 LoRA 可以排队。每任务显式提交 attention_backend、acceleration_lora 和 steps，requested 与 effective 分别显示。Turbo 使用 5 个调度点、4 次实际模型评估，步数由用户显式设定。上传后根据真实回执进入队列，模型尚未准备完成时可以等待。查询、取消、下载分别观察；未知提交不自动重试，任务绑定原 API 与实例。下载经有界 Range 传输和 SHA-256 校验再交给 Blob 预览/保存。

密钥和参考文件留在页面内存；仅保存任务恢复身份。工作台释放会清理轮询、请求和 Blob URL，不把关闭页面解释成远端任务或云 GPU 已释放。旧文本/图片流程及存档继续由其原模块负责。

最终记录时间为 2026-11-14T22:26:13.632Z，测试计数按原记录为 {"tests":534,"pass":533,"fail":0,"cancelled":0,"skipped":1,"todo":0}；38 个本地宿主及已有有限模型结果按提交中的输出登记。来源及输入指纹均在图内。浏览器记录单独引用 [原始报告](../../../docs/reviews/2026-11-15-bf16-browser.md)。浏览器、公网、A100 BF16 生成、产物及资源释放的观察仅按所引用报告的原文与边界解释；未提供报告时，这些观察保持未知。helper 不自动断言 GPU 已运行或未运行，知识生成时间不是重新测试时间。
