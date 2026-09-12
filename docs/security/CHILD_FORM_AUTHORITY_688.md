# Child-form authority — issue 688

## Status and acceptance boundary

Implementation candidate, **not a release/merge approval**. This change is
independent of export PR #696, import issue #690, and the parked modifier/bridge
PRs. Applicable fresh review, an exact-head automated browser campaign, unchanged
performance budgets, and owner-run branded-Chrome Gate-3 are required.

The initial local checkpoint passed TypeScript, ESLint, and all **3,344 unit
checks (118 files)**. The local system Chromium rejects navigation and extension
installation through managed policy; that policy was not changed. The new
Playwright campaign therefore has no local browser-pass claim. GitHub Actions
must qualify the published source. Initial interaction-only packaging measured
505.4 KiB against the unchanged 500 KiB aggregate budget: **a merge blocker**, not
a waived check. The worker-entry split keeps its static-import graph compliant
and the individual worker budget green; it does not excuse aggregate growth.

## Authority model

A child submit click is not a generic tab gesture or an opener/navigation window.
The effective tuple is `{ actionUrl, method, enctype, target, targetScope }`.
No controls, field values, passwords, or request bodies enter this tuple.

1. MAIN captures the trusted click's exact form and submitter object references,
   its event timestamp, and a resolved tuple. This is only a pending candidate.
2. The existing isolated-world click policy must approve the same trusted event.
   It sends a random one-use ID and tuple, bound to that timestamp, to MAIN, and a
   typed authorization to the worker. A synthetic event cannot create it.
3. MAIN approves only an unchanged pending binding. The first wrapped attempt
   consumes it, even when the tuple, form, or submitter mismatches. `submit()` may
   use the clicked form only when its no-submitter tuple exactly matches;
   `requestSubmit(x)` additionally requires the clicked submitter object.
4. Isolated capture applies the same tuple/object gate to native submit events.
   Validation failure burns a pending gesture; fixing the field requires a fresh
   click. Self-target and `method=dialog` remain native and grant no top authority.
5. The worker accepts only extension runtime senders with Chrome-supplied tab,
   child-frame and document identity. Its per-tab typed entry revokes earlier
   generic windows. First top navigation start consumes the arm on match or
   mismatch. A commit must be `form_submit`; a URL-equivalent `link` or Location
   navigation never spends a form grant. A server redirect is accepted only after
   the matching start; client redirects/history do not transfer it.
6. Acquisition expires after 1.5 seconds. A timely, matching start has a bounded
   10-second response window so a slow server is not confused with a stale click.
   Neither duplicate start nor commit extends it. Session-backed phase and
   identity survive worker restart; cancellation, source-frame replacement,
   navigation failure and tab cleanup burn/remove the entry.

DOM authority is captured independently in each realm. No DOM references or
page-selected frame identifiers cross the bridge. Metadata validation is bounded
and explicit. The existing MAIN/isolated bridge's same-realm identity limitations
(#175/#186), and soft-patch replacement/cross-realm bypasses, are not solved here.

## Effective platform semantics

The resolver follows the WHATWG form submission attribute and submission
algorithms (HTML Living Standard, form-control infrastructure). Attribute
**presence** matters: a present-empty submitter override does not inherit. An
empty action selects the document URL; a nonempty relative action resolves
against the current `ownerDocument.baseURI`. Missing target inherits the form and
then the first `base[target]`; explicit empty target selects self. Empty/invalid
methods select GET and invalid encodings select URL-encoded data. `dialog` is not
an HTTP navigation. Captured Web-IDL getters validate branding and avoid a form
control named `action`, `method`, or `target` shadowing native properties.

`requestSubmit` keeps invalid-argument `TypeError` and wrong-owner `NotFoundError`
before consuming authority. Native submit validation remains native; the guard
never reads fields to synthesize a request. GET replaces the action query with
encoded fields, while POST retains it. The worker matcher therefore ignores GET
query differences only inside a **form-typed, matched-start, one-use** capability;
this is not a generic URL-prefix allowance.

References:
- https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#form-submission-attributes
- https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#form-submission-algorithm
- https://html.spec.whatwg.org/multipage/forms.html#dom-form-requestsubmit-dev

## Allow once

The isolated controller records bounded, expiring blocked-form metadata. Only the
user-owned approval path (or the existing user-selected allowlist policy) may
approve a recorded action. Form approval never issues generic `ns-allow-nav`.
MAIN re-resolves the original object binding before requesting the typed replay
and again after the worker acknowledgement, immediately before calling the native
method. An expired or changed binding is rejected and requires a fresh submit.
The blocked ID, worker acknowledgement and closure are each one-use. There is no
retry loop and no mutation-repair of page DOM on the user's behalf.

## What is and is not proved

The worker sees navigation metadata, **not HTTP method, body, or a reliable
network initiator identity**. Method/encoding/submitter binding is enforced by the
DOM gates on their covered paths; do not describe the worker as inspecting POST
bodies or independently proving those properties on every browser request.

Location writes and mutation in later native `submit`/`formdata` listeners may
already reach the network. A return to the source page is
`ROLLED_BACK_POST_COMMIT`, never `BLOCKED_PRE_HARM`. Native formdata mutation,
wholesale MAIN patch replacement and cross-realm natives remain outside the
pre-call claim. The wrapper is also bounded by asynchronous bridge readiness;
a synchronous page handler before policy approval can be conservatively blocked.

Self-frame navigation is not a privilege upgrade: the child could navigate itself
without a click. Arbitrary named targets, `_blank`, deep-frame `_parent`, closed
shadow/custom elements, request contents, open-web efficacy and OS execution are
not covered acceptance claims. The control named `_parent` is classified as top
only for an immediate child. Supported `_self`/`_top`, inherited/explicit-empty
attributes and dialog/validation recovery have dedicated checks.

## Reproduction

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run check:perf-budget
npx playwright install --with-deps chromium
npx playwright test tests/e2e/issue688-form-intent.spec.ts --project=regression
npm run build:research-reputation
npm run check:perf-budget
```

The new browser campaign fails rather than skips when a build is missing. It
uses a fresh persistent profile for every arm, a deny-by-default proxy started
**before** Chromium, and immutable one-use loopback harm/benign sink paths. GET
and POST sink requests are counted without retaining bodies. Rejected duplicate
spends are also counted, preventing sink enforcement from hiding product replay.
An explicit environment override can select a locally authorized Chromium binary;
it is not permission to bypass managed browser policy.

The matrix includes alternate submitter/action/target/method/encoding, late base
href/target, reassociation, expiry, synthetic clicks, mismatch burn, exact replay,
Location same/different URLs, a late native submit mutation, exact native and
wrapped benign submissions, server redirect, slow response, explicit-empty target,
inherited base target, invalid/empty method, self, dialog, validation recovery,
trusted Allow once with/without mutation, and mixed block-then-fresh-click recovery.

JSON receipts bind build bytes, actual browser version, arm identity, sink attempts,
observation window and denied browser background requests. Those finite synthetic
journeys are not distributional efficacy evidence. Owner acceptance must use the
final published head's built loader revision; do not treat an automated fresh
profile as proof that an owner's unpacked extension was reloaded.
