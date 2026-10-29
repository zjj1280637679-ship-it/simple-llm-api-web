# DeepSeek 缓存指标诊断

核验：2026-10-29T17:58Z。截图显示两轮命中零，不足以判断后端真实命中量。

## 响应字段

官方 Chat usage 定义：`prompt_cache_hit_tokens` 为命中输入，`prompt_cache_miss_tokens` 为未命中输入，二者和为 `prompt_tokens`；`prompt_tokens_details.cached_tokens` 与独立 hit 相等。

来源：https://api-docs.deepseek.com/api/create-chat-completion/

原实现只读 nested cached_tokens。该字段省略原本显示 `...`，并不会自行变成零，因此不能断言截图零就是此缺口造成。

修复：官方 DeepSeek HTTPS endpoint 的 openai 格式支持独立 hit 字段。两个 hit 字段同时存在但不一致、hit/miss 与 input 不符、无效字段都显示未知（保留诊断来源），不擅自挑一个值。原始通讯日志不改写。非 DeepSeek endpoint 保持原有解析。

SSE 末尾完整 usage 是最后快照，不累加每个片段。本地合成末片段测试证明独立 hit/miss 可以通过流收集器到指标，真实响应尚需用户脱敏日志核验。

## 两轮不保证命中

当前缓存指南说明：完整匹配已落盘的前缀单元才命中；请求输入末尾、输出末尾、重复公共前缀和固定 token 间隔可产生单元。缓存构建需数秒，服务尽力而为，通常空闲数小时至数天清除。部分公共前缀示例前两次不命中，第三次才复用已识别的公共前缀。总输入大不证明前缀已满足匹配条件。

来源：https://api-docs.deepseek.com/guides/kv_cache/

历史 2024 公告曾说明 64-token 单元；现行指南未将该数字作为当前所有模型统一阈值，不据此硬判。

来源：https://api-docs.deepseek.com/news/news0802/

所需最小证据：对应请求 ID、实际 URL/model、末尾 usage 四个字段（prompt_tokens、prompt_cache_hit_tokens、prompt_cache_miss_tokens、prompt_tokens_details）、是否改变前缀/模式。不需要密钥或全文私密对话。
