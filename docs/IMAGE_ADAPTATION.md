# Gemini 图片页适配

版本 0.7.0，资料核对日期 2026-11-04。进入“图片 → ＋ → 设置”，选择 Gemini 并填入模型 ID；“模型设置 → Gemini 图片参数”可选返回内容和适用的图片思考强度。比例与分辨率仍在输入框右下方。

| 精确模型 ID | 本应用登记比例数 | 分辨率 | 可选思考强度 |
| --- | --- | --- | --- |
| gemini-nano-banana-2.1 | 14 | 1K / 2K / 4K | 默认 / minimal / medium / high |
| gemini-3.1-flash-image | 14 | 512 / 1K / 2K / 4K | 默认 / minimal / high |
| gemini-3.1-flash-lite-image | 10 | 1K | 默认 / minimal / high |
| gemini-3-pro-image | 10 | 1K / 2K / 4K | API 默认，不显示等级选择 |
| gemini-2.5-flash-image | 10 | 固定 1K | API 默认，不显示等级选择 |

本表是应用登记范围，不能证明当前密钥拥有调用权限。模型列表优先显示本应用已适配的图片模型；其他 generateContent 模型保留深层入口，未声明此方法的条目只读。自定义 Gemini 地址仍需上游兼容相应接口和参数。

返回内容默认“文字 + 图片”，可改“仅图片”。未选择思考等级时不发送 thinkingConfig；不适用的等级偏好保留但省略。比例/分辨率暂用新模型默认时显示说明，切回兼容模型可恢复偏好。生成确认展示有效的返回内容和思考等级。对话工具调用使用独立图片页设置，不借用聊天温度等参数。

历史模型卡记录当时模型、比例、分辨率、返回内容、有效思考等级和未生效的思考偏好；保存和恢复后仍按原记录显示。既有记录没有的项显示“未记录”。图片结果另记录实际返回的原始格式和解码像素，不承诺固定一张。

资料及取舍：

- [Google 图片生成说明](https://aistudio.google.com/docs/image-generation)：具名模型、比例/尺寸、Nano Banana 2.1 的 minimal/medium/high 与其他 Flash 图片模型 minimal/high。
- [generateContent 图片接口说明](https://ai.google.dev/gemini-api/docs/generate-content/image-generation?hl=en)：responseModalities、imageConfig、thinkingConfig 的请求形状；2.5 使用比例但不传尺寸。
- [generateContent REST 字段](https://ai.google.dev/api/generate-content?hl=en)：ImageConfig 与 ThinkingConfig 枚举。不能把该接口所有枚举视为每个模型都支持。
- [Flash Lite Image 模型页](https://aistudio.google.com/docs/models/gemini-3.1-flash-lite-image)：明确只支持 1K；同页同时写“14 比例”和列举 10 比例，与主指南的极端比例归属也有差异。本应用暂登记明确列出的 10 个；四个极端比例不宣称已确认。

Nano Banana 2.1 继续保留此前逐项收录的像素表；其他新增模型没有套用它的像素表。未登记精确像素时，尺寸检查保持 unknown，实际宽高由解码器观察。资料可能随供应商变更，本轮没有使用真实密钥调用验证。

实现入口：[能力及请求投影](../src/image-capabilities.js)、[图片控件](../src/image-options-markup.js)、[理想效果](../design/IMAGE_ADAPTATION.md)、[本轮记录](reviews/2026-11-04-image-adaptation.md)。
