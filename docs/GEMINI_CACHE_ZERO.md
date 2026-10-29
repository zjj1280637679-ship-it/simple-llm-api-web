# Gemini cache telemetry normalization
Verified 2026-10-29. Applies to completed Google-native GenerateContent responses only.
When HTTPS endpoint host is generativelanguage.googleapis.com, usageMetadata has valid
promptTokenCount and totalTokenCount, and cachedContentTokenCount is absent, normalize
cache count to 0. Tag normalized usage cacheCountSource=gemini-proto-default-zero.
Raw communication logs are unchanged. Explicit null, invalid counts, absent/incomplete
usage, other hosts/protocols retain unknown values. This is not an inferred cache hit,
not an attempt to enable explicit caching, and not based on total output tokens.

Sources:
- https://github.com/googleapis/googleapis/blob/master/google/ai/generativelanguage/v1beta/generative_service.proto : cached_content_token_count is non-optional int32.
- https://protobuf.dev/programming-guides/json/#presence-and-default-values : implicit-presence default fields omitted from JSON.
- https://discuss.ai.google.dev/t/has-anyone-gotten-implicit-caching-to-work/142699/15 : Google support explicitly states field omitted when zero cached.
- https://ai.google.dev/api/generate-content : cachedContentTokenCount is cached input; promptTokenCount includes it.
- https://ai.google.dev/gemini-api/docs/generate-content/caching : implicit hits best effort with model-specific minimum input sizes. Do not promise a hit for any short multi-turn prompt.
