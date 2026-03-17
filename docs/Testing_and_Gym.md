# Testing and Gym

## Goals

Testing in this repo is meant to answer two questions:

1. Does the extension still catch the behaviors it claims to catch?
2. Did a change accidentally make the extension too noisy or too permissive?

The project uses a mix of deterministic Gym pages, unit tests, and Playwright-driven browser tests.

## Local commands

```bash
npm install
npm run build
npm run test
npm run test:e2e
npx tsc -p tsconfig.json --noEmit
```

To run the local Gym server:

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

It verifies core credential heuristics such as:

- multipart public suffix handling
- mixed-script hostname detection
- lookalike-domain comparison
- high-severity scoring for clearly risky submits

### Playwright E2E

Current E2E coverage lives in:

- `tests/e2e/navsentinel.spec.ts`
- `tests/e2e/credential-guard.spec.ts`

It covers:

- Level 1 new-tab blocking
- Level 5 popunder blocking
- Level 6 programmatic click blocking
- Level 10 delayed form submit prompt
- Level 10 rollback flow behind an env gate
- Level 11 credential-submit prompt
- an optional live-web sanity check behind an env gate

`playwright.config.ts` intentionally scopes Playwright discovery to `tests/e2e/**/*.spec.ts`. This avoids loading Vitest unit files during E2E runs.

## Gym map

The Gym index is at `gym/index.html`.

Important current pages:

- `gym/level1-basic-opacity.html`
  - basic deceptive overlay/new-tab case
- `gym/level5-window-open-popunder.html`
  - scripted popup/popunder case
- `gym/level6-programmatic-click.html`
  - programmatic click / retargeted navigation case
- `gym/level10-redirects-and-forms.html`
  - delayed redirect and delayed submit cases
- `gym/level11-credential-guard.html`
  - risky password-submit prompt case

## Effective manual testing workflow

1. Run `npm run build`.
2. Load `extension/dist` into Chromium.
3. Start `npm run gym:serve`.
4. Open the Gym index page.
5. Run the relevant level in `smart` mode first.
6. Repeat in `strict` mode if you are tuning heuristics.
7. Review the popup and options-page event log after each run.
8. Clear logs between scenarios when you want clean comparisons.

## What to verify after changes

### For navigation changes

- no unexpected new tabs open
- prompt text remains actionable
- allow-once replays the blocked action only once
- always-allow stores the correct site/destination pair
- rollback still returns to the prior page and offers explicit proceed

### For credential changes

- password submits on trusted HTTPS domains do not prompt unnecessarily
- risky HTTP or lookalike submits prompt
- trust actions add the correct registrable domain
- paste warnings do not expose clipboard contents
- event logs contain score and reason codes

## CI expectations

CI currently runs:

- version verification
- unit tests
- build
- packaging
- Playwright E2E under `xvfb-run`

If E2E fails in CI, check these first:

- `npm run build` actually produced `extension/dist`
- Playwright discovery is still limited to `tests/e2e`
- the E2E specs do not import Vitest globals or non-E2E helpers unintentionally
