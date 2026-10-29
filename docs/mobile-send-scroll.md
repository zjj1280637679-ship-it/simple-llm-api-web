# Mobile send scroll stability

Version 1 — 2026-10-29, based on c60e43dab9e26656aef8ba237097b4b0e8204f08.

## Evidence and scope

User screenshot IMG_4945 shows the new user bubble obscured by the floating composer after sending, while loading. It does not by itself establish a specific browser engine or prove keyboard event ordering.

A deterministic defect was found in the previous code: each visualViewport resize/scroll called `protectFloatingFocus(document.activeElement)`. Following a render which removes/disables the draft, focus may be `body`. The old function did not require an actual focused control inside the app, so body.top=0 was repeatedly aligned below navigation. With navigation.bottom=80, a synthetic sequence of 30 events moved scrollTop from 2600 to 0. The corrected version makes zero scroll calls for body/detached/non-control nodes while preserving protection for actual fields.

Separate layout issue: composer clearance changes after draft shrinking or keyboard dismissal were not paired with preservation of reading/end intent. Measurement now captures the prior scroll geometry and restores either the existing pixel offset or the end only when previously at the end. The app scroll container opts out of browser scroll anchoring because it already implements explicit view restoration; this avoids two competing compensations. No smooth scrolling is added. Sending still performs the existing deliberate end navigation, but viewport events cannot repeatedly scroll the document body into view.

## Official references

- https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport — OSK can resize the visual viewport without resizing layout viewport; resize/scroll are separate events.
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll_anchoring/Overview — anchoring can compensate layout shifts; overflow-anchor opts a container out.
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/CSSOM_view/Viewport_concepts — pinch zoom, keyboard and browser chrome differ; this patch does not disable zoom or reopen the earlier zoom investigation.

## Verification

Offline unit tests reproduce repeated viewport events with body focus, real input reveal, keyboard/draft geometry changes at bottom, and active reading at offset735. Existing three-tab restoration and delayed success/error tests remain. `tests/browser/reflow.html` has a synthetic send-scroll stress button using mocked fetch and explicitly synthetic viewport events; no credentials or real APIs. Physical iOS keyboard/Chrome/Safari behavior remains unverified and needs device QA; Chromium dimensions are not an iOS claim.

Integration: changes touch only scroll/focus helpers, the measurement body, app-container CSS, tests and this document. No send/network API logic or settings authorization changes. Keep streaming worker's incremental paint and API worker's changes intact.
