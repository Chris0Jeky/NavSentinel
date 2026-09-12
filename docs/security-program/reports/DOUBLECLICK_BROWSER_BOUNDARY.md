# Browser opener-observation boundary

The neutral local MV3 browser-contract test loads only a tiny `tabs` and
`webNavigation` observer. It does not load, exercise, or validate a
NavSentinel artifact.

On the measured Chromium lane, `webNavigation.onCreatedNavigationTarget`
reports source-tab and child-tab provenance for trusted `window.open` cases,
including named and `_blank` targets and `noopener`. The observer also records
`webNavigation.onCommitted` for the local parent tab, so the receipt ties each
actual sink navigation to the source/child pair instead of inferring it from a
page assertion.

The bounded HTTP matrix covers same-origin `location` assignment, `href`
assignment, `assign()`, and `replace()`; every one requires an actual parent-tab
sink commit. Cross-origin `location` and `href` controls likewise require that
commit. Cross-origin `assign()` and `replace()` are deliberately reported rather
than forced: each receipt records either the child-side browser rejection or the
parent sink commit. `tabs.openerTabId` is retained as diagnostic output only; the
test does not require it to remain absent or present because Chromium may change
that platform behavior.

The `noopener` controls retain the created-navigation-target event but expose a
null DOM opener and must not create a parent sink commit. This is a browser
contract test only; it makes no claim about second-click prevention, NavSentinel
runtime behavior, or a human browser release gate.
