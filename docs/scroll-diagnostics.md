# Mobile scroll evidence — 2026-10-29

The user's physical phone still jumps after screenshot/non-scroll actions. This change adds evidence capture, **not a claimed scroll fix**.

## Phone instructions
After the unwanted jump, open **日志 → 滚动诊断（不含对话与密钥）**. Copy the report or download `scroll-diagnostic.json`. The snapshot is frozen **before** navigation replaces the conversation, so logging-page events cannot evict the event being reported. Clipboard failure leaves a readonly text field to copy manually. No console required.

## Scope and privacy
The last 80 events are memory-only. No API requests, automatic upload, persistent storage, input values, credentials, chat contents, endpoint URLs or user-agent string. The export includes version query hashes of the app script and CSS, timestamp, active element tag/id, app/root/window scroll geometry, visualViewport (including zero heights), visibility, layout flow flags and event/reason names. A recent program action is a temporal association within 1 second, **not causation**.

All app scrollTop/scrollBy mutations are annotated: geometry restore, view restoration (including deferred correction), streaming end-follow, explicit focus reveal, matrix scroll restoration. Menu scrollIntoView and button focus restore are annotated too. Native app/window scrolling remains observable separately. Render, field-autosize and layout boundaries expose natural clamping without an explicit scroll write.

## Open hypotheses, not conclusions
- `syncSettingFields()` changes textarea height before the geometry snapshot; natural clamping might occur before the old offset is captured.
- Visual viewport temporary changes can alter flow fallbacks/clearance; zero or transient height must be correlated with actual app/root geometry, not assumed keyboard state.
- Full `innerHTML` replacement loses nodes; subsequent saved-position restoration or native focus handling may compete.
- Window/document scrolling can move independently from the app scroller.

Persistent DOM + a single native scrolling owner is a future simplification candidate. It needs focus, keyboard, fixed-overlay and cross-tab acceptance tests; do not replace current layout based only on this hypothesis.

## Official background
- https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport describes visual viewport offsets and scroll/resize separately from layout viewport.
- https://bugs.webkit.org/show_bug.cgi?id=226689 documents historical inaccurate visualViewport resize/height events on Safari/iPadOS. Its old device/version conditions do not prove this user's screenshot issue.
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus documents `preventScroll`; it does not guarantee DOM replacement preserves the old viewport.

Offline regression proves bounded, content-free reports, frozen pre-navigation snapshots, zero-height observability and presence of annotations. It does not reproduce a real iOS screenshot.
