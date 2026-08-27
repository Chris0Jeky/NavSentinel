# Testing and Gym

## Goals

Testing in this repo is meant to answer two engineering questions:

1. Does the extension still produce the expected decisions on its declared fixtures?
2. Did a change accidentally make the extension too noisy, too permissive, or too stateful under churn?

The project uses a mix of deterministic Gym pages, Vitest unit tests, and Playwright-driven browser tests.

Green tests do **not** by themselves prove open-web efficacy, `<0.1%` false-
positive performance, compatibility, competitor superiority, or external audit.
The corpus lane can skip when its local manifest/snapshots are absent, and the
current corpus result is methodologically invalid. Keep regression, operational
beta, and claim-grade evidence separate as defined in `Product_Strategy.md`.

## Local commands

```bash
npm install
npm run typecheck
npm run build
npm run test
npm run test:e2e
npm run test:e2e:smoke
npm run test:e2e:regression
npm run test:e2e:rollback
npm run test:e2e:live
npm run test:e2e:stress
npm run test:e2e:corpus
npm run measure:fp
npm run demo:showcase
npm run demo:showcase:record
```

To run the Gym locally:

```bash
npm run gym:serve
```

The older Python flow still works when needed:

```bash
cd gym
python -m http.server 5173
```

## Test layers

### Unit tests

Current unit coverage lives in:

- `tests/credential-domain.test.ts`
- `tests/credential-guard-model.test.ts`
- `tests/popup-model.test.ts`
- `tests/storage-suite.test.ts`
- `tests/sw-rollback.test.ts`
- `tests/psl-domain.test.ts`
- `tests/nrs.test.ts`
- `tests/scoring.property.test.ts`
- `tests/statemachine-timing.test.ts`
- `tests/prompt-telemetry.test.ts`
- `tests/clickfix-detector.test.ts`
- `tests/nrs-dblclick.test.ts`
- `tests/reputation.test.ts`
- `tests/nrs-pushstate.test.ts`
- `tests/pushstate-guard.test.ts`
- `tests/session-state.test.ts`
- `tests/smart-defaults.test.ts`
- `tests/content-analyzer.test.ts`
- `tests/keyword-sync.test.ts`
- `tests/nrs-ceiling.test.ts`
- `tests/nrs-clickfix.test.ts`
- `tests/redirect-chain.test.ts`
- `tests/oauth-monitor.test.ts`
- `tests/mutation-monitor.test.ts`
- `tests/domain-groups.test.ts`
- `tests/domain-profile.test.ts`
- `tests/adaptive-scoring.test.ts`
- `tests/explanations.test.ts`
- `tests/icon-manager.test.ts`
- `tests/csp-analyzer.test.ts`
- `tests/sri-checker.test.ts`

These currently cover:

- trusted-domain normalization and registrable-domain handling
- PSL-based domain extraction for cloud-hosted and multi-part TLDs
- credential-risk heuristics and model behavior
- popup event formatting and limit handling
- storage import/export, settings migration, and normalization paths
- service-worker rollback, gesture-window, and target-allowance behavior
- NRS computation, navigation factors, and CDS layering
- property-based scoring tests (monotonicity, bounds, gradient continuity)
- state machine timing edge cases (token expiry, window boundaries)
- prompt telemetry recording, statistics, and bounded storage
- ClickFix command detection, CAPTCHA/instruction pattern matching, clipboard event tracking, and legitimate CAPTCHA suppression
- DoubleClickjacking NRS factor (+40 weight, factor combinations, allowlist interaction)
- Bloom filter reputation: MurmurHash3, binary format parsing, known-bad domain lookup, false positive verification, and NRS integration (+50 weight)
- PushState abuse NRS factor (+20 weight, gesture correlation, rapid-fire detection)
- NRS scoring ceiling (diminishing returns above 100, compound FP mitigation, opener-allowed factor)
- ClickFix NRS integration (clickfix score cap at 40, combined scoring with navigation factors)
- Redirect chain correlation (per-hop scoring, known redirector detection, chain cap, stale pruning)
- OAuth consent flow monitoring (flow detection, redirect mismatch, opener manipulation, multi-tab)
- DOM mutation monitoring (debounce, alert cap, auto-disconnect, cookie/chat/ARIA exclusions)
- Same-organization domain groups (cross-site exemption for multi-domain companies)
- Per-domain behavioral profiling (visit tracking, decay, LRU eviction, risk assessment)
- Adaptive scoring (per-domain threshold adjustment, bounded ±15, telemetry integration)
- Plain-English explanations (reason code to user-friendly message mapping)
- Icon manager (badge color/text updates, severity gating, mode-change handling)
- CSP analysis (header/meta parsing, directive scoring, weakness cap in NRS)
- SRI awareness (integrity attribute checking, cross-origin script scanning)
- Allowlist (normalization, dedup, case-insensitivity, legacy migration)
- Event tone classification (credential/config/navigation prefix routing)
- PushState guard bridge message handling, TTL expiration, URL tracking
- Session state manager: hydration, persistence, round-tripping across SW restarts, tab isolation
- Smart defaults: pattern detection, consecutive-allow threshold, cooldown logic, storage integration
- Content analyzer: brand/domain mismatch, phishing kit fingerprints
- Keyword sync for allowlist/storage operations

