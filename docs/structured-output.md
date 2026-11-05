# 结构化输出候选模块

版本 **0.1.1-candidate**；修订时间 **2026-10-29T11:10:00Z**。原始 PR #4 基准提交 `ad82744675511c920c04db1f88cf724e3e11284e`。

## 需求、条件、策略、指标

- 需求：提供可单独借用的 schema 规范化、局部校验、请求片段映射和 JSON 结果解析。**候选不是必选**；收录、测试通过或合并不代表宿主必须采用。
- 条件：原生 ESM，零外部依赖，无网络、密钥、存储或全局可变会话；调用者提供有限、普通 JSON 数据。当前实现限定 object 根，支持 23 个候选关键字，不是完整 JSON Schema 验证器。
- 策略：先检查输入保真与当前协议入口，再显式构造片段。模块未接入现有生产请求主链路，`dist` 白名单不包含它。借用时须验证目标模型、入口和宿主条件。
- 指标：独立单元/边界测试、纯离线最简宿主及仓库回归；这些不是真实供应商调用或形式证明。

## 文件与入口

- `src/structured-output.js`：3 个常量，4 个导出函数。
- `tests/structured-output.test.js`：18 个原有测试，协议期望已按修正后的契约调整。
- `tests/structured-output-boundaries.test.js`：边界回归。
- `scripts/structured-output-host.mjs`：最简离线宿主 **0.1.0**，创建/更新时间 **2026-10-29T11:10:00Z**。只 import 候选模块、传入 schema、检查协议片段及解析结果，不读取凭据、不发送网络。

## API

### normalizeSchema(schema)

对 schema 节点关键字排序并保留候选子集；properties/$defs 的名称与 default/enum 里的 JSON 值保真复制。数组顺序保留，`__proto__` 作为普通自有数据键保留，不改对象原型。同一对象被多处引用时分别深拷贝；活动路径循环则明确抛 TypeError，不再悄悄变成 `{}`。

单独调用本函数仍会移除子集外 schema 关键字，因此它不是任意 schema 的无损变换。需要保留约束的调用者应先 validate；build 已在 normalize 前执行校验，不默默剥掉无支持的约束。

输入是普通 JSON 数据：有限数值、字符串、布尔、null、稠密数组和普通对象（允许 null 原型）。循环、非有限数值、undefined、bigint、Date、自定义原型、symbol、accessor、非枚举或额外数组属性拒绝。保护递归实现的本地上限是深度 100、遍历节点 100000；这不是供应商配额。共享对象重复出现分别计数。Proxy/恶意宿主对象不在契约内。

### validateSchemaSubset(schema, protocol, { strict = false } = {})

返回 `{ok, errors}`，检查普通 JSON 边界、局部结构/引用/约束与本模块协议 profile。支持 `gemini/openai/ark`。默认 strict=false 是局部 schema 检查；**不等于供应商保证接收**。OpenAI 的 strict=true 额外检查每个 object 全属性 required、additionalProperties:false。错误列出路径。type 数组尚未支持；可空可以用 anyOf 的 string/null 等分支（Gemini responseSchema 还支持 nullable）。

根需 `type:'object'` 与 properties，是本候选覆盖范围，并非断言所有供应商都不支持其它根类型。数组需 items、组合数组非空、required 不重复、上下界不能矛盾。JSON Pointer 目前仅 `#/$defs/<name>` 简单未转义名称（引用 token 不含 /、#、~、%），未实现通用解析。

### buildStructuredOutputFields(protocol, {schema, name, strict})

已知协议先校验 schema 再构建，失败抛 TypeError；schema 不可省略。name 提供时采用 1–64 个字母/数字/下划线/连字符的候选跨协议命名约定，strict 提供时须布尔。未知协议保留旧契约返回 `{}`，宿主应当在调用前选择已知协议。

- OpenAI/Ark：`response_format:{type:'json_schema',json_schema:{name,schema,strict}}`。默认 name=structured_output、strict=true。**相同外层形态不意味着相同 Schema 能力**。
- Gemini：`generationConfig:{responseMimeType:'application/json',responseSchema:...}`。此入口是 OpenAPI Schema 消息，不是 responseJsonSchema；逐 schema 节点将 type 转成官方大写枚举。name/strict 不进入此请求片段。

合并 Gemini 配置片段时，宿主应保留已有 generationConfig 的其它字段，不能浅覆盖整个对象。与原 PR 的小写“透传”相比，这是必要的协议映射，不再称逐字无损。

### parseStructuredResult(protocol, responseJson)

OpenAI/Ark 读取首个 choice 的 message.content；Gemini 拼接首个 candidate 中非 thought 文本。显式 refusal、显式非 stop/STOP 结束原因返回失败；JSON 缺失或语法错误返回失败。缺少结束原因仍可作为片段做 JSON 语法解析，**ok:true 只代表所选文本可解析，不代表完成状态已确认、实例满足 schema 或供应商完整成功**。宿主负责 HTTP 状态、完成状态、业务值与实例 schema 验证。STOP 也可能由 stop sequence 提前结束。函数面向 JSON 响应数据，不支持流式、OpenAI Responses API、代理 getter 对象或多候选选择。

## 协议核验（2026-10-29）

| 入口 | 已核实差异与本候选处理 |
|---|---|
| OpenAI Chat Completions strict | 支持嵌套 anyOf 和内部引用；根不能 anyOf。allOf 明确不支持，oneOf 未在官方支持子集列明，本候选拒绝；nullable/default 不在本候选 OpenAI profile。每个对象全属性 required 且 additionalProperties:false。不能把 OpenAI-compatible 服务都视为同一能力。 |
| Gemini responseSchema | 官方 Schema 消息包含 anyOf、nullable 及 NULL type；不含 additionalProperties、$ref、$defs、oneOf、allOf，本入口拒绝这些。enum 为字符串数组。不是通用 JSON Schema 透传。 |
| Gemini responseJsonSchema | 官方另一个入口支持 $defs/$ref/anyOf，oneOf 语义按 anyOf；本候选暂未实现。不要把本候选的入口范围写成 Gemini 全产品限制。官方新 responseFormat 演进亦未适配。 |
| 普通 Ark json_schema | 官方列 anyOf/oneOf/allOf，但 oneOf 不严格保证 exactly-one、allOf 不严格保证 all 语义。nullable 未获官方支持依据，本候选提示用 null 联合分支；required/AP:false 为官方推荐，不套用 OpenAI 的强制全部字段约束。strict=false/省略只保证合法 JSON 并参考 schema；本构建器默认显式 true。 |

官方来源：
- [OpenAI Structured Outputs（Chat）](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)
- [Gemini GenerationConfig / Schema / Type / FinishReason](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig)
- [普通 Ark 结构化输出](https://docs.volcengine.com/docs/ark/structured-output-beta?lang=en)（此次直接打开超时，附录差异通过官方搜索索引核对；仍需实际目标模型验收。）

供应商/model 对 schema 复杂度、字符长度、format、深度等还有额外条件；本模块没有实现完整供应商准入，也没有实例 schema 验证器。协议和模型能力会变化，以上是带日期的核验，不是永久限制。真实调用应在既有授权和额度条件下另行验收。

## 最小验证

```sh
node --test tests/structured-output.test.js tests/structured-output-boundaries.test.js
node scripts/structured-output-host.mjs
node --test
npm run check
npm run build
```

借用时可只复制这个零依赖 ESM 文件与契约/测试/宿主；无需导入全局模块注册器、模拟后台或生产 core。PR #2 的模块目录是另一候选分支，本次未替它登记新模块、改验证证据或将其当必需依赖。
