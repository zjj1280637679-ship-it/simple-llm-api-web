# 结构化输出模块设计与协议对照

本文档记录结构化输出候选模块的功能定义、协议映射与使用材料。

## 模块定位与文件位置

- **模块定位**：独立候选模块，未接入主链路。采用原生 ES 模块规范，零外部依赖，不包含网络请求或状态存储。
- **源码文件**：[src/structured-output.js](../src/structured-output.js)
- **测试文件**：[tests/structured-output.test.js](../tests/structured-output.test.js)

## 导出常量与函数签名

该模块导出 3 个常量与 4 个核心函数：

### 常量

- `SUBSET_KEYWORDS`: 支持的 23 个 JSON Schema 关键字冻结数组。
- `GEMINI_UNSUPPORTED_KEYWORDS`: Gemini 协议不支持的组合与引用关键字冻结数组（`$ref`, `$defs`, `anyOf`, `oneOf`, `allOf`）。
- `ALLOWED_TYPES`: 支持的数据类型冻结数组（`object`, `string`, `number`, `integer`, `boolean`, `array`, `null`）。

### 函数说明与签名

#### 1. `normalizeSchema(schema, seen = new WeakSet())`
- **签名**：`normalizeSchema(schema: any): any`
- **功能**：递归将 JSON Schema 对象的键按字典序排序，并剔除 `SUBSET_KEYWORDS` 之外的非子集关键字。
- **行为规范**：
  - 仅在 Schema 节点层剥离子集外关键字；`properties` 与 `$defs` 下的对象键为属性/定义名称而非 Schema 关键字，保留原名。
  - 数组元素顺序保持不变。
  - `enum` 与 `default` 等具体值内容只进行深拷贝与键排序，不剥离内部关键字。
  - 若输入非普通对象（如基本类型或 `null`），返回其深拷贝。
  - 不修改入参对象。

#### 2. `validateSchemaSubset(schema, protocol)`
- **签名**：`validateSchemaSubset(schema: any, protocol: string): { ok: boolean, errors: string[] }`
- **功能**：校验 Schema 是否完全符合目标模型协议的子集约束，不抛出异常。
- **行为规范**：
  - 协议标识符仅支持 `'openai'`、`'ark'`、`'gemini'`，非法协议计入 `errors`。
  - 根节点必须为普通对象，`type` 必须为 `'object'`，且必须包含普通对象形态的 `properties`。
  - 出现子集外关键字时逐项报错，并携带 JSON 指针路径（如 `$.properties.x.<keyword>`）。
  - `required` 必须是数组，其所有元素必须为已在对应节点 `properties` 中显式声明的键名字符串。
  - `type` 仅允许 7 种指定类型（`object`, `string`, `number`, `integer`, `boolean`, `array`, `null`）。
  - `enum` 必须为非空数组。
  - `type` 为 `'array'` 时必须包含合法的 `items` Schema 对象。
  - `$ref` 仅允许 `'#/$defs/<name>'` 格式，且 `<name>` 必须存在于根节点的 `$defs` 中。
  - 协议为 `'gemini'` 时，若出现 `$ref`、`$defs`、`anyOf`、`oneOf`、`allOf` 均直接报错并标注协议不支持。
  - 校验数值与字符串约束：`minimum` / `maximum` 为数值；`minLength` / `maxLength` / `minItems` / `maxItems` 为非负整数；`pattern` 为合法正则表达式；`nullable` 为布尔值。

#### 3. `buildStructuredOutputFields(protocol, { schema, name, strict } = {})`
- **签名**：`buildStructuredOutputFields(protocol: string, options?: { schema?: object, name?: string, strict?: boolean }): object`
- **功能**：依据各协议规范构建结构化输出请求体片段。
- **行为规范**：
  - `'openai'` 与 `'ark'`：返回 `{ response_format: { type: 'json_schema', json_schema: { name: name || 'structured_output', schema: normalizeSchema(schema), strict: strict !== false } } }`。
  - `'gemini'`：返回 `{ generationConfig: { responseMimeType: 'application/json', responseSchema: normalizeSchema(schema) } }`。
  - 若传入不支持的协议标识符，返回空对象 `{}`。

