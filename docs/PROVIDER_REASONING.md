# 供应商与接口格式分离的思考模板

核验时间：2026-10-29T17:04Z。OpenAI-compatible 是请求格式，不表示供应商是 OpenAI。

## DeepSeek 官方 Chat

来源：
- https://api-docs.deepseek.com/api/create-chat-completion/ （model / thinking / reasoning_effort）
- https://api-docs.deepseek.com/guides/thinking_mode/
- https://api-docs.deepseek.com/news/news260424/ （旧模型名称退役说明）

在 api.deepseek.com 的标准 Chat 路径识别 DeepSeek，当前精确推荐模型为 deepseek-flash、deepseek-v4-pro。

- `deepseek-effort`：none、low、high、max，映射请求 `reasoning_effort`。none 关闭，其余开启相应强度。
- `deepseek-thinking`：enabled、disabled，映射 `thinking.type`。只切换模式，不指定强度。
- API 还兼容部分档位别名，但界面展示实际档位，避免 medium 误导为独立强度。
- 模板只能选择一个，不同时发相互冲突的开关和强度。
- 未设置保持供应商默认，**不补写开关或强度**。
- 未识别模型保留 DeepSeek 手选模板并标注未核验。旧 deepseek-chat / deepseek-reasoner 不自动重写、不作为现役模型推荐。

## 智谱普通 API

来源：
- https://docs.bigmodel.cn/cn/guide/capabilities/thinking
- https://docs.bigmodel.cn/cn/api/introduction

open.bigmodel.cn/api/paas/v4 为普通 API。Coding Plan 路径不套用普通 API 已核验规则。

- glm-5.3、glm-5.3-flash、glm-5.3-flashx：强度 low/high/max；开关只提供 enabled。
- glm-5.2：强度接受 none/minimal/low/medium/high/xhigh/max；支持 enabled/disabled。部分强度为兼容映射，不表示实际七个档位。
- 已收录较早型号只推荐官方可证的 thinking 开关，不推断其支持 reasoning_effort。
- 未识别型号提供智谱手选模板并标未核验，不再自动展示 OpenAI 模板。

## 自定义网关

未识别地址、openai 格式可显式选择 OpenAI、DeepSeek、智谱格式模板；所有选项标未核验。选择不是供应商能力保证，最终以服务端响应和模型文档为准。其他协议不混入这些 Chat 模板。

默认不发送、预算边界和所有已有流式/历史处理不变。测试使用合成 transport，没有真实密钥调用。

## UI 与状态（2026-10-29）
模型卡的“自定义思考模板”配置模式；供应商精准识别的已知模型可以展示对应模式，未知模型仍需明确选择，不套用 OpenAI 原生规则。模式与当前发送档位分开存储。配置模式不自动启用请求参数。发送旁只显示该模式的档位及“不指定”，没有说明/推荐/模板表单；不指定清当前档位但保留模式，因此能再选。数值预算在模型卡配置，快捷菜单读取已配置预算和该模式支持的特殊值。取消或历史卡操作不写当前设置。

DeepSeek 官方 Chat 的显式输出预算映射到 `max_tokens`，依据 [官方 Chat Completion 参数](https://api-docs.deepseek.com/api/create-chat-completion/)。仅精准官方标准目标适配；未填写仍不发，其他供应商/中转本补丁不改其输出字段。此为离线请求体验证，并非真实账号成功调用证明。
