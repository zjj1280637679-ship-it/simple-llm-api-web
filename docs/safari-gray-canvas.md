# Safari gray canvas: evidence, 2026-10-29

User screenshots IMG_4962/4963 show a flat gray area below a straight white-content edge while a request is pending; IMG_4964 shows white content after completion. Pixel reads at x=400,y=900/1200 in the first two are RGB(246,247,248), exactly the app's body `--bg:#f6f7f8`; the completion image is white there.

This supports exposed body background or missing main painting as a hypothesis. It is not proof of a particular Safari bug, a giant footer, or an overlay. Source uses white `.main` with min-height:100dvh, `.shell` height:100dvh overflow:auto, fixed transparent composer wrapper. Normal layout should cover the scrollport. Merely changing gray to white would conceal rather than diagnose missing content.

Official related reports (different versions/conditions):
- https://bugs.webkit.org/show_bug.cgi?id=228278 — non-body scrolling containers and dynamic toolbar blank regions; later comments describe body and nested container both scrolling.
- https://bugs.webkit.org/show_bug.cgi?id=281063 — toolbar visibility and incorrectly reported innerHeight after navigation.
- https://bugs.webkit.org/show_bug.cgi?id=253399 — fixed-content compositing cropped to dynamic viewport, acknowledged viewport-cropping assumption.
None establishes the current user's exact root cause.

## Added evidence, not a layout fix
Scroll diagnostic v2 records app/main bounding rectangles with each event. The pre-logs frozen report additionally samples main/app/composer rectangles, numeric clearance/keyboard inset CSS variables and three viewport hit-test classifications (body/html/app/main/composer/navigation/thread/other/none). It reads no text, values, endpoint URLs or keys, sends no network request and preserves existing 80-event bound.

Interpretation:
- Main bottom matches the gray boundary and samples hit body: content/layout boundary exposure; inspect root/app scrolling and transient viewport geometry.
- Main covers area and hit-test says thread/main while screen is gray: evidence favors rendering/compositing failure over a DOM overlay.
- Composer rectangle unexpectedly huge: inspect composer geometry/fallback state.
- A mismatch is evidence to reproduce, not permission to add repeated scroll compensation.

`tests/browser/safari-canvas.html` builds a synthetic long reply then an unresolved mocked request, lets QA vary viewport height, inspect both scroll roots and complete the request. All fetches are intercepted; use an isolated QA origin because this build has local persistence. An iframe/Chromium run is not a Safari-toolbar reproduction.
