# 火山方舟普通 API：文本与图片适配参考

核验日期：2026-10-29。本文是官方文档的原创集成摘要，不是完整 API 镜像。接口研究与后续真实验收分开记录：已完成的一次公网 Flash 图片测试见 [VALIDATION.md](../VALIDATION.md)，不代表本文所有模型已验证。模型与价格会变化；上线前重新核验链接。

## 目标、条件、策略、指标

- **目标**：让现有 UI、Agent 与 CLI 共享普通 Ark 文本/图片适配，保留其他 provider。
- **条件**：用户拥有普通 Ark API Key、已开通目标模型；部署端能访问数据面服务。已有一次限定场景浏览器图片成功记录；其他目标/来源的 CORS 仍需分别验证，不能概括为全域支持或禁止。
- **策略**：文本复用 Chat 协议；图片使用独立 provider 分派与模型能力表。默认值是应用选择，不是永久平台限制。未知模型/接入点应允许用户显式配置能力，不能凭名称猜尺寸。
- **指标**：离线请求契约测试、既有 provider 回归、构建通过；真实鉴权/模型权限/CORS/图片质量另列为需用户授权的在线验收，不以 mock 通过替代。

## 地址与凭据

普通数据面 base 为 `https://ark.cn-beijing.volces.com/api/v3`，JSON 请求使用 `Authorization: Bearer <ARK_API_KEY>` 与 `Content-Type: application/json`。文本路径 `/chat/completions`，图片路径 `/images/generations`。

不要混用 Agent Plan 的 `/api/plan/v3`、Plan Key，或管控面域名 `ark.cn-beijing.volcengineapi.com`。API Key 与云 Access Key 不是同一种凭据；不应为了获取模型列表要求浏览器持有更高权限的 Access Key。

