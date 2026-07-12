# Architecture and Data Flow

## Runtime layers

NavSentinel is a Manifest V3 extension with four main runtime surfaces:

1. isolated-world navigation control
2. main-world navigation patching
3. isolated-world credential protection
4. service-worker state for rollback and DNR synchronization

The manifest wires these together from:

- `extension/manifest.json`
- `extension/src/content/capture_isolated.ts`
- `extension/src/content/main_guard.ts`
- `extension/src/content/credential_guard.ts`
- `extension/src/sw/sw.ts`

## Maturity and release boundaries

This is the architecture of a pre-release alpha. The separation and local-first
design are substantial, but several shipped paths are not production-capable:

- `ui_toast.ts` and `credential_modal.ts` currently let page-injected UI
  authorize protection-lowering actions. Script rejection/closed roots alone do
  not solve page-controlled host redressing. RI-01 moves proceed/allow/trust/
  resume authority to tab-bound extension-origin UI; injected UI becomes
  warn/cancel only.
- The visual-sim path is non-functional and can ask `captureVisibleTab` to
  process a different active tab's pixels when the requester is in the
  background. Standing decision D-2026-07-03-F and RI-02 require complete
  removal before beta.
- The bundled reputation binary is a 52-byte reserved-domain test fixture, not a
  production threat feed. The beta release profile is unresolved under AI-9.
- The DNR ruleset contains localhost test rules only; it is not a product
  backstop and its permissions/toggle should not ship in the beta.
- Broad JS-behavior API wrappers have not completed compatibility or runtime
  overhead measurement and should be beta-off until they do.

See [`Product_Strategy.md`](Product_Strategy.md) for product and release gates,
and [`Project_Roadmap.md`](Project_Roadmap.md) for the corrective action
register. Passing unit/E2E tests establishes regression discipline; it
does not establish security efficacy or a completed external audit.

## Content-script split

### Isolated-world navigation controller

`extension/src/content/capture_isolated.ts` is responsible for:

- reading settings and allowlist state
- capturing pointer and keyboard click context
- computing CDS and deciding whether to allow, block, or prompt
- showing blocked/prompt toasts
- coordinating rollback and forward-offer flow with the service worker

This is the main user-facing navigation decision surface.

### Main-world patch layer

`extension/src/content/main_guard.ts` runs in the page's main world so it can patch browser-facing primitives that isolated-world code cannot safely override:

- `window.open`
- `Location.prototype.assign`
- `Location.prototype.replace`
- `HTMLFormElement.prototype.submit`
- `HTMLFormElement.prototype.requestSubmit`
- `navigator.clipboard.writeText` (for ClickFix detection)
- `document.execCommand("copy")` (for ClickFix detection)
- `window.opener.location` writes (for DoubleClickjacking detection)

It captures blocked or replayable navigation attempts, clipboard write metadata, and opener-location-write signals, handing control back to the isolated-world logic.

### ClickFix detector

`extension/src/content/clickfix_detector.ts` is a page-level scanner that correlates three independent signals to detect fake CAPTCHA / ClickFix attacks:

- clipboard write events (intercepted by `main_guard.ts`)
- overlay/modal presence (fixed/absolute element covering >= 25% viewport)
- CAPTCHA/instruction text patterns ("verify you are human", "press Win+R", etc.)

Detection triggers when at least 2 of 3 signals fire and the combined score reaches 25. Known legitimate CAPTCHA providers (reCAPTCHA, hCaptcha, Turnstile, Arkose Labs) suppress the scan.

### Credential guard

`extension/src/content/credential_guard.ts` listens for:

- `submit` on forms containing a password field
- `paste` into password inputs

It computes risk through `extension/src/shared/domain.ts` and uses `extension/src/content/credential_modal.ts` to block-and-prompt risky submits.

## Main/isolated bridge

The main/isolated bridge is intentionally split into three phases:

