# Browser opener-observation boundary

The neutral local MV3 browser-contract test loads only a tiny `tabs` and
`webNavigation` observer. It does not load, exercise, or validate a
NavSentinel artifact.

On the measured Chromium lane, `webNavigation.onCreatedNavigationTarget`
reports the source tab and child tab for trusted `window.open` cases, including
named and `_blank` targets, popup features, and `noopener`. `tabs.openerTabId`
is retained in the attached test receipt as diagnostic output only. The test
does not require it to remain absent or present because that platform behavior
may change.

The `noopener` controls retain the created-navigation-target event but expose a
null DOM opener and cannot navigate the local parent. The regular controls can
navigate that local parent. This is a browser contract test only; it makes no
claim about second-click prevention, NavSentinel runtime behavior, or a human
browser release gate.
