# v0.9.0-4c9cf5250ee6 · 千问官方文本 API 预设

知识版本 **1.8.4**。项目源提交 [4c9cf5250ee6](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/commit/4c9cf5250ee6f672a52a6c2134dd28321e66dea3)，保留[上一版 H3 中转站快照](../v0.9.0-54bb3b6aead2/README.md)与所有原始验证记录。

## 本次变更

文本对话的 API 供应商菜单新增「千问 · 百炼官方（北京）」与「千问 · 百炼官方（新加坡）」。两者分别使用 dashscope.aliyuncs.com 或 dashscope-intl.aliyuncs.com 的 /compatible-mode/v1 基础路径，调用共用 OpenAI Chat Completions + Bearer 客户端，不预填任何 Key 或模型。不同地域切换会清理旧 Key、模型和信任状态，同一连接重复选择保留配置。

千问原生模型列表使用 /api/v1/models，不把它误指向当前 OpenAI /models 拉取逻辑，提示手填模型；不声明未经适配的图片生成或专属思考请求参数。原有供应商次序与模型字段行为保留。

## 验证和来源

新增两个地域的合成 Chat / Bearer / 模型列表禁止测试及两地域 UI 切换、凭据隔离测试；实际通过范围应由本版 GitHub Actions 日志确认。此前 development/evidence/review.json 的历史七组命令及 533/534 项统计仍指向其原 reviewedBase，不冒充当前重新运行的成果。

原生接口依据：[百炼 Base URL](https://help.aliyun.com/zh/model-studio/base-url)、[OpenAI 兼容 Chat](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[模型列表](https://help.aliyun.com/zh/model-studio/list-models)。实际 API Key、区域授权、跨域可用、配额、价格与模型生成质量尚未测试。

文件快照 312 个；逻辑节点 491 个；关系 1430 条。源 Git tree `649a044ae1eea3f19d4b3c79c37838f5477bd34d`。