1. isolated world generates a per-document bridge session nonce and transfers a `MessagePort` to the main world via `window.postMessage`
2. main world sends a random challenge nonce back through the `MessagePort`; isolated world echoes it — only then is the bridge considered verified
3. steady-state traffic flows over the verified `MessagePort`

The implemented constraints are:

- messages must carry the NavSentinel source marker
- messages must match the current protocol version
- messages must match the current per-document session nonce
- only a narrow allowlist of bridge message types is accepted
- the challenge-response handshake verifies liveness/possession of the selected port
- a generation counter in the isolated world prevents stale retry timers from closing successfully-established connections

Steady-state traffic is narrower than the old page-visible `window.postMessage`
fallback, but the setup/session material is page-visible and the challenge is
echoable. The handshake does **not** authenticate an isolated-world identity
against hostile same-page code. `document_start` ordering is a mitigation, not
a security boundary. Issues #175/#186 and a fresh external review remain public-
launch gates; do not describe the bridge as unspoofable before they are resolved.

## Domain reputation (bloom filter)

`extension/src/shared/reputation.ts` can read a build-time compiled bloom filter
of known-bad domains without runtime network calls. The **current shipped asset
is a 52-byte test fixture** containing reserved example domains. It provides no
production reputation coverage.

Key characteristics:
- MurmurHash3-based bloom filter with double hashing
- Binary format: 16-byte header (magic, version, k, m) + bit array
- Builder target false positive rate: < 0.01% (not validated on a real feed)
- Historical data-asset budget: < 150KB (incompatible with the claimed 100K
  cardinality and current aggregate package cap)
- Lookup time: < 1ms

The build script (`scripts/build-bloom-filter.mjs`) can fetch feeds and compile
the filter. A deterministic test filter can be built with
`scripts/build-test-bloom-filter.mjs`. Before real reputation ships, the project
must decide feed licensing/provenance, update cadence, cardinality, FP target,
safe sentinel checks, and a separate immutable-data/package budget.

At runtime, `capture_isolated.ts` loads the bundled asset via
`chrome.runtime.getURL` and checks destination domains during navigation
decisions. A hit adds `nrs_known_bad_domain` (+50) to the Navigation Risk Score.
Store copy must not call this real threat-intelligence coverage while the test
fixture is bundled.

## DoubleClickjacking detection

Detection of the DoubleClickjacking attack pattern (January 2025) is layered across three runtime surfaces:

- `main_guard.ts`: intercepts `window.opener.location` writes via a Proxy; tracks `window.open` timestamps and double-click timing
- `capture_isolated.ts`: correlates bridge messages (`ns-dblclick-window-open`, `ns-dblclick-opener-nav`, `ns-dblclick-second-click`) and service worker notifications to set a `doubleClickHijackActive` flag
- `sw.ts`: tracks child tab creation and closure timing; notifies the opener tab's content script when a child that wrote `opener.location` closes within 5 seconds

The `nrs_double_click_hijack` factor (+40) alone reaches the prompt threshold. Combined with cross-site (+20) or new-tab (+20) it reaches the block threshold. Signals expire after 5 seconds to avoid stale false positives.

## Shared state and storage

`extension/src/shared/storage.ts` is the local persistence backbone. It stores:

- suite settings under `sentinelsuite:settings_v1`
- trusted domains under `sentinelsuite:trusted_domains_v1`
- event log under `sentinelsuite:event_log_v1`
- prompt outcomes under `sentinelsuite:prompt_outcomes_v1`

Related modules also persist:

- navigation allowlist pairs (`allowlist.ts`)
- adaptive per-domain score adjustments (`adaptive_scoring.ts`, max 200)
- domain behavior profiles (`domain_profile.ts`, max 500)
- navigation-category counts and bounded recent bursts (`nav_anomaly.ts`)
- smart-default cooldown domain pairs (`smart_defaults.ts`, max 200 / 24h)

It also provides:

- legacy NavSentinel settings migration
- trusted-domain normalization to registrable domains
- import/export helpers
- bounded event-log behavior based on `logLimit`

