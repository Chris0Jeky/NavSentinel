# Document-bound form diagnostics

## Goal and scope

Continue #700/#701 on #707, with a separately based reader on #708. Identify the
browser execution realm that supplied a page report, instead of inferring that
all reports in one tab came from the current child document. The content of a
page report remains untrusted. No runtime guard, permission, attack timer, native
prototype, consent state, receiver consequence, or existing matrix assertion changes.

## Design

Use the test runner's page-scoped CDP session. `Runtime.bindingCalled` supplies the
execution context ID; `Runtime.executionContextCreated` supplies the browser's
unique realm and frame association. Only default worlds at the exact loopback
fixture origin are eligible. Assign bounded run-local frame/document tokens. Never
accept identity fields in a page payload or export raw CDP IDs/URLs. Destroyed,
cleared, reused, unknown, or unsupported contexts fail attribution rather than
being relabelled as the current document. Child-target/process-swap support is not
silently assumed; an unobserved operation remains a gap.

Emit form.v2 with document lifecycle records and context-bound intent snapshots.
Retain form.v1 compatibility but label it unbound. Correlation in the viewer is the
latest reported input in the **same active document**, not the nearest input in a
tab. This is temporal association, not authenticated user intent or proof of the
native initiator. Receiver receipts stay independent and have no invented document.

## Implementation / verification

- [x] Registry unit tests: sibling documents, top navigation, replacement, context
  destruction/clear, numeric-ID reuse, unknown worlds/origins, bounds and copying.
- [x] Fixed CDP binding adapter and v2 producer, default-off with the existing
  instrumentation switch. Preserve original thirty-case assertions byte-for-byte.
- [x] Actual-browser lifecycle tests: same-URL siblings, same-frame reload,
  same-document navigation, removal, spoofed metadata and inactive reporting
  after observer shutdown. Run existing full/control parity with retries disabled.
- [ ] Strict v2 reader and document-scoped comparison/temporal selector, plus
  lifecycle information and links in the offline viewer. Legacy records never
  acquire synthetic document identities.
- [ ] Qualify producer and consumer separately; submit all code, commands, source
  identities, observed failures, results and limits. Keep four-arm form proof and
  default-off browsing session integration separate.

## Reporting realm is not native causality

Same-origin page code can call another frame's exposed function. The CDP envelope
identifies the reporting function's realm; it does not prove which script initiated
an operation, that a user intended it, or that the described form existed there.
The browser test covers borrowed cross-frame invocation explicitly. This slice
prevents accidental cross-document temporal joins, not arbitrary same-origin
sender impersonation. No new certificate or authorization derives from the label.

## Research

Primary sources consulted 2026-09-14:
https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
https://chromedevtools.github.io/devtools-protocol/tot/Page/
`addBinding` accepts one string and reports the calling executionContextId.
Numeric context IDs are not global document IDs. `executionContextsCleared` must
invalidate associations; no timestamps or page fields can repair a lost binding.

## First exact-head qualification and artifact repair

Head `2fd7b9d62c6b891d1e904516301757ecd0c74ae6` passed all six
browser lifecycle tests and the thirty-case matrix with observation on and off
in workflow 34791245486. All 45 corresponding arm outcomes agreed; the 45 actual
v2 form traces imported without gaps or rejection. This is 90 matrix profiles
plus six lifecycle contexts, not an efficacy percentage.

The lifecycle tests originally attached JSON bodies only. The later matrix HTML
report overwrote their sole persisted representation, although the tests passed.
The correction writes per-test JSON files before attaching them and requires all
six durable receipts before advancing. It also labels each lifecycle experiment
explicitly, separate from `form-campaign`. Absence of that optional v2 label denotes
the initial campaign format, not an additional evidence class.

`Runtime.removeBinding` stops delivery to the CDP agent but leaves the callable
JavaScript function in the page. The disposal test requires no further records,
not deletion of that function. Observer-on/off comparisons still require the same
original consequences; no retry, timeout extension or protection assertion change.
