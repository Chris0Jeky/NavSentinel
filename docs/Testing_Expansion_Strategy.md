# Testing Expansion Strategy

## Purpose

Expand NavSentinel's automated testing from the current merged baseline into a layered system that catches:

- security regressions
- false positives on legitimate UI
- MV3 service-worker lifecycle bugs
- timing and burst-behavior failures that only show up under stress

The goal is not "more tests" in the abstract. The goal is better signal with clearer test lanes and more realistic attacker and legitimate-flow coverage.

## Current baseline

The merged `main` branch already has a solid starter harness:

- `playwright.config.ts` is present and scopes E2E discovery correctly
- shared Playwright helpers exist in `tests/e2e/extension_test_utils.ts`
- unit coverage exists for storage, popup modeling, credential-domain logic, credential-guard modeling, and service-worker rollback behavior
- Playwright coverage exists for navigation Gym levels 1, 5, 6, 10, and 12, credential flows in Level 11, and options import/export workflows
- the Gym now contains Levels 1 through 12

That means the repo is no longer missing basic E2E infrastructure. The current problem is coverage breadth and depth.

## What "good" looks like

NavSentinel should have four test lanes:

| Lane | Goal | Runtime target | Runs |
| --- | --- | --- | --- |
| Smoke | Catch obvious breakage fast | 2 to 4 min | Every PR |
| Regression | Cover core Gym and settings flows | 5 to 10 min | Every PR or protected branch |
| Stress | Repeated, bursty, timing-heavy scenarios | 10 to 20 min | Nightly or opt-in CI |
| Live canary | Real-site sanity checks | manual / scheduled only | Never required for merge |

The deterministic local Gym should stay the primary truth source. Live-web tests should remain advisory only.

## Current gaps

### 1. Missing Gym automation

These pages already exist but do not yet have dedicated Playwright coverage:

- Level 2 moving target
- Level 3 instant injection
- Level 4 visual mimicry
- Level 7 legitimate modal backdrop
- Level 8 legitimate OAuth popup
- Level 9 legitimate video overlay

This is the most obvious shortfall because it leaves both attacker and legitimate-flow cases unguarded by automation even though the fixtures are already there.

### 2. Limited false-positive protection

Current E2E coverage is stronger on blocking than on proving legitimacy. The biggest missing cases are:

- legitimate modal/backdrop interaction
- legitimate OAuth popup behavior
- legitimate video overlay behavior
- more nuanced trusted-domain and allowlist operator paths

### 3. No dedicated stress lane

The repo does not yet have a separate stress or soak lane for:

- repeated `window.open` bursts
- repeated delayed redirects with rollback
- tab churn and worker-state cleanup
- idle periods long enough to let MV3 service workers restart

### 4. Scoring/state edge exploration is still shallow

There are useful unit tests today, but we still do not have:

- property tests for `extension/src/shared/scoring.ts`
- generated DOM-hint tests for `extension/src/content/dom_builder.ts`
- fake-timer tests for `extension/src/shared/stateMachine.ts`
- a more explicit reducer-like test seam for service-worker policy transitions

## Recommended suite shape

### 1. Keep the current harness and split test lanes deliberately

Add script-level or project-level separation for:

- `test:e2e:smoke`
- `test:e2e:regression`
- `test:e2e:stress`
- `test:e2e:live`

The shared E2E helpers that already exist should remain the single place for:

- extension boot and readiness checks
- Gym server lifecycle
- service-worker lookup
- shadow-toast assertions
- future tab-count and stray-page helpers

### 2. Fill the current Gym gaps first

Before inventing new fixtures, automate the pages that already exist:

- Level 2 moving target
- Level 3 instant injection
- Level 4 visual mimicry
- Level 7 legitimate modal backdrop
- Level 8 legitimate OAuth popup
- Level 9 legitimate video overlay

Why this comes first:

- the fixtures already exist
- they cover both attacker behavior and false-positive-sensitive legitimate UX
- they will expose where scoring or prompt logic is too loose or too aggressive

### 3. Add low-cost edge coverage

Primary targets:

- `extension/src/shared/scoring.ts`
- `extension/src/content/dom_builder.ts`
- `extension/src/shared/stateMachine.ts`
- the worker-policy logic in `extension/src/sw/sw.ts`

Recommended additions:

- add `fast-check` for property-based tests
- add fake-timer tests around token windows and worker TTL behavior
- add invariant checks for CDS and credential-risk scoring
- consider extracting pure policy transitions from `sw.ts` if the current test seam becomes too awkward

### 4. Add stress and soak coverage

Best initial stress targets:

- repeated popup bursts from one gesture
- repeated delayed redirects with rollback offers
- repeated allow-once followed by a second blocked action
- tab open/close churn to flush stale worker state
- idle and resume sequences long enough to simulate MV3 worker restart behavior

These should run serially, capture traces on failure, and stay local.

## Proposed execution order

### Phase 1: close the obvious Gym gaps

- automate Levels 2, 3, 4, 7, 8, and 9
- add stronger tab-count and no-stray-tab assertions where popup behavior is involved

Definition of done:

- every current Gym level has at least one automated assertion path
- legitimate modal/video/OAuth flows are explicitly protected from false positives

### Phase 2: strengthen low-cost heuristics coverage

- add property tests for scoring and DOM hint building
- add fake-timer tests for token expiry and policy TTL boundaries
- tighten worker-policy tests around cleanup and reuse boundaries

Definition of done:

- the highest-risk decision code is covered without needing a browser
- timing boundaries have deterministic tests

### Phase 3: introduce a real stress lane

- add burst, churn, and idle/resume scenarios
- separate them from the default PR lane
- keep detailed artifacts only on failure

Definition of done:

- CI has a deliberate place for long-tail timing bugs
- repeated popup/redirect cases can be exercised many times without stale state leakage

## Suggested new scripts

- `test:e2e:smoke`
- `test:e2e:regression`
- `test:e2e:stress`
- `test:e2e:live`
- `test:property`

## Immediate recommendation

If starting the next tranche now, the first three PRs should be:

1. automate Levels 2, 3, 4, 7, 8, and 9
2. add property/fake-timer tests for scoring, DOM hints, and state timing
3. split out a stress lane with worker-churn and popup-burst scenarios

That sequence gives the best coverage gain without immediately taking on a broader architectural refactor.

## Success metrics

- every current Gym level has at least one deterministic automated path
- each legitimate-flow category has at least one explicit false-positive regression
- smoke stays comfortably fast for PR use
- stress can repeat critical popup/redirect cases many times without stale-state leaks
- every bug fix lands with a regression test in the cheapest viable layer

## References

- Playwright Chrome extensions guide: https://playwright.dev/docs/chrome-extensions
- Playwright projects: https://playwright.dev/docs/test-projects
- Playwright trace viewer: https://playwright.dev/docs/trace-viewer
- Playwright mock APIs and HAR replay: https://playwright.dev/docs/mock
- Chrome extension service-worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- OWASP Web Security Testing Guide, clickjacking testing: https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/11-Client-side_Testing/09-Testing_for_Clickjacking
- fast-check docs: https://fast-check.dev/