### Playwright E2E

Representative E2E coverage lives in:

- `tests/e2e/navsentinel.spec.ts`
- `tests/e2e/credential-guard.spec.ts`
- `tests/e2e/suite-ui.spec.ts`
- `tests/e2e/evasion.spec.ts`
- `tests/e2e/navsentinel.stress.spec.ts`
- `tests/e2e/corpus-validation.spec.ts`
- `tests/e2e/phase2-detections.spec.ts`

This list is intentionally representative because spec counts move. Use
`rg --files tests/e2e -g '*.spec.ts'` for current inventory.

It currently covers:

- Level 1 new-tab blocking
- Level 2 moving-target overlay blocking
- Level 3 instant injection new-tab trap blocking
- Level 4 visual-mimicry disguised new-tab blocking
- Level 5 popunder blocking
- Level 6 programmatic click blocking
- Level 7 legitimate modal backdrop
- Level 8 legitimate OAuth popup
- Level 9 legitimate video overlay controls
- Level 10 delayed form-submit prompt
- Level 12 slow same-tab navigation legitimacy
- RW-01 search-result overlay swap
- RW-03 delayed redirect landing with explicit allow-once replay
- RW-04 open-redirect laundering via benign intermediary
- RW-06 legit auth popup followed by a blocked second popup
- RW-08 popup-window reuse laundering with the original consent popup kept in place
- RW-09 mixed empty-target and named-target auth launches with delayed reuse blocking
- RW-10 keyboard-only auth popup launch from Space and Enter activation
- RW-11 invoice-approval payout trap blocking
- RW-12 wallet connect first-popup allow with blocked burst follow-up
- RW-13 courier tracking credential lure prompt
- RW-14 checkout express-pay overlay blocking
- RW-16 fake document preview overlay blocking
- RW-17 media overlay hijack blocking
- RW-18 fake codec warning blocking
- RW-19 repeated tech-support popup burst blocking
- RW-20 support widget first-popup allow with blocked follow-up abuse
- Level 11 credential-submit prompt
- RW-07 fake re-auth interstitial prompt
- password-paste warning and trusted-domain persistence
- options-page trusted-domain normalization
- options-page opt-in overlay-cleanup persistence
- popup auto-dismiss quick-control persistence
- options import/export round-trip behavior
- the opt-in fast baseline hides a bounded batch of up to five pre-existing
  high-severity foreground overlays before interaction, exposes the intended
  page target without replaying a click, groups Undo, and leaves Navigation Off
  inert (`evasion-02` and `evasion-12`)
- delayed high-severity overlay auto-dismissal with an Undo restore path; the
  default-disabled case remains visible and warning-only
- blocked and prompted high-severity click overlays both hide with Undo while
  the intercepted navigation remains blocked
- a dedicated rollback lane for redirect recovery affordances
- RW-15 bank/security alert redirect recovery
- a dedicated live-web sanity lane

