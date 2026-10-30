# 开发态契约与最简宿主

当前项目 v0.4.0，2026-10-30。完整身份以 [catalog](../../module-library/catalog.json) 和每份 JSON 契约为准，共 26 个登记构件。模块与宿主有独立版本、创建/更新时间；源文件、共享验证依赖或契约变化会改变证据身份。

每份契约现在包含：课题 question、具体效果 goal、输入条件、状态模型/未有限化部分、观察范围、反例、扩展点和证明义务。机器检查验证字段与身份，不鉴定目标是否充分或假设是否真实。

源码顶层注释说明本块为何存在、拥有何种状态和如何扩展。关键细节见 [认识论设计](../../design/EPISTEMIC_DESIGN.md)；有限模型的条件与不足见 [models](../../development/models/README.md)。

`npm run hosts` 独立运行全部宿主，`npm run models` 检查有限判断分类。宿主直接 import 生产块；模拟时钟/DOM/传输等按宿主记录。local PASS、有限模型 PASS 与完整 F/C/H/Q 是不同命题，当前完整四项仍为 UNKNOWN。

原生 JSON 不按 apiKey、constructor、__proto__ 等业务键名删值；凭据碰撞由保存组合处理。供应商 profile 匹配只核对本地协议/域名/路径规则，不证明模型能力或账号条件。两块的早期 0.1.0 报告可在历史提交中查看，不能覆盖当前宿主版本。

交互卡的五个新增模块及宿主见 [协议](../INTERACTION_CARDS.md) 与 catalog。
