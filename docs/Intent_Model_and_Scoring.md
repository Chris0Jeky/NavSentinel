# Intent Model and Scoring

## Navigation scoring

Navigation protection is built around the Click Deception Score (CDS) in:

- `extension/src/shared/scoring.ts`

The input model is a `ClickContext` describing:

- viewport
- input source (`pointer` or `keyboard`)
- top clicked element
- underlying element
- retargeting signal
- explicit new-tab intent
- legitimacy hints such as modal backdrops

### CDS factors

The score rises when the clicked target looks deceptive, including:

- interactive element with no accessible name
- large interactive overlays
- mismatch between visible/underlying interactive targets
- target retargeting
- extremely high-z overlay behavior
- invisible but clickable elements
- pointer affordance without real visible affordance

The score is reduced when the signal looks legitimate, including:

- keyboard activation
- legitimate modal backdrop behavior

### Thresholds

Navigation mode determines how aggressively CDS is enforced:

- `smart`: blocks at `70`
- `strict`: blocks at `50`

These values live in `extension/src/content/capture_isolated.ts`.

### Special-case `_blank` handling

Not every `_blank` link is suspicious. The isolated-world controller tries to allow ordinary visible, meaningful `_blank` anchors when:

- the click does not look retargeted
- the link is visible and has a meaningful accessible name
- the CDS is below the smart block threshold
- the reason codes do not match known risky blank-link patterns

This keeps legitimate documentation and OAuth-style flows from turning into constant prompts.

## Credential-risk scoring

Credential-submit scoring lives in:

- `extension/src/shared/domain.ts`

The result includes:

- score from `0-100`
- severity (`none`, `low`, `medium`, `high`)
- structured reason codes
- page-domain facts
- action-domain facts
- optional lookalike match against trusted domains

### Risk factors

The risk model adds weight for:

- non-HTTPS page
- non-HTTPS form action
- `user@host` style URL userinfo
- IP-address hostnames
- punycode hostnames
- mixed-script hostnames
- deep subdomain depth
- cross-site form action
- domain similarity to a trusted domain
- absence from the trusted-domain list

### Trusted-domain model

Trusted domains are not a generic "good site" list. They are a list of registrable domains that the user is willing to submit credentials to. The model compares:

- page registrable domain
- action registrable domain
- trusted registrable domains

This is why `getRegistrableDomain(...)` is central to the implementation.

### Prompt behavior

The credential guard prompts based on:

- extension mode (`off`, `smart`, `strict`)
- medium-risk threshold
- whether the page is trusted
- whether the destination is trusted
- whether the submit is cross-site
- whether HTTP submits are configured to prompt

This logic is in `shouldPrompt(...)` inside `extension/src/content/credential_guard.ts`.

## Explainability

Both navigation and credential decisions are designed to be inspectable:

- navigation decisions expose CDS and reason codes through the debug overlay and blocked-event logging
- credential decisions surface risk score, severity, and reason labels in the modal and event log

That is deliberate. The project is easier to tune and safer to review when decisions are explainable instead of purely implicit.

## Terminology
- GestureToken: short-lived token representing user intent (trusted, suspicious, unknown).
- CDS: Click Deception Score computed from click context.
- NRS: Navigation Risk Score computed at navigation time.
- Reason codes: labels that explain why a score changed.

## Click provenance record
- pointerdown capture: time, x/y, composed path, element stack, top element.
- click capture: same data to detect retargeting or overlays.
- element hints: visibility, size, cursor, accessible name hints.

## Gesture token gating
- Each real user gesture creates a token with TTL around 800ms (tunable).
- Tokens should carry context (coords and element signature) to verify intent.
- Cache CDS in the token to avoid recomputation.
- Patched navigation primitives require an active trusted token.
- Invalidate the token after a successful open or when multiple attempts occur.

## CDS (Click Deception Score) features

| Feature | Weight | Rationale |
| --- | --- | --- |
| Target is interactive but has no accessible name (no text, aria-label, title) | +15 | Empty click targets are common for overlays. |
| Target bounding box covers >35% of viewport and is interactive | +30 | Fullscreen interactive layers are rarely legitimate. |
| elementsFromPoint shows a more intentful interactive element underneath | +35 | High-signal intent mismatch. |
| pointerdown top element differs from click top element | +20 | Retargeting is a classic overlay technique. |
| Target has position fixed/absolute with very high z-index (>= 9999) | +15 | Overlays use extreme stacking. |
| Cursor pointer but no visible affordance | +10 | Weak signal; do not over-weight. |
| Target is effectively non-visible but receives pointer events | +25 | Strong overlay indicator. |
| Keyboard activation (Enter/Space) | -10 | More likely user intent. |
| Known legit modal backdrop | -20 | Reduce false positives for common overlays. |

CDS bands:
- 0-29: low suspicion
- 30-59: suspicious
- 60+: highly suspicious

## NRS (Navigation Risk Score) features

Start with NRS = CDS and add:

| Feature | Weight | Rationale |
| --- | --- | --- |
| New tab/window (window.open or target=_blank) | +20 | Primary abuse case. |
| Cross-site destination (different registrable domain) | +20 | Monetization redirects are often cross-site. |
| Attempt within 0-250ms of pointerdown | +10 | Typical click-handler timing. |
| navigator.userActivation.isActive is true | +5 | Confirms user activation. |
| Multiple attempts within one gesture | +25 | Legit flows rarely do this. |
| DoubleClickjacking pattern active | +40 | Child window + opener.location write + rapid close detected. |
| Destination matches allowlist | -100 | Hard allow. |
| Explicit new-tab intent (middle click or ctrl/cmd click) | -30 | Respect user intent. |

Decision thresholds:
- Allow: NRS < 40
- Prompt: 40-69
- Block: >= 70
- Strict mode: block >= 50

Note:
- NRS is implemented as of P1-04. Navigation decisions use NRS as the primary score. CDS remains available in the debug overlay.

## Explainability
- Each score contribution produces a reason code.
- Prompt UI should show destination URL with allow-once and always-allow actions.

## DoubleClickjacking detection

DoubleClickjacking (January 2025) bypasses X-Frame-Options, CSP frame-ancestors, and SameSite cookies. The attack sequence:

1. User double-clicks on attacker page
2. First click triggers `window.open()` to attacker-controlled child window
3. Child window uses `window.opener.location` to navigate parent to target page (OAuth consent, MFA confirm, payment)
4. Child window closes itself
5. User's second click lands on the sensitive button in the now-navigated parent

Detection is layered across three runtime surfaces:

- **main_guard.ts**: intercepts `window.opener.location` writes via a Proxy on `window.opener`. Tracks `window.open` timestamps. Detects double-click timing (two clicks within 500ms where `window.open` fires between them). Sends bridge messages to the isolated world.
- **capture_isolated.ts**: correlates bridge messages (`ns-dblclick-window-open`, `ns-dblclick-opener-nav`, `ns-dblclick-second-click`) and service worker notifications (`ns-dblclick-child-closed`) to set the `doubleClickHijackActive` flag. Signal expires after 5 seconds to avoid stale false positives.
- **sw.ts**: tracks tab creation with `openerTabId` via `chrome.tabs.onCreated`. When a child tab closes within 5 seconds of creation, notifies the opener tab's content script.

The `nrs_double_click_hijack` factor (+40) alone puts NRS at the prompt threshold. Combined with cross-site (+20) or new-tab (+20) factors it reaches the block threshold.

Reason code: `nrs_double_click_hijack`

## Future extensions (plan for, do not overfit)
- Short redirect-chain correlation tied to a single gesture token.
- Same-tab history.pushState gating within a short window after a gesture.
