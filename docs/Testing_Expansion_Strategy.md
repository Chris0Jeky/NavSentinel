# Testing Expansion Strategy

## Purpose
Expand NavSentinel's automated testing from a small starter suite into a layered test system that catches:

- security regressions
- false positives on legitimate UI
- MV3 service-worker lifecycle bugs
- timing and burst-behavior failures that only show up under stress

The goal is not "more tests" in the abstract. The goal is a suite that stays fast enough for pull requests, gets much more realistic about attacker behavior, and has a heavier lane for churn and soak coverage.

## Current state

- Automated coverage in this checkout is concentrated in a single Playwright spec: `tests/e2e/navsentinel.spec.ts`.
- The Gym already contains fixtures for Levels 1 through 10, but automation only covers a subset of them.
- There is no root `playwright.config.ts`, no project split for smoke vs stress, and no common Playwright fixture layer.
- There are no root `*.test.ts` unit or property tests in this checkout.
- Current E2E assertions still rely heavily on plain page text, while the toast UI renders in a shadow root.

This means the repo currently has enough coverage to prove the core concept works, but not enough to reliably protect the behavior under timing pressure, multi-step navigation, or false-positive-sensitive legitimate flows.

## What "good" looks like

NavSentinel should have four test lanes:

| Lane | Goal | Runtime target | Runs |
| --- | --- | --- | --- |
| Smoke | Catch obvious breakage fast | 2 to 4 min | Every PR |
| Regression | Cover core Gym and settings flows | 5 to 10 min | Every PR or required branch |
| Stress | Repeated, bursty, timing-heavy scenarios | 10 to 20 min | Nightly or opt-in CI |
| Live canary | Real-site sanity checks | manual / scheduled only | Never required for merge |

The fastest lane should stay deterministic and local. The heavier lanes should be allowed to run longer, serially where needed, with better artifacts on failure.

## Principles

- Keep most PR feedback local and deterministic. Prefer local Gym fixtures over live websites.
- Separate security coverage from legitimate-behavior coverage. Both are first-class requirements.
- Prefer pure-function and model/state tests for edge exploration before reaching for full browser runs.
- Treat MV3 worker churn as a feature of the platform, not an edge case.
- Add observability to tests: traces, screenshots, worker logs, tab counts, and explicit extension-ready checks.
- Every bug fix should land with a deterministic regression test in the lowest-cost layer that can prove it.

## Recommended suite shape

### 1. Unit and property tests

Primary targets:

- `extension/src/shared/scoring.ts`
- `extension/src/content/dom_builder.ts`
- `extension/src/shared/stateMachine.ts`

These modules are the best low-cost seam for exhaustive and generated coverage.

Recommended additions:

- Add `fast-check` for property-based tests. Its docs explicitly note that it works with Vitest and other runners.
- Add fake-timer tests around the `800ms` token window in `stateMachine.ts`.
- Add invariant-style tests for `computeCDS()`:
  - score is never negative
  - keyboard activation is never riskier than the same pointer scenario
  - invisible clickable overlays remain suspicious
  - legitimate modal backdrop hints reduce suspicion
- Add generated DOM-hint tests for `dom_builder.ts` and `scoring.ts`:
  - size, opacity, z-index, pointer-events, target blank, label/text presence
  - retargeted vs non-retargeted click paths
  - middle-click / ctrl-click / meta-click intent

This layer should become the main edge-case battery because it is cheap enough to run at high volume.

### 2. State-model tests for navigation policy

Primary target:

- `extension/src/sw/sw.ts`

The service worker holds the highest-value mutable policy state:

- `allowUntilByTab`
- `suppressUntilByTab`
- `readyTabs`
- `pendingRollbackByTab`
- `pendingForwardByTab`
- `lastUrlByTab`
- `lastCommittedByTab`

Recommended refactor:

- Extract the per-tab policy transitions into a small pure module or reducer-like helper.
- Keep Chrome API wiring in `sw.ts`, but move decision/state transitions into code that can be unit-tested.

Recommended model checks:

- tab removal clears all tracked state
- expired allow windows do not survive into later commits
- rollback prompts do not survive tab close or unrelated navigation
- pending forward offers clear when the page moves elsewhere
- suppression windows do not leak between tabs

This is the best place to simulate long sequences without paying browser startup cost for every permutation.

### 3. Deterministic Playwright regression tests

Recommended first harness changes:

- Add `playwright.config.ts`.
- Split projects or tags into `smoke`, `regression`, `stress`, and `live`.
- Extract a shared extension fixture from `tests/e2e/navsentinel.spec.ts`:
  - Gym server lifecycle
  - extension boot and readiness checks
  - persistent Chromium context creation
  - service-worker handle lookup
  - shadow-toast assertions
  - tab-count and stray-page helpers

The Playwright docs explicitly support `chromium.launchPersistentContext(...)` for Chrome extension testing and show how to retrieve the MV3 service worker. The docs also recommend projects for running different groups of tests with different retries and timeouts.

Recommended cleanup of existing tests:

- Replace brittle `locator("text=...")` checks with helpers that inspect the toast shadow root.
- Move repeated extension bootstrap into fixtures.
- Make smoke tests assert both the user-visible signal and the browser-side effect:
  - blocked toast or prompt is shown
  - no unwanted tab survived
  - expected tab count remains stable

### 4. Stress and soak tests

Stress tests should deliberately repeat scenarios that are currently only checked once.

Best initial stress targets:

- repeated `window.open` bursts from one gesture
- repeated delayed redirects with rollback prompt
- repeated allow-once followed by second unwanted open
- repeated open-close tab churn to flush stale worker state
- idle periods long enough to allow MV3 worker shutdown, followed by resumed interaction

