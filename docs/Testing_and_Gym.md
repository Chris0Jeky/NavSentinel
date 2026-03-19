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

These currently cover:

- trusted-domain normalization and registrable-domain handling
- credential-risk heuristics and model behavior
- popup event formatting and limit handling
- storage import/export, settings migration, and normalization paths
- service-worker rollback, gesture-window, and target-allowance behavior

### Playwright E2E

Current E2E coverage lives in:

- `tests/e2e/navsentinel.spec.ts`
- `tests/e2e/credential-guard.spec.ts`
- `tests/e2e/suite-ui.spec.ts`

It currently covers:

- Level 1 new-tab blocking
- Level 2 moving-target overlay blocking
- Level 3 instant injection deceptive-click blocking
- Level 4 visual-mimicry disguised new-tab blocking
- Level 5 popunder blocking
- Level 6 programmatic click blocking
- Level 10 delayed form-submit prompt
- Level 12 slow same-tab navigation legitimacy
- Level 11 credential-submit prompt
- password-paste warning and trusted-domain persistence
- options-page trusted-domain normalization
- options import/export round-trip behavior
- a dedicated rollback lane for redirect recovery affordances
- a dedicated live-web sanity lane

`playwright.config.ts` intentionally scopes Playwright discovery to `tests/e2e/**/*.spec.ts`. This keeps Vitest files out of the Playwright runner.

Current lane intent:

- `npm run test:e2e:smoke`
  - shortest deterministic browser checks
- `npm run test:e2e`
  - default regression lane for local deterministic browser coverage
- `npm run test:e2e:regression`
  - explicit alias for the same regression lane
- `npm run test:e2e:rollback`
  - rollback/recovery behavior that is deterministic enough to run regularly but still separate from the default lane
- `npm run test:e2e:live`
  - live-web sanity checks only

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

The biggest current automation gap is that Levels 7, 8, and 9 exist but do not yet have dedicated Playwright coverage.

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

CI currently runs:

- `npm run verify:versions`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run package:ext`
- `xvfb-run -a npm run test:e2e`

If E2E fails in CI, check these first:

- `npm run build` actually produced `extension/dist`
- Playwright discovery is still limited to `tests/e2e`
- the E2E specs are still using the shared extension helpers
- the change did not break DOM readiness markers or shadow-root toast assertions

## What is still outstanding

From the testing perspective, the clearest next steps are:

- automate the remaining Gym levels
- add a heavier stress lane for worker churn, repeated popup bursts, and delayed navigation chains
- add lower-cost property/state tests for scoring, DOM hint building, and tab-scoped worker policy
