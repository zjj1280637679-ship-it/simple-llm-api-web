# 火山方舟普通 API：低成本实验模型目录

核验日期：**2026-10-29**。适用仓库：`zjj1280637679-ship-it/simple-llm-api-web`。

## 结论与选择标准

“最合适”在这里指**当前仍受支持、较低成本、覆盖有用能力、接入简单、便于复现实验**，不是各领域绝对最强。优先使用有日期的 Model ID；不把滚动别名、预览版、已停止新购或已下线版本设为默认。本文是文档核验，不代表这些模型均已在本账号调用成功。

| 类别 | 建议实验模型（精确 ID） | 推荐用途与在役依据 |
| --- | --- | --- |
| 文本／全模态通用默认 | `doubao-seed-2-1-lite-260915` | 适合摘要、结构化抽取、工具调用及图像／音频／视频理解；官方当前推荐列表及 2026-09 发布记录均列出，无退役标记。[模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=zh&redirect=1)、[发布公告](https://docs.volcengine.com/docs/ark/model-release-announcement?lang=zh) |
| 文本低成本／稳定基线 | `doubao-seed-2-0-mini-260428` | 小规模分类、翻译、短摘要与多模态解析；这是 **LTS** 精确版本，最早下线日期为 **2027-04-30**。若主要目的是省钱验证接口，可先选它。[LTS 机制](https://ark.volcengine.com/region:cn-beijing/docs/lts-mechanism) |
| 图片生成／编辑 | `doubao-seedream-5-0-flash-260915` | 默认图片模型；文生图、参考图编辑、图层拆分。官方教程明确 Flash 更快、更便宜；Pro 画质优先时再作对照，不把两者画质称作完全一致。[Seedream 5.0 教程](https://ark.volcengine.com/region:cn-beijing/docs/seedream-5-0-pro) |
| 视频生成 | `doubao-seedance-2-0-mini-260615` | 默认低成本视频实验；先做 480p、5 秒、无参考视频的简单文生视频。官方教程将 Mini 定位于成本优先；仍在当前服务列表，且是旧视频版本的建议迁移目标。[Seedance 2.0 教程](https://docs.volcengine.com/docs/ark/seedance-2-0?lang=zh)、[下线公告](https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh) |
| 视频品质／新能力对照 | `doubao-seedance-2-5-260628` | 非默认；需要更长叙事、30 秒输出或新编辑能力才使用。官方 2026-06 发布；创建 API 已说明全面公开。[发布公告](https://docs.volcengine.com/docs/ark/model-release-announcement?lang=zh)、[创建视频任务](https://ark.volcengine.com/region:cn-beijing/docs/create-video-generation-task-api) |
| 杂项：向量／检索 | `doubao-embedding-vision-251215` | 首选短文本相似度、再扩展以图搜图；同一模型涵盖文本、图片、视频。当前教程与 API 示例使用此版本。[向量化教程](https://ark.volcengine.com/region:cn-beijing/docs/vectorization) |
| 杂项：音频理解 | `doubao-seed-2-1-lite-260915` | 不增加新模型即可做语音转写后摘要、会议语义分析；这是 Ark 音频输入理解，不是独立 TTS 或实时流式 ASR。[音频理解](https://docs.volcengine.com/docs/ark/audio-understanding?lang=en) |
| 杂项：3D（低价可选） | `hyper3d-gen2-260112` | 需要 3D 时先试简单物品文生 3D，省去准备参考图；当前影眸 API 明确列出此版本，使用 Ark Key 和任务 endpoint，刊例价 ¥1.80／次。[影眸创建 API](https://docs.volcengine.com/docs/ark/shadoweye-create-3d-generation-task-api?lang=zh) |
| 杂项：3D（字节模型对照） | `doubao-seed3d-2-0-260328` | 一张自有物品图生成 GLB；仅作为字节模型家族对照，**不是最低价**。当前 3D API 明确列出此版本。[创建 3D 任务](https://ark.volcengine.com/region:cn-beijing/docs/create-3d-generation-task-api) |

可选对照：`doubao-seedance-2-0-fast-260128` 用于视频速度／品质与成本折中；图片品质对照为 `doubao-seedream-5-0-pro-260628`。没有必要为“最新”一次性接入所有旗舰模型。[视频教程](https://docs.volcengine.com/docs/ark/seedance-2-0?lang=zh)、[图片教程](https://ark.volcengine.com/region:cn-beijing/docs/seedream-5-0-pro)

## 普通 Ark API 地址与鉴权

基础地址固定为 `https://ark.cn-beijing.volces.com/api/v3`，请求头为 `Authorization: Bearer $ARK_API_KEY`。这里**不是 Agent Plan / Coding Plan**，不要混入订阅专用的 URL、模型别名或计费承诺。模型仍需在账号下开通；有 Key 不等于所有模型都已授权。管控面 AK/SK 签名是另一套机制，不应为简单实验额外引入主账号 AK/SK。[Base URL 及鉴权](https://ark.volcengine.com/region:cn-beijing/docs/base-url-and-authentication)

| 能力 | 方法与相对路径 | 请求／响应特点 |
| --- | --- | --- |
| 文本与多模态理解 | `POST /chat/completions` | 现有 OpenAI 风格聊天适配器可优先复用。[Chat API](https://ark.volcengine.com/region:cn-beijing/docs/chat-api) |
| 状态化多轮／新应用 | `POST /responses` | 独立请求与事件结构，不把 Chat payload 原样混用。[Responses API](https://ark.volcengine.com/region:cn-beijing/docs/create-model-responses-api) |
| 图片 | `POST /images/generations` | 同步返回图片信息。[图片 API](https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api) |
| 视频 | `POST /contents/generations/tasks` | 创建后保存任务 ID；`GET /contents/generations/tasks/{id}` 查询，直到成功／失败等终态。[创建](https://ark.volcengine.com/region:cn-beijing/docs/create-video-generation-task-api)、[查询](https://ark.volcengine.com/region:cn-beijing/docs/get-video-generation-task-api) |
| 向量 | `POST /embeddings/multimodal` | **不是**默认的 `/embeddings`；输入是带 `type` 的对象列表。[多模态向量 API](https://ark.volcengine.com/region:cn-beijing/docs/multimodal-vectorization-api) |
| 3D | `POST /contents/generations/tasks` | 异步任务；注意输出是 `file_url` 而非 `video_url`，Hyper3D 与 Seed3D 参数不能混用。[Seed3D API](https://ark.volcengine.com/region:cn-beijing/docs/create-3d-generation-task-api)、[Hyper3D API](https://docs.volcengine.com/docs/ark/shadoweye-create-3d-generation-task-api?lang=zh) |

## 首次实验参数（仅示例，不自动发送）

### 文本

用于 `POST /chat/completions`：

```json
{
  "model": "doubao-seed-2-0-mini-260428",
  "messages": [{"role": "user", "content": "把以下内容概括为三点：今天我们完成了接口联调，明天测试错误处理。"}],
  "thinking": {"type": "disabled"},
  "max_completion_tokens": 256,
  "stream": false,
  "service_tier": "default"
}
```

升级质量时只将模型切换到 `doubao-seed-2-1-lite-260915`。首次先关闭思考，避免默认思考带来额外时间与 token；需要推理时再启用并另做预算。`max_completion_tokens` 限制回答加思考的总输出长度，不能同时设置 `max_tokens`；后者通常只限制回答，不应误当总费用上限。也不要复制不支持的 `frequency_penalty`／`presence_penalty`。[Chat 参数](https://ark.volcengine.com/region:cn-beijing/docs/chat-api)、[上下文管理](https://docs.volcengine.com/docs/ark/context-management?lang=zh)

### 图片

用于 `POST /images/generations`：

```json
{
  "model": "doubao-seedream-5-0-flash-260915",
  "prompt": "一只白色陶瓷杯放在浅灰桌面上，柔和自然光，简洁产品摄影，无文字。",
  "size": "2K",
  "output_format": "png",
  "response_format": "url",
  "watermark": true
}
```

Flash 每次常规生成单图；不要传旧模型的组图参数 `sequential_image_generation`，也不要假定支持 `stream` 或联网搜索。返回 URL 约 24 小时失效，应及时转存。已有项目记录：该 Flash 精确版本曾返回 HTTP 200、2048×2048 PNG；本次文档调查未重新调用。[图片 API](https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api)

### 视频

用于 `POST /contents/generations/tasks`：

```json
{
  "model": "doubao-seedance-2-0-mini-260615",
  "content": [{"type": "text", "text": "静止镜头，一只橙色小猫在窗边慢慢转头，柔和日光，动作自然。"}],
  "resolution": "480p",
  "ratio": "16:9",
  "duration": 5,
  "generate_audio": false,
  "watermark": true
}
```

Mini 支持 4–15 秒、480p／720p；首次不要设 `duration=-1`，避免时长由模型决定。不把 `generate_audio=false` 当作已证明省钱的开关。不要自动重发创建任务：先查已有任务，避免重复付费。视频结果 URL 有效期约 24 小时。[创建参数](https://ark.volcengine.com/region:cn-beijing/docs/create-video-generation-task-api)、[查询任务](https://ark.volcengine.com/region:cn-beijing/docs/get-video-generation-task-api)

**开通门槛独立于单次费用：**2026-10-22 更新的专门说明要求满足：可用余额达到 **200 元**；或有余额的 **200 元及以上**专属节省计划；或有余额的 **200 元及以上**模型资源包。开通期间不超过 200 元余额不可提现，关闭实例后解除。旧教程与资源包页出现 `>200`、任意有余量资源包等不同表述，应以此专门说明及控制台实际条件为准，不能承诺 196 元 Mini 包独自满足门槛。开通会启用按 token 付费；若需开通、购买或充值，应另行确认费用与承诺，不由目录创建动作自动触发。[模型开通说明](https://ark.volcengine.com/region:cn-beijing/docs/seedance-model-activation-usage-and-refund)

### 向量

用于 `POST /embeddings/multimodal`：

```json
{
  "model": "doubao-embedding-vision-251215",
  "input": [{"type": "text", "text": "我想找一个低成本的图片生成接口"}],
  "instructions": "Target_modality: text.\nInstruction:Retrieve semantically similar text\nQuery:",
  "dimensions": 1024,
  "encoding_format": "float"
}
```

首个实验做**两个同类型短句的语义相似度**：分别请求且使用相同 `instructions`，再算余弦相似度；先不开多向量或视频抽帧。非对称查询／文档检索应改用对应任务模板，不直接沿用此相似度设置。1024 维主要降低本地存储／传输开销，不等于 API 单价减半。换 embedding 版本或维度需重建索引，不混用旧向量。[任务指令教程](https://docs.volcengine.com/docs/ark/vectorization?lang=en&redirect=1)、[向量 API](https://ark.volcengine.com/region:cn-beijing/docs/multimodal-vectorization-api)、[迁移注意](https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh)

3D 若选 Hyper3D，可用一条描述简单物品的 `content[].type="text"` 提示词做首次文生 3D，先不加高级参数，默认输出 GLB。[Hyper3D 参数](https://docs.volcengine.com/docs/ark/shadoweye-create-3d-generation-task-api?lang=zh) 若选 Seed3D，对照实验使用 `file_format: "glb"`、`subdivision_level: "low"`、一张自有图片；low 是较低面数，不代表固定单次价格更低。Seed3D 不接受纯文本生成 3D。[Seed3D 参数](https://ark.volcengine.com/region:cn-beijing/docs/create-3d-generation-task-api)

## 成本快照（人民币，非报价保证）

下表取官方普通在线推理刊例价，不是低优／批量／低延迟价；实际以账号下单和账单为准。文本价格单位为元／百万 token，输入指非音频输入。

| 模型／实验 | 核验价格 |
| --- | --- |
| Seed 2.1 Lite | 输入 ¥0.80；输出 ¥2.70；音频输入另为 ¥12.00 |
| Seed 2.0 Mini，输入不超过 32k | 输入 ¥0.20；输出 ¥2.00；更长输入进入更高阶梯 |
| Seedream 5.0 Flash | 输出图 ¥0.12／张，输入图免费 |
| Seedance 2.0 Mini，480p、16:9、5 秒、无输入视频 | 官方估算约 ¥1.16／条；同条件 Fast 约 ¥1.86，2.0 约 ¥2.31 |
| Embedding Vision | 文本 ¥0.70／百万 token；图片 ¥1.80／百万 token |
| Seed3D 2.0 | ¥2.40／成功产物 |

视频按实际计费 token、分辨率、时长及参考视频计算，不能只用“每秒价格”套所有场景；成功产物才计费的规则也不意味着无限自动重试合理。以上数字全部来自 [官方模型价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh)。

## 生命周期：不要再新接这些旧默认

以**明确 EOS/EOM 公告优先于列表上的泛化标签**：模型列表仍把部分已过 EOS 的版本写作“即将下线”。截至核验日：

- `doubao-seed-2-0-lite-260215`、`doubao-seed-2-0-mini-260215` 已于 **2026-10-22 14:00 UTC+8** 到达 EOS；不是当前实验默认。
- Seed 1.6／1.8 等旧通用版本已在更早批次退役；不要复用旧文章中的 250615、251015、251228 默认。
- Seedream 4.5-251128、5.0-lite-260128／5.0-260128，以及 Seedance 1.0 pro／pro-fast 等有已公布停止新购／下线计划，不用于新实验。
- `doubao-embedding-vision-250615` 已停止新增接入点；embedding 采用 EOM、不强制 EOS，不能把它误写为所有存量请求都已停服，但新接入应选 251215。

依据：[官方模型下线公告](https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh)。以后更新本目录时，重新核验精确版本、EOM/EOS、参数和价格，不能只比较模型名字大小。

## 杂项：独立豆包语音服务

专用 ASR／TTS 不走上述 Ark API。下列是语音服务的**资源 ID**，不是可填进 Ark `model` 的 ID。官方当前 [语音模型列表](https://docs.volcengine.com/docs/doubao-voice/model-list?lang=zh)仍列出对应服务，未标下线；本次未实测账户可用性。

| 用途 | 推荐资源 ID | 普通语音 endpoint | 最小实验 |
| --- | --- | --- | --- |
| TTS 默认 | `seed-tts-2.0` | `POST https://openspeech.bytedance.com/api/v3/tts/unidirectional` | 20–50 字、预置音色 `zh_female_vv_uranus_bigtts`、MP3／24000 Hz；不购买复刻音色。[TTS 文档](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh) |
| ASR 默认（正式 2.0） | `volc.seedasr.auc` | `POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit`，随后 `POST .../query` | 10–30 秒自有 WAV／MP3，`request.model_name="bigmodel"`，提交后查询终态；官方建议新用户用此版本而非历史 1.0 的 `volc.bigasr.auc`。[任务提交](https://docs.volcengine.com/docs/DoubaoVoice/task-submission-http-1?lang=en) |
| ASR 同步备选 | `volc.bigasr.auc_turbo` | `POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash` | 10 秒音频，一次返回；不能因资源名字含 bigasr 就认定退役。成功还要检查 `X-Api-Status-Code: 20000000`，不能只看 HTTP 200。[极速版 API](https://docs.volcengine.com/docs/doubao-voice/large-model-recording-file-lite-recognition-api?lang=en) |

异步 ASR 查询时，`X-Api-Request-Id` 应使用提交结果的 `task_id`，不要每次查询生成新 UUID。[ASR 查询](https://docs.volcengine.com/docs/DoubaoVoice/result-query-http-1?lang=en)

新版鉴权使用 **`X-Api-Key` + `X-Api-Resource-Id`**，不是 Ark Bearer 格式；还需按接口设置请求 UUID 等头。建议容器独立保留 `VOLC_SPEECH_API_KEY`，**默认不自动复用 `ARK_API_KEY`**。但不能写成密钥绝对不通用：官方允许为 Key 所属 IAM 用户补充豆包语音权限后跨产品复用；只有明确授权、显式配置后才使用同一值。旧 AppID／Access Token 方案仍有兼容文档，不作为新项目唯一方式。[IAM Key 最佳实践](https://docs.volcengine.com/docs/ark/iam-api-key-best-practices?lang=zh)、[旧版鉴权](https://docs.volcengine.com/docs/DoubaoVoice/old-version-console-authentication-reference-example?lang=zh)

普通后付费快照：TTS 2.0 **3 元／万字符**；录音文件识别 2.0 **0.8 元／小时**。Turbo 的历史极速版价目与新版模型目录存在映射不清，**不要直接套 0.8 元／小时**，先在账号开通页／账单确认。TTS HTTP 响应是分块 Base64 音频，需要单独适配，不是图片接口那样的单个 URL。[语音计费](https://docs.volcengine.com/docs/doubao-voice/billing-instructions?lang=zh)、[TTS 响应](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)

## 验证边界与密钥容器要求

- 此目录生成过程只读取官方文档，没有新发起付费推理，没有读取、复制或写入真实密钥。
- **本文列出的是候选模型与待实施的调用设计，不声称仓库已经实现视频、向量、3D、ASR 或 TTS 适配器。**现有代码与测试覆盖以 README／VALIDATION 为准。
- 在役证据是官方当前列表／教程／公告，不等于用户账号已开通、余额充足、区域匹配或请求一定成功。
- 仓库可以保存模型目录、占位模板、服务端读取代码与 `.gitignore`；真实凭据应保存在授权的密钥存储（如加密的 GitHub Actions Secrets）、运行环境，或权限受限且被 Git 忽略的本机文件中。不要写进前端、静态页面、Git 历史、日志或测试快照；创建 Secret 不等于已有后端消费它。
- 模型选择、密钥选择和 endpoint/header 选择必须分开；先完成离线配置检查，再由用户确认的预算范围执行真实实验。
