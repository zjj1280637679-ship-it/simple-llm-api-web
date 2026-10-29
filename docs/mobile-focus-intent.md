# Follow-up: viewport events must not revive old focus

2026-10-29. Baseline 8b650 (short-tab-labels); this is a follow-up to mobile-send-scroll, not a claim that the first patch solved physical iOS behavior.

## Evidence

User IMG_4948/4949 show the new bubble near the bottom and then higher; IMG_4950 shows a large jump to the older API card. These screenshots do not reveal activeElement or exact viewport event ordering. They establish the symptom, not a device-engine diagnosis.

The remaining code path is deterministic: viewport resize/scroll invokes `protectFloatingFocus(document.activeElement)` even when the active element is an old, offscreen but genuine input. The first patch rejected body only. A genuine input at top=-5000 with navigation.bottom=80 causes a -5092 scroll request. Thus the code can produce the reported scale/destination of jump; whether this was the exact physical screenshot sequence remains unverified.

## Minimal change

- Viewport callbacks only update geometry. They never reveal stale focus.
- Focus protection requires a fresh trusted pointer selection of that control or Tab navigation. This one-use intent expires, and is cleared on blur/hidden. Programmatic focus restoration is not a new navigation intent.
- Geometry restoration compares its target with current scrollTop; unchanged geometry issues no scroll write.
- No additional scrolling timer, API request, zoom restriction or forced blur was added.

## Bounded diagnostics

`window.__llmScrollDiagnostics()` returns a copied ring of at most80 events: time, reason, scroll coordinates/heights, visual viewport height/offset, and focused tag/id. It never reads input values, credentials, textContent, prompts or replies, never persists and never uploads. Refresh clears it. This may distinguish a future browser-native jump from an application `explicit-focus` or `geometry-write`.

## Sources and uncertainty

- https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus — preventScroll avoids an additional native focus scroll.
- https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport — viewport-fixed emulation may flicker; callbacks describe geometry, not user focus intent.
- https://bugs.webkit.org/show_bug.cgi?id=226689 — historical WebKit report of visualViewport resize events despite unchanged visible height. This is a related engine report, not proof of the user's current version or screenshot root cause.

Regression uses a genuine INPUT-shaped offscreen target through30 resize/scroll/blur/visibility/focus-recovery sequences (zero forced reveal), explicit pointer/Tab behavior, no-op geometry, bounded diagnostics and privacy getters that throw on value access. QA page has a synthetic old-focus stress button. Actual mobile screenshot/keyboard operation still needs user/device verification; desktop Chromium is not iOS acceptance.
