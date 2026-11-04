# 有限判断模型 1.0.0

项目 v0.3.0；2026-10-30。运行 `npm run models`。这些检查调用真实生产纯函数，未复制一套仅供测试通过的实现；预期性质采用独立判定式。输出是 **bounded-exhaustive-check**，不是完整实现形式证明。

## 交互效果模型（v0.5.1，2026-11-04）

`interaction-effects-model.mjs` 对 4 个已知协议及历史协议缺失类、4 个输出参数代表值与4个后来协议运行80次历史投影独立性比较；另对 Gemini 与两个 Ark 预设能力表的全部起点/终点组合运行2916次双维选择转移。每个历史模型摘要没有业务控件或折叠内容；当前三个能力表的首层常用比例各3个。对应 [理想效果义务](../../design/INTERACTION_EFFECTS.md)。

这不是无限字符串/完整 DOM 或输入法实现的证明。搜索输入节点连续性由组合回归与真实浏览器观察另验；能力表不因选择可达而取得真实供应商可用性证据。后续模型扩大集合时重新确定精度和预算。

## 结束证据与接纳

设 P 为已知协议，R 为明确拒绝，C 为该协议已识别的完整结束，M 为缺少标记，J 为 JSON 入口，G 为 Gemini，A 为 Anthropic，E 为观察到流终止。

当前策略在这些分类上的接纳式为：

\[
\operatorname{admit}=\neg R\land P\land\bigl(C\lor(J\land\neg A\land M)\bigr)\land(J\lor G\lor E)
\]

`completion-model.mjs` 覆盖 5 个协议类（含未知）、17 个标记代表（含缺失/非字符串/未来值）、拒绝与否、JSON/SSE、终止与否，共 **680** 个组合。拒绝优先，不允许未来标记自动成为完整；兼容接纳缺失 JSON 标记时，其 evidence.status 仍为 unknown。

信任与未证明义务：协议标记表是本地解释；用代表值替代任意字符串的等价分类需要与源码类型/相等判断对应；JavaScript 引擎、SSE framing、外部服务行为、内容正确性不在此有限判断式的证明范围。模型没有网络请求。

## 图片效果向量

解码和尺寸是独立坐标：decoded ∈ {passed, failed, unknown}，dimensions ∈ {matched, mismatch, unknown}。对一个非空批次，“passed/matched”表示全部该坐标达标，“failed/mismatch”表示至少一项失败/偏差，其余为 unknown；空集合不产生成功结论。

`image-evidence-model.mjs` 覆盖每项 9 种坐标组合、长度 0..3 的全部列表，共 **820** 个组合，并验证伪造的 goal/persisted/visible 成功字段不能经普通工作区回执被提升。失败解码的文件可以已存入工作区；两者没有逻辑矛盾。

未证明义务：任意长度的归纳对应、候选文件签名确由 core 校验、浏览器解码器/真实像素、存储事务提交、屏幕可见和用户目标。receivedImageSummary 以 core 已校验候选为前提，并不再次检验字节。字段 persisted/visible/goalSatisfied 在当前回执中保持 unknown。

## 宿主与回归的对应

completion-evidence、completion-policy、image-evidence 均有独立契约和最简宿主。模型检查是补充维度，完整 JSON/SSE/Agent/网页发送回归另外覆盖组合。改变抽象输入域、性质或共享模型实现时，更新使用它的宿主版本及证据指纹。

## 交互卡位置模型（v0.4.0）

`card-position-model.mjs` 穷举 api/model/user/chatResult/status/error 六种历史项、长度 0..4 的 1555 条历史，共 7465 个身份查询。直接调用生产 isLiveCard 和动作登记表，用末项索引作独立判据；每个工作区至多一个活卡、任何后续非卡项也冻结旧卡。异步晚到、一次性确认和存档恢复另有组合测试。无限历史长度的对应、DOM 事件与外部效果仍需独立证明。

Gemini 适配模型新增 324 个有限组合：2 类端点 × 6 个模型代表 × 3 种 thinking 回执 × 3 种摘要偏好 × 3 种种子偏好。检查已知无效字段收缩、默认省略、零/假值保留、无副作用及协议家族隔离。模型列表、配额、真实请求、全部 DOM 或无限输入空间没有被该枚举证明。

图片适配模型 `image-adaptation-model.mjs` 遍历五个精确 Gemini 模型的登记参数组合和跨模型偏好往返；检查请求字段省略与可选思考控件。范围见 `design/IMAGE_ADAPTATION.md`，不包含真实账号或浏览器。