`exportAll()` includes settings, allowlist, trusted domains, event log, prompt
outcomes, and adaptive scores. It does not include domain/category profiles,
smart-default cooldowns, or session state. Current Options controls clear the
event log, prompt/adaptive stats, and domain profiles separately; there is no
complete behavioral reset yet (RI-06).

`extension/src/shared/allowlist.ts` manages the per-site navigation allowlist, including legacy key migration and normalization.

## Popup and options page

### Popup

`extension/src/popup/popup.ts` is the fast per-tab control surface:

- shows the current registrable domain
- shows whether that domain is trusted
- allows trusting or untrusting the current domain
- switches nav mode and credential mode
- shows recent event entries

### Options page

`extension/src/options/options.ts` is the durable operator surface:

- saves nav mode, debug overlay, and DNR backstop state
- saves credential thresholds and similarity settings
- inspects and clears the navigation allowlist
- manages trusted domains
- refreshes, clears, exports, and imports event-log state

## Service worker responsibilities

`extension/src/sw/sw.ts` owns short-lived browser state that cannot safely live in a page:

- tab-scoped allow TTLs
- gesture TTLs
- one-shot target allowances
- rollback suppression windows
- pending rollback and forward-offer state
- DNR ruleset enable/disable synchronization
- DoubleClickjacking child-window tracking
- OAuth flow state per tab
- redirect chain correlation

All 15 ephemeral Maps/Sets are backed by `chrome.storage.session` via a write-through cache (`extension/src/shared/session_state.ts`). In-memory Maps are the primary sync read path; every write is mirrored to session storage (fire-and-forget). On SW restart, `hydrate()` restores state from session storage before the first event is processed (handlers gate on a hydrate-ready promise). Session storage is cleared when the browser closes.

It listens to `chrome.webNavigation` events to decide when a committed navigation should be treated as legitimate, rolled back, or offered back to the user.

### PushState guard

`extension/src/content/pushstate_guard.ts` receives `ns-pushstate-suspicious` bridge messages from `main_guard.ts` when the page uses `history.pushState` or `history.replaceState` to inject domain-like paths after a user gesture. Exposes `isPushStateAbuseActive()` (10s TTL) for NRS integration.

### Smart defaults

`extension/src/shared/smart_defaults.ts` analyzes prompt telemetry to detect repeated "Allow once" decisions for the same domain pair. After 3 consecutive allows, suggests adding the pair to the permanent allowlist. Manages 24h cooldowns for dismissed suggestions.

## Data flow examples

### Suspicious popup or `_blank` navigation

1. `capture_isolated.ts` captures the click context and computes CDS.
2. `main_guard.ts` traps the popup or navigation side effect.
3. If the destination is suspicious and not allowlisted, the isolated-world script shows a toast prompt.
4. Allow-once sends a short-lived allowance and replays the blocked action.
5. Always-allow records the destination host in the per-site allowlist and then replays it.

### Risky credential submit

1. `credential_guard.ts` intercepts the form submit before it completes.
2. `domain.ts` computes score and reason codes.
3. `credential_modal.ts` displays a blocking modal with the page domain, destination domain, score, and reasons.
4. The user can cancel, proceed once, or trust a relevant domain.
5. `storage.ts` records the event locally.

### Redirect rollback

1. `sw.ts` sees a redirect-like top-frame commit without a valid allowance.
2. It stores rollback metadata for that tab and suppresses repeated loops briefly.
3. `capture_isolated.ts` receives or polls the rollback state.
4. The tab is returned to the previous page when possible and the user gets a proceed option for the original destination.

## OAuth consent flow monitoring

`extension/src/content/oauth_monitor.ts` detects OAuth abuse by tracking consent flow lifecycle:

