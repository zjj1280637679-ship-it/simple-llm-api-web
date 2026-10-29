# Settings text reflow

2026-10-29 · revision 1 · based on caption candidate e1e0dbf

URL/model fields use labelled textarea controls with `wrap="soft"` and `rows="1"`.
Wrapping is visual; the input handler preserves the original value. Numeric
controls stay `type=number`; keys stay single-line with the existing explicit
show/hide action. Key storage guidance is a wrapping, aria-describedby helper.

Sizing uses scrollHeight plus border width on input, render and resize. A
ResizeObserver watches each formfield and resizes when field width/font metrics
change, including wrapping labels under text scaling. Height-only notifications
are ignored to avoid an observer loop. No API call is needed.

CR/LF in URL/model values produces the existing ENDPOINT/MODEL error codes before
network dispatch. Ordinary outer spaces retain the existing trim semantics.
Visual wrapping introduces no characters into the outbound URL or model ID.

Sources checked 2026-10-29:
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/textarea
  Soft wrapping does not insert extra line breaks in submitted values.
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/field-sizing
  Newly available in 2026, so this patch uses a scrollHeight fallback for older browsers.
- https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight
  scrollHeight includes padding but not borders.

Node regressions are not visual browser acceptance. Real mobile-width/font-scale
inspection belongs to the integrated UI candidate; no real API is used here.
