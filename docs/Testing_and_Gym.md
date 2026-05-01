# Testing and Gym

## Goals

Testing in this repo is meant to answer two questions:

1. Does the extension still catch the behaviors it claims to catch?
2. Did a change accidentally make the extension too noisy, too permissive, or too stateful under churn?

The project uses a mix of deterministic Gym pages, Vitest unit tests, and Playwright-driven browser tests.

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

### Playwright E2E

Current E2E coverage lives in:

- `tests/e2e/navsentinel.spec.ts`
- `tests/e2e/credential-guard.spec.ts`
- `tests/e2e/suite-ui.spec.ts`
- `tests/e2e/evasion.spec.ts`
- `tests/e2e/navsentinel.stress.spec.ts`
- `tests/e2e/corpus-validation.spec.ts`

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
- options import/export round-trip behavior
- a dedicated rollback lane for redirect recovery affordances
- RW-15 bank/security alert redirect recovery
- a dedicated live-web sanity lane

`playwright.config.ts` intentionally scopes Playwright discovery to `tests/e2e/**/*.spec.ts`. This keeps Vitest files out of the Playwright runner.

Current lane intent:

- `npm run test:e2e:smoke`
  - shortest deterministic browser checks
- `npm run test:e2e`
  - default deterministic local browser coverage across smoke and regression
- `npm run test:e2e:regression`
  - focused regression-only lane without the smoke project
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
filter opacity, transform scale, and shadow DOM hiding.
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
- `npm run package:ext`
- `xvfb-run -a npm run test:e2e`

The stress lane (`npm run test:e2e:stress`) runs on a nightly schedule.
The corpus and FP measurement lanes run manually (they require local data).

If E2E fails in CI, check these first:

- `npm run build` actually produced `extension/dist`
- Playwright discovery is still limited to `tests/e2e`
- the E2E specs are still using the shared extension helpers
- the change did not break DOM readiness markers or shadow-root toast assertions

## What is still outstanding

From the testing perspective, the clearest next steps are:

- run the FP measurement against Tranco top-1000 and record baseline rate (infrastructure exists, actual run pending)
- run the phishing corpus validation to establish baseline TP/FN rates
- add gym fixtures for remaining Phase 2 detections (DoubleClickjacking, redirect chains, DOM mutation) — ClickFix fixtures are done
- build competitive benchmark suite comparing NavSentinel against Safe Browsing alone