来源：[Base URL 与鉴权](https://docs.volcengine.com/docs/ark/base-url-and-authentication?lang=en)、[Plan 对照（不是本适配目标）](https://docs.volcengine.com/docs/ark/agent-plan-personal-visual-models?lang=en)。

## 文本：Chat Completions

`POST /chat/completions` 接收 `model`、`messages`，可按模型能力配置 `temperature`、`top_p`、`stream`、`tools`、`tool_choice`、`response_format`。非流式结果读取 `choices[].message`，工具结果使用 `role: "tool"` 和对应 `tool_call_id` 回传。

函数定义形状是 `{type:"function",function:{name,description,parameters}}`；`parameters` 是 JSON Schema。`tool_choice` 可为 `none/auto/required`，或 `{type:"function",function:{name}}`。响应 `tool_calls[].function.arguments` 是 JSON 字符串：执行前必须解析和校验，不把模型输出当可信指令。`response_format.type` 可为 `text/json_object/json_schema`，实际支持取决于模型。

来源：[Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=en)、[结构化输出](https://docs.volcengine.com/docs/ark/structured-output-beta?lang=en)。

### 输出预算与多轮完整性

- 此普通 Ark Chat 契约将 `max_tokens` 与 `max_completion_tokens` 定义为互斥字段；本适配选用后者，单次请求不同时发送两者。其他入口按对应契约处理。
- 通常前者限定回答，后者限定回答加思考；DeepSeek 等存在模型特例，不做全局语义假设。官方一般字段范围与新模型专属长度表有差异，应按具体模型核验，不硬编码通用 65536 上限。
- 新 Seed 模型可能返回 `encrypted_content`。下一轮保留完整 assistant message（包括此字段、工具调用及推理字段），不要只从 `role/content` 重建历史；不要改写加密内容。
- `thinking`、采样参数与输出上限按模型管理；省略参数不等于关闭思考。

来源：[上下文与预算](https://docs.volcengine.com/docs/ark/context-management?lang=en)、[Agent 模型调用实践](https://docs.volcengine.com/docs/ark/agent-model-invocation-practice?lang=en)、[深度思考](https://docs.volcengine.com/docs/ark/deep-thinking?lang=en)。

## 模型发现

核验时文本候选包括 `doubao-seed-2-1-lite-260915`、`doubao-seed-2-1-pro-260915`（均列有工具调用与结构化输出能力）。图片候选为 `doubao-seedream-5-0-flash-260915`、`doubao-seedream-5-0-pro-260628`。Lite 图片、4.5、4.0 在模型目录标注即将下线；不要误认为所有历史示例都是长期推荐。

未找到普通 Ark Bearer Key 的 OpenAI 式 `GET /models` 官方保证。已确认的基础模型列表是管控面 `ListFoundationModels`，只接受 Access Key 鉴权。应用可以提供带日期的候选值及手动模型 ID 输入；不要把预设列表标为“账号实时可用模型”。

来源：[模型目录](https://docs.volcengine.com/docs/ark/model-list?lang=en)、[ListFoundationModels](https://docs.volcengine.com/docs/ark/list-foundation-models-api?lang=zh)。

## 图片：Seedream

请求形状示意（仅契约示例，不自动执行）：

```json
{
  "model": "doubao-seedream-5-0-flash-260915",
  "prompt": "一幅海边日出插画",
  "size": "1536x1536",
  "response_format": "b64_json",
  "output_format": "png"
}
```

Pro/Flash 的生成尺寸支持 `1K/1.5K/2K` 或 `WxH`；自定义总像素为 921600–4624220，宽高比为 1/16–16。比例可写进提示词配合档位，也可转成明确尺寸；不要传 Gemini 的 `aspectRatio/imageSize`。Pro/Flash 当前不支持组图、流式或联网搜索，省略这些参数。

`response_format` 为 `url` 或 `b64_json`；结果在 `data[]`，含相应数据、`size`，Pro/Flash 还含 `output_format`。输出格式支持 PNG/JPEG，默认 JPEG。URL 24 小时失效。应用优先 Base64 是为了简化持久化与跨域下载，不是平台只支持 Base64。

来源：[图片 API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh&redirect=1)。

### 尺寸参考与版本差异

Pro/Flash 官方常见 1.5K 比例映射：1:1→1536×1536，4:3→1792×1344，3:4→1344×1792，16:9→2048×1152，9:16→1152×2048，3:2→1872×1248，2:3→1248×1872，21:9→2352×1008。它们是参考值而非穷举。未确认输出边长必须是某一倍数的官方要求。

旧版可选档位不同：Lite 为 2K/3K/4K，4.5 为 2K/4K，4.0 为 1K/2K/4K；Lite/4.5 总像素 3686400–16777216，4.0 为 921600–16777216。不要用其他火山产品（如 LAS）的旧接口说明替代 Ark 当前规格。

来源：[图片创作教程](https://docs.volcengine.com/docs/ark/image-generation-tutorial?lang=en)。

## 费用与未验证项

核验时图片单价：Flash ¥0.12/输出图；Pro 单图生成 ≤261 万像素 ¥0.30，否则 ¥0.60，首张输入免费、后续输入 ¥0.02/张。旧 Lite/4.5/4.0 输出分别 ¥0.22/¥0.25/¥0.20。审核等导致未成功输出的图片不计输出图费。文本按模型、输入输出及缓存等计费，不能套用图片单价；本适配不承诺固定文本单价。

来源：[当前模型价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh)。

真实验证范围：2026-10-29 一次公网工作台到 Flash 图片模型的请求已返回、渲染并下载成功；详见 [验证记录](../VALIDATION.md)。该结果不能概括其他来源/模型的 CORS 与权限。输出 URL 固定域名及额外下载鉴权、其他模型的真实延迟/质量尚未验证。不得把 API Key 附加到任意输出 URL；如需要后端代理，应显式部署可信服务并限制允许访问的上游，不能开放任意 URL 代理。API Key 不进入源码、日志或构建产物。真实请求可能计费，须在用户授权范围内测试。
