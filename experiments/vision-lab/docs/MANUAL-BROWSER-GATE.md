# Exact-artifact local browser gate (not completed in this delivery)

Use a fresh dedicated browser profile. Record the browser version, OS, extension-tree hash and exact source revision. Retain both successful and failing observations.

- [ ] Install is passive: no content guard before enabling an origin.
- [ ] Enable from the real toolbar popup, reload, and prove independent sink effects for overlay, mismatch, credential, benign link and benign form.
- [ ] A mismatched-link review can be approved once from the popup. A new trusted click is required; changed destination, expired context, another document or inactive tab must not inherit authority.
- [ ] Page-injected HTML, synthetic events, and fabricated message objects cannot issue an allow or Undo.
- [ ] Undo restores only an owned overlay and preserves later page-owned display changes; no blocked click is replayed.
- [ ] Disabling an origin affects all loaded matching frames/tabs and future documents; unrelated enabled origins are unaffected.
- [ ] Worker suspension/restart and browser restart do not create broad allowances. Missing contexts fail closed.
- [ ] Reappearing and layered overlays, dense documents, shadow DOM and nested frames expose the documented budgets and limits rather than producing overbroad protection claims.
- [ ] `form.submit()` survivor is retained and labeled as uncovered; raw field values never appear in extension storage or exports.
- [ ] Keyboard navigation, focus visibility, screen-reader names and popup actions are usable in real Chrome, not just in a renderer harness.

Keep unresolved results open. Do not promote this gate to passed because the portable kernel or UI suite is green.