`playwright.config.ts` intentionally scopes Playwright discovery to `tests/e2e/**/*.spec.ts`. This keeps Vitest files out of the Playwright runner.

#### Worker topology (serial by default)

The extension lanes launch **headed persistent** Chromium contexts. On Windows,
running several of those at once makes blank-anchor interception
nondeterministic: the contexts compete for OS focus and user-activation state,
so a test can receive a new page even after it has awaited both
`data-navsentinel-capture-ready=1` and `data-navsentinel-bridge-ready=1`.

Measured on 2026-07-17 against untouched `origin/main@cfa6f3c` (#460), five
blank-anchor cases under `--repeat-each=5 --workers=4` gave **4 failed / 21
passed**; the same cases under `--workers=1` gave **15/15 passed**.

Because of that, `playwright.config.ts` and `playwright.live.config.ts` now
resolve their topology through `tests/e2e/playwright-topology.ts`:

- **default (local and CI): `workers: 1`, `fullyParallel: false`.** CI already
  hardcoded this, so CI behaviour is unchanged; what changed is that the local
  default no longer differs from it.
- **opt back into parallel deliberately** with `NAVSENTINEL_E2E_WORKERS`:

  ```bash
  NAVSENTINEL_E2E_WORKERS=4 npm run test:e2e             # bash
  $env:NAVSENTINEL_E2E_WORKERS = "4"; npm run test:e2e   # PowerShell
  ```

  A value greater than `1` also re-enables `fullyParallel`. The variable is
  ignored when `CI` is set, so CI topology cannot drift; a value that is not a
  positive integer fails the run instead of silently picking a topology.

Before this change the local default was `workers: 4` for the default lane and
Playwright's CPU-derived default for the live lane; both were `fullyParallel`.

Treat a parallel local failure as unproven until it reproduces serially. The
underlying focus/user-activation race is **not fixed** — #460 stays open for it.
The already-serial lanes (`rollback`, `stress`, `corpus`, `demo`) were already
`workers: 1` and are unchanged.

Current lane intent:

- `npm run test:e2e:smoke`
  - shortest deterministic browser checks
- `npm run test:e2e`
  - default deterministic local browser coverage across smoke, regression,
    and Phase-2 projects
- `npm run test:e2e:regression`
  - focused regression-only lane without the smoke project
- `npx playwright test --project=phase2`
  - focused Phase-2 detection lane; this project is also included in the
    default `npm run test:e2e` command
- `npm run test:e2e:rollback`
  - rollback/recovery behavior that is deterministic enough to run regularly but still separate from the default lane
- `npm run test:e2e:live`
  - live-web sanity checks only
- `npm run test:e2e:stress`
  - timing edge cases, state isolation, and worker lifecycle scenarios
- `npm run test:e2e:corpus`
  - validation against real phishing page snapshots (requires local download via `node scripts/fetch-phishing-corpus.mjs`)
- `npm run measure:fp`
  - false positive measurement against Tranco top-1000 sites
- `npm run demo:showcase`
  - stable guided headed walkthrough of the merged-main `core` demo variant
- `npm run demo:showcase:operator`
  - popup/options heavy walkthrough using the real browser-action popup
- `npm run demo:showcase:recovery`
  - redirect and recovery-prompt focused walkthrough using fresh-page recovery chapters
- `npm run demo:showcase:record`
  - the same `core` cut with deterministic video-capture defaults for recording
- `node scripts/run_demo.mjs core --fast`
  - faster dry-run pacing while editing demo copy or chapter flow
- `node scripts/run_demo.mjs core --record --trace`
  - record mode plus an explicit trace artifact for deeper inspection

## Gym map

The Gym index is at `gym/index.html`.

Current pages:

- `gym/level1-basic-opacity.html`
- `gym/level2-moving-target.html`
- `gym/level3-instant-injection.html`
- `gym/level4-visual-mimicry.html`
- `gym/level5-window-open-popunder.html`
- `gym/level6-programmatic-click.html`
- `gym/level7-legit-modal-backdrop.html`
- `gym/level8-legit-oauth-popup.html`
- `gym/level9-legit-video-overlay.html`
- `gym/level10-redirects-and-forms.html`
- `gym/level11-credential-guard.html`
- `gym/level12-slow-same-tab-link.html`
- `gym/rw01-search-result-overlay-swap.html`
- `gym/rw03-delayed-redirect-landing.html`
- `gym/rw03-final-report.html`
- `gym/rw04-open-redirect-landing.html`
- `gym/rw04-local-redirector.html`
- `gym/rw04-final-offer.html`
- `gym/rw06-legit-auth-second-popup.html`
- `gym/rw07-fake-reauth-interstitial.html`
- `gym/rw08-window-reuse-laundering.html`
- `gym/rw08-consent-popup.html`
- `gym/rw08-laundered-destination.html`
- `gym/rw09-target-ambiguity.html`
- `gym/rw09-consent-step1.html`
- `gym/rw09-consent-step2.html`
- `gym/rw09-phish-target.html`
- `gym/rw10-keyboard-auth-launch.html`
- `gym/rw10-consent-popup.html`
- `gym/rw11-fake-invoice-approval.html`
- `gym/rw11-unrelated-payout.html`
- `gym/rw12-wallet-connect-burst.html`
- `gym/rw12-wallet-connect-popup.html`
- `gym/rw12-wallet-drain-popup.html`
- `gym/rw13-courier-tracking-login.html`
- `gym/rw14-checkout-express-pay-overlay.html`
- `gym/rw14-membership-upsell.html`
- `gym/rw15-bank-security-alert.html`
- `gym/rw15-bank-verify-transaction.html`
- `gym/rw16-fake-document-preview-overlay.html`
- `gym/rw16-unrelated-open.html`
- `gym/rw17-media-overlay-hijack.html`
- `gym/rw17-ad-landing.html`
- `gym/rw18-browser-update-warning.html`
- `gym/rw18-installer-download.html`
- `gym/rw19-tech-support-scare.html`
- `gym/rw19-remote-support.html`
- `gym/rw20-chat-widget-abuse.html`
- `gym/rw20-chat-popup.html`
- `gym/rw20-remote-tool.html`
- `gym/rw21-allow-once-double-spend.html` (+ `rw21-settings-popup.html`, `rw21-exfil-popup.html`)
- `gym/rw22-rollback-worker-restart.html` (+ `rw22-order-status.html`, `rw22-phish-landing.html`)
- `gym/rw23-multi-tab-prompts.html` (+ `rw23-tab-a.html`, `rw23-tab-a-popup.html`, `rw23-tab-b.html`, `rw23-tab-b-popup.html`)
- `gym/rw24-idle-resume-popup.html` (+ `rw24-stale-popup.html`)
- `gym/rw25-rapid-close-reopen.html` (+ `rw25-churn-popup.html`, `rw25-exfil-popup.html`)
- `gym/evasion-01-opacity-009.html` through `gym/evasion-11-shadow-dom.html` (CDS evasion red-team fixtures)
- `gym/clickfix-01-basic.html` (fake CAPTCHA overlay with clipboard write + Win+R instructions)
- `gym/clickfix-02-instructions.html` (dark-themed terminal instructions variant)
- `gym/clickfix-03-legit-captcha.html` (legitimate reCAPTCHA + OTP copy, false positive check)
- `gym/doubleclick-01-basic.html` (+ `doubleclick-01-target.html`) -- basic DoubleClickjacking attack simulation
- `gym/doubleclick-02-oauth.html` (+ `doubleclick-02-consent.html`) -- OAuth consent DoubleClickjacking variant
- `gym/doubleclick-03-legit.html` -- legitimate double-click interaction (false-positive check)

Every current primitive Gym level has a dedicated automated path, and the real-world scenario waves
are continuing to land alongside those primitives.

### ClickFix detection lane

ClickFix fixtures test detection of fake CAPTCHA overlays that write malicious commands to the
clipboard and instruct users to paste them into Run dialogs or terminals. The legitimate CAPTCHA
fixture (`clickfix-03`) verifies that real CAPTCHA providers (reCAPTCHA, hCaptcha, Turnstile)
suppress ClickFix detection to avoid false positives.

### Evasion red-team lane

CDS evasion fixtures test gradient scoring and composite escalation against near-threshold signals:
opacity just above threshold, viewport coverage just below, labeled overlays, z-index boundaries,
composite multi-signal evasion, delayed injection, pointer-events bypass, clip-path hiding,
filter opacity, transform scale, shadow DOM hiding, and stacked foreground overlays.
Run with the default E2E lane. Tests: `tests/e2e/evasion.spec.ts`.

### Stress lane

The stress lane exercises timing edge cases, state isolation, and worker lifecycle scenarios.
Run with `npm run test:e2e:stress`. Config: `playwright.stress.config.ts`.
Tests: `tests/e2e/navsentinel.stress.spec.ts`.

### Phishing corpus lane

Tests NavSentinel against HTML snapshots of real phishing pages downloaded from OpenPhish
and PhishTank feeds. Measures true positive and false negative rates. Requires local
snapshot download before running.
Run with `npm run test:e2e:corpus`. Config: `playwright.corpus.config.ts`.
Tests: `tests/e2e/corpus-validation.spec.ts`.

### False positive measurement

Visits Tranco top-1000 sites with NavSentinel loaded to measure false positive rate.
Run with `npm run measure:fp`. Script: `scripts/measure-fp.mjs`.

## Effective manual testing workflow

1. Run `npm run build`.
2. Load `extension/dist` into Chromium.
3. Start `npm run gym:serve`.
4. Open the Gym index page.
5. Run the relevant level in `smart` mode first.
6. Repeat in `strict` mode if you are tuning heuristics.
7. Review popup and options-page state after the scenario.
8. Clear the event log between scenarios when you want clean comparisons.

## What to verify after changes

### For navigation changes

- no unexpected new tabs survive
- prompt text remains actionable
- allow-once replays the blocked action only once
- always-allow stores the correct site/destination pair
- rollback affordances still appear for suspicious redirects, and explicit proceed remains available
- stale per-tab allowances do not leak into later navigations

### For credential changes

- trusted HTTPS submits do not prompt unnecessarily
- risky HTTP, cross-site, or lookalike submits prompt
- trust actions add the correct registrable domain
- paste warnings do not expose clipboard contents
- event logs contain score and reason codes

### For popup and options changes

- mode selectors persist after reload
- trusted-domain actions update storage correctly
- event-log rendering still works
- import/export preserves normalized state
- allowlist removal and clearing still work

## CI expectations

CI currently runs on every PR:

- `npm run verify:versions`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run check:release-profile -- --release`
- `npm run build:research-reputation`
- `npm run package:ext`
- `xvfb-run -a npm run test:e2e`

The CI E2E job runs serially (`workers: 1`, `fullyParallel: false`); see
"Worker topology" above for why local runs now match it.

The stress lane (`npm run test:e2e:stress`) runs on a nightly schedule.
The corpus and FP measurement lanes run manually (they require local data).

If E2E fails in CI, check these first:

- `npm run build` actually produced `extension/dist`
- Playwright discovery is still limited to `tests/e2e`
- the E2E specs are still using the shared extension helpers
- the change did not break DOM readiness markers or shadow-root toast assertions

## Current evidence work

As measured on 2026-08-07 at `main` (`332c48d`) with
`npx vitest run --reporter=dot`, the local regression baseline is 3,010 passing
unit tests in 100 files, and 14 Playwright spec files are present under
`tests/e2e/`. The previous figure in this paragraph (2,874 tests in 95 files,
2026-07-10) was stale. These counts are volatile engineering snapshots: verify
them live before reuse and keep them out of user-facing copy. Regression
coverage does not establish efficacy.

The next evidence steps are:

- fix RI-01 and the remaining release-integrity blockers before exposing users to the beta;
- finish the corpus-v2 methodology under #417, then rerun through #416/#426;
- run the pre-registered benign journeys and descriptive top-1000 lane; and
- build #418 against current browser-native and extension protections.

The historical 0.72% FP run and 28% corpus result are stale or methodologically
invalid. Preserve them as dated diagnostics, not completed milestones. Do not
tune toward a `<0.1%` claim until the methodology, sample size, and confidence
interval support it.