Chrome's MV3 lifecycle docs state that an extension service worker is normally terminated after `30 seconds` of inactivity and should be resilient to unexpected termination. That justifies a dedicated soak lane instead of assuming short happy-path tests are enough.

Recommended soak rules:

- run serially
- trace on failure
- keep videos/screenshots only on failure
- collect service-worker console output where feasible
- avoid live external sites in this lane

## Scenario expansion plan

### Fill the current Gym gaps first

Add deterministic E2E coverage for the existing pages that are already present but under-tested:

- Level 2 moving target
- Level 3 instant injection
- Level 4 visual mimicry
- Level 7 legitimate modal backdrop
- Level 8 legitimate OAuth popup
- Level 9 legitimate video overlay

Why this first:

- the fixtures already exist
- these cover both attacker behavior and false-positive-sensitive legitimate UX
- they will quickly expose where the scoring model is too loose or too aggressive

### Add new elaborate Gym scenarios

After the current gaps are closed, add a second wave of more realistic pages:

- multi-popup burst from one gesture
- delayed popup after a microtask / promise chain
- redirect-then-form chain
- reload during prompt
- back/forward recovery after rollback
- nested iframe or double-frame clickjacking simulation
- multi-tab fanout from one source page
- keyboard-only activation and accessibility-driven legitimate flows

These should mimic attacker sequencing rather than single isolated events.

### Add "real case" simulations without live-web flake

Prefer local or replayed simulations over internet-dependent tests:

- local OAuth-like flow with popup, callback, and close
- local payment-like confirmation step with a critical action behind an overlay
- HAR-backed network replay for realistic but deterministic multi-request pages

Playwright supports HAR replay through `page.routeFromHAR()` and `browserContext.routeFromHAR()`, which is useful when a scenario needs realistic network behavior without depending on a live third-party site.

## Recommended repo changes

### New files

- `playwright.config.ts`
- `tests/e2e/fixtures/navsentinel.ts`
- `tests/e2e/helpers/gym.ts`
- `tests/e2e/helpers/extension.ts`
- `tests/e2e/helpers/toast.ts`
- `tests/property/scoring.property.test.ts`
- `tests/property/dom_builder.property.test.ts`
- `tests/unit/state_machine.test.ts`
- `tests/unit/sw_policy.test.ts`

### New scripts

- `test:e2e:smoke`
- `test:e2e:regression`
- `test:e2e:stress`
- `test:e2e:live`
- `test:property`

### Suggested tool additions

- `fast-check`
- `jsdom` if needed for isolated DOM-heavy unit tests

## CI strategy

### Pull requests

- run unit/property tests
- run `smoke` Playwright project
- optionally run a smaller `regression` subset on protected branches
- enable traces on failure

### Main branch / nightly

- run full `regression`
- run `stress` serially
- include longer idle / churn cases for service-worker restart resilience

### Manual or scheduled canary

- run `live` tests against carefully chosen public flows
- do not block merges on them
- use them as signal, not as gating truth

## Execution order

### Phase 1: harness foundation

- add `playwright.config.ts`
- extract shared extension fixtures
- add shadow-toast assertions
- refactor current `navsentinel.spec.ts` onto the fixture layer

Definition of done:

- current E2Es still pass
- one command runs the smoke suite
- failures produce usable traces

### Phase 2: close known coverage gaps

- automate Levels 2, 3, 4, 7, 8, and 9
- add multi-popup regression
- add tab-count and no-stray-tab assertions across popup-related cases

Definition of done:

- all existing Gym levels have at least one automated assertion path
- legitimate modal/video/OAuth flows are explicitly protected from false positives

### Phase 3: build low-cost edge coverage

- add property tests for scoring and DOM hint building
- add fake-timer tests for token expiry
- extract and test service-worker policy transitions

Definition of done:

- the highest-risk decision code is covered without needing a browser
- timing boundaries have deterministic tests

### Phase 4: add elaborate simulations and soak

- add second-wave Gym pages
- add churn/idle/worker-restart stress runs
- add HAR-backed realistic scenario pages where helpful

Definition of done:

- extension behavior survives repeated state churn
- CI has a deliberate lane for long-tail timing bugs

## Success metrics

- smoke suite remains under 4 minutes
- each known threat category has at least one deterministic automated test
- each legitimate-flow category has at least one explicit false-positive regression
- stress suite can repeat critical popup/redirect cases dozens of times without stale state leakage
- every production bug gets a regression test in the cheapest viable layer

## Immediate recommendation

If starting now, the first three PRs should be:

1. Playwright harness extraction plus `playwright.config.ts`
2. Coverage for Levels 2, 3, 4, 7, 8, and 9
3. Property tests for `scoring.ts`, `dom_builder.ts`, and `stateMachine.ts`

That sequence gives the fastest improvement in signal without immediately taking on the harder service-worker refactor.

## External references

- Playwright Chrome extensions guide: https://playwright.dev/docs/chrome-extensions
- Playwright projects: https://playwright.dev/docs/test-projects
- Playwright retries: https://playwright.dev/docs/test-retries
- Playwright trace viewer: https://playwright.dev/docs/trace-viewer
- Playwright mock APIs and HAR replay: https://playwright.dev/docs/mock
- Playwright locator guidance: https://playwright.dev/docs/locators
- Chrome extension service-worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- OWASP Web Security Testing Guide, clickjacking testing: https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/11-Client-side_Testing/09-Testing_for_Clickjacking
- fast-check docs: https://fast-check.dev/