#### 4. `parseStructuredResult(protocol, responseJson)`
- **签名**：`parseStructuredResult(protocol: string, responseJson: any): { ok: boolean, value?: any, error?: string }`
- **功能**：从厂商返回的响应 JSON 中提取结构化文本载荷并进行 JSON 解析，不抛出异常。
- **行为规范**：
  - 协议合法性：非 `'openai'` / `'ark'` / `'gemini'` 时返回 `{ ok: false, error: 'unsupported protocol' }`。
  - `'openai'` 与 `'ark'`：读取 `responseJson.choices[0].message.content`。
  - `'gemini'`：从 `responseJson.candidates[0].content.parts` 中筛选 `typeof part.text === 'string'` 且不带思考标记（`!part.thought`）的文本片段并拼接。
  - 成功时返回 `{ ok: true, value: JSON.parse(text) }`。
  - 无文本载荷、非对象响应或文本为空白时返回 `{ ok: false, error: 'no text payload' }`。
  - JSON 解析失败时返回 `{ ok: false, error: 'invalid JSON: ...' }`。

## 来源与厂商规范依据

各协议字段构造对应各厂商官方文档规范：

1. **OpenAI API**
   - 字段位置：请求根级别的 `response_format`。
   - 结构要求：`{ type: "json_schema", json_schema: { name, schema, strict } }`。
   - 来源：[OpenAI Structured Outputs Guide](https://platform.openai.com/docs/guides/structured-outputs)。
2. **Google Gemini API**
   - 字段位置：请求配置对象 `generationConfig`。
   - 结构要求：`responseMimeType: "application/json"` 与 `responseSchema`（直接承载 JSON Schema 对象）。
   - 来源：[Gemini Structured Outputs Guide](https://ai.google.dev/gemini-api/docs/structured-output)。
3. **火山方舟（Volcengine Ark）**
   - 字段位置：数据面 Chat Completions API 兼容 OpenAI 格式的 `response_format`。
   - 结构要求：支持 `response_format.type` 为 `json_schema` 并在 `json_schema` 字段内指定定义。
   - 来源：[火山方舟结构化输出文档](https://docs.volcengine.com/docs/ark/structured-output-beta?lang=en)。

## 三协议字段对照表

| 协议 (`protocol`) | 请求体片段形态 | `name` 支持情况 | `strict` 支持情况 | Schema 组合关键字与引用支持 (`$ref` / `$defs` / `anyOf` / `oneOf` / `allOf`) |
| --- | --- | --- | --- | --- |
| `openai` | `response_format: { type: 'json_schema', json_schema: { ... } }` | 支持（字符串；缺省默认为 `'structured_output'`） | 支持（布尔值；缺省默认为 `true`） | 支持（`$ref` 限定为内部 `#/$defs/<name>` 形式；支持 `anyOf` / `oneOf` / `allOf`） |
| `ark` | `response_format: { type: 'json_schema', json_schema: { ... } }` | 支持（兼容 OpenAI 形态） | 支持（兼容 OpenAI 形态） | 支持（兼容 OpenAI 形态） |
| `gemini` | `generationConfig: { responseMimeType: 'application/json', responseSchema: ... }` | 不支持（请求体无此字段） | 不支持（请求体无此字段） | 不支持（校验层明确拒绝 `$ref`、`$defs`、`anyOf`、`oneOf`、`allOf`） |

## 支持的 JSON Schema 关键字子集与限制

### 关键字子集（共 23 个）

```
type, properties, required, items, enum, description, nullable,
additionalProperties, anyOf, oneOf, allOf, $ref, $defs, format,
minimum, maximum, minLength, maxLength, minItems, maxItems,
pattern, default, title
```

### 结构约束与限制规则

1. **根节点约束**：根节点必须为对象，`type` 必须显式声明为 `'object'`，且必须提供 `properties` 对象。
2. **类型范围**：节点 `type` 仅允许从 7 种基本类型中选择（`object`, `string`, `number`, `integer`, `boolean`, `array`, `null`），不支持多选类型数组（如 `type: ['string', 'null']`，应使用 `nullable: true` 或 `anyOf`）。
3. **引用范围**：`$ref` 仅允许内部引用根级别 `$defs` 中声明的定义，格式固定为 `#/$defs/<name>`，不支持外部引用或跨级引用。
4. **数组与枚举**：
   - 当 `type` 为 `'array'` 时，必须显式声明 `items` 对象。
   - `enum` 声明必须为非空数组。
5. **属性关联**：`required` 列表中的每一项必须存在于当前节点的 `properties` 字典中。
6. **Gemini 协议约束**：Gemini 接口限制禁止使用 `$ref`、`$defs`、`anyOf`、`oneOf` 与 `allOf`，定义必须直接展开。

## 测试运行方式

本模块测试位于 `tests/structured-output.test.js`，基于 Node.js 原生测试运行器（`node:test` 与 `node:assert/strict`）。

- **运行单模块测试**：
  ```bash
  node --test tests/structured-output.test.js
  ```

- **运行仓库全量测试**：
  ```bash
  node --test
  ```
