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
| Destination matches allowlist | -100 | Hard allow. |
| Explicit new-tab intent (middle click or ctrl/cmd click) | -30 | Respect user intent. |

Decision thresholds:
- Allow: NRS < 40
- Prompt: 40-69
- Block: >= 70
- Strict mode: block >= 50

Note:
- NRS is implemented as of P1-04. Navigation decisions use NRS as the primary score. CDS remains available in the debug overlay.

## ClickFix / Fake CAPTCHA detection

ClickFix detection is a page-level scan rather than a per-click CDS/NRS factor. It runs
when a clipboard write is intercepted from the main world and correlates three independent
signals:

| Signal | Source | Required? |
| --- | --- | --- |
| Clipboard write event | `navigator.clipboard.writeText()` or `document.execCommand("copy")` intercepted in `main_guard.ts` | At least 2 of 3 |
| Overlay/modal present | Fixed/absolute element covering >= 25% viewport with z-index >= 100 | At least 2 of 3 |
| CAPTCHA/instruction text | Regex patterns matching "verify you are human", "press Win+R", "paste", etc. | At least 2 of 3 |

Scoring within the ClickFix scan:

| Factor | Weight | Reason code |
| --- | --- | --- |
| Clipboard write + overlay present | +35 | `clipboard_write_with_overlay` |
| Command-like clipboard content + overlay | +10 | `clipboard_command_with_overlay` |
| CAPTCHA text + instruction text both present | +25 | `clickfix_instruction_pattern` |
| Instruction text only (without CAPTCHA text) | +15 | `clickfix_paste_instruction` |
| CAPTCHA text + overlay (without instruction) | +10 | `clickfix_captcha_text_with_overlay` |

Detection triggers when at least 2 of the 3 signals fire and the combined score >= 25.

False positive suppression:
- Known legitimate CAPTCHA providers (reCAPTCHA `.g-recaptcha`, hCaptcha `.h-captcha`,
  Cloudflare Turnstile `.cf-turnstile`, Arkose Labs/FunCaptcha iframes) suppress the scan
  entirely.

Privacy:
- Clipboard content is NEVER stored or transmitted. Only metadata (content length, boolean
  command-like indicator) crosses the main-to-isolated bridge.
- Clipboard events are pruned after 30 seconds and capped at 5 entries.

Implementation files:
- `extension/src/content/main_guard.ts` — clipboard API patching + `document.execCommand("copy")` interception
- `extension/src/content/clickfix_detector.ts` — pattern matching, overlay detection, combined scan
- `extension/src/content/capture_isolated.ts` — bridge message handling and toast display

## Explainability
- Each score contribution produces a reason code.
- Prompt UI should show destination URL with allow-once and always-allow actions.

## Future extensions (plan for, do not overfit)
- Short redirect-chain correlation tied to a single gesture token.
- Same-tab history.pushState gating within a short window after a gesture.