- Identifies OAuth redirect patterns (URLs containing `oauth`, `authorize`, `consent` with redirect parameters)
- Tracks the full flow: initial redirect → consent page → callback
- Flags unexpected post-consent redirects (`nrs_oauth_redirect_mismatch`, +30)
- Detects `window.opener` manipulation during active OAuth flows (`nrs_oauth_opener_manipulation`, +45)
- State tracked per tab in the service worker with 60s TTL and 50-entry cap

## Redirect chain correlation

`extension/src/shared/redirect_chain.ts` and `extension/src/sw/sw.ts` correlate multi-hop redirects that were previously invisible because each navigation was scored independently.

- Per-tab navigation chains tracked with timestamps in the service worker
- Navigations within 10 seconds correlated as a chain, capped at 10 hops
- Known redirector patterns (URL shorteners, ad networks) detected via `isKnownRedirector()`
- NRS factors: `nrs_redirect_chain_depth` (+5/hop over threshold 2, cap 25) and `nrs_redirect_via_known_redirector` (+15/hop, cap 30)

## DOM mutation monitoring

`extension/src/content/mutation_monitor.ts` detects post-load injection attacks via MutationObserver:

- Watches for new fixed-position elements covering >= 25% of viewport added after initial load
- Detects form action attribute changes and password field injection
- Rate-limited: 100ms debounce, 50-alert hard cap, 5-minute auto-disconnect
- Excludes cookie consent banners, chat widgets, and elements with proper ARIA markup
- Feeds mutation alert count into the debug overlay

## CSP analysis

`extension/src/content/csp_analyzer.ts` analyzes Content Security Policy meta tags as a risk modifier:

- Parses CSP directives from `<meta>` tags only (content scripts cannot access HTTP response headers)
- Scores weakness based on `unsafe-inline`, `unsafe-eval`, wildcard sources, missing directives
- CSP weakness applied as a modifier only when base NRS already exceeds 20 (attacker-controlled meta tags can't be trusted as a safety signal)
- NRS factor: `nrs_csp_weakness` (cap 10)

## Sub-resource integrity awareness

`extension/src/content/sri_checker.ts` flags credential pages that load external scripts without SRI hashes:

- Scans `<script>` and `<link>` tags for cross-origin resources
- Checks for `integrity` attribute presence
- Integrates with credential guard to elevate risk on pages with missing SRI
- Only active on pages containing password fields

## Per-domain behavioral profiling

`extension/src/shared/domain_profile.ts` tracks per-domain navigation patterns over time:

- Records visit count, total NRS, NRS history, and timestamps per domain
- Computes domain risk assessment via `isRepeatOffender` boolean flag
- Exponential decay: counters halved every 30 days, applied lazily on read
- Async mutex for serialization safety; LRU eviction at 500 domains
- NRS factor: `nrs_domain_repeat_offender` (+10) for domains with consistently high scores

## Adaptive scoring

`extension/src/shared/adaptive_scoring.ts` adjusts per-domain thresholds based on user feedback:

- Tracks allow/block decisions per domain via prompt telemetry
- After consistent "allow" patterns, raises effective block threshold (more permissive, bounded ±15)
- Per-domain adjustments stored in `chrome.storage.local`
- Exposed in debug overlay as `AdaptiveAdj`

## Visual risk indicators

`extension/src/sw/icon_manager.ts` color-codes the browser action badge based on page risk:

- Green: safe/trusted domain
- Yellow: elevated risk detected
- Red: navigation blocked
- Gray: extension disabled
- Badge text shows active block count
- Updates on navigation, trust changes, and mode changes via `ns-tab-risk-update` messages

## Plain-English explanations

`extension/src/shared/explanations.ts` maps technical reason codes to user-friendly messages:

- All toast and credential modal messages use plain English
- Debug overlay retains technical reason codes
- Concise messages (< 80 characters)

## Test-facing hooks and observability

The extension exposes a small amount of deterministic test state used by the Playwright suite:

- DOM readiness markers for injected controllers
- shadow-root toast rendering
- Gym-backed local fixtures for repeatable attacker and legitimate flows

Those hooks are intentional and should stay stable unless the tests are updated in the same change.
