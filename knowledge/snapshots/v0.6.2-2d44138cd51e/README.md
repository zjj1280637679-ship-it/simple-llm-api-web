# v0.6.2 Gemini 适配快照

知识版本 1.5.2；2026-11-04T17:01:23+08:00。源提交 `2d44138cd51e5afda9febf70b8f1fb167043f17c`，树 `1d095718e6d14248f335d92ea4ad00cbcc6a16b7`。281 个项目文件、35 个模块/宿主；所有项目文件与源树逐字节匹配。历史快照保留。

入口：[理想效果模型](../../../design/GEMINI_ADAPTATION.md)、[参数说明](../../../docs/GEMINI_ADAPTATION.md)、[审查记录](../../../docs/reviews/2026-11-04-gemini-adaptation.md)。运行 `node knowledge/query.mjs route gemini` 定位实现、契约和验证证据。

当前效果：明确不可用才收缩；未知保留深层入口；默认省略新增参数；0 与 false 保真；冻结卡不随当前配置改变。此版本补上 thinking=true 但格式未知的手选路径，以及显式目标工作区拉取模型的配置/回执归属。

本轮回归 446 项中 445 通过、1 可选 SDK 测试跳过；35 宿主、5 个有限模型通过，包括 324 个 Gemini 代表组合。证据身份和执行时间见 [review.json](../../../development/evidence/review.json)。本地合成和有限分类不证明账号权限、真实模型生成、手机或 Safari；完整 F/C/H/Q 和抽象对应仍未证明。

线上浏览器观察作为发布附加项另记，不由本地测试自动推断。
