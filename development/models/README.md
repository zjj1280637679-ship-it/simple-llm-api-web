# 有限判断模型 1.0.0

项目 v0.3.0；2026-10-30。运行 `npm run models`。这些检查调用真实生产纯函数，未复制一套仅供测试通过的实现；预期性质采用独立判定式。输出是 **bounded-exhaustive-check**，不是完整实现形式证明。

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
