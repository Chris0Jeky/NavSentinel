# Contributing

This repo is best worked on as a browser-extension project with deterministic local fixtures. The fastest way to make good changes is to keep a Gym page, a focused test, and a small code change aligned.

## Environment

- Node.js `^20.19.0 || ^22.13.0 || >=24` (the `package.json` engine range)
- Chrome or Chromium for MV3 testing

## Install and build

```bash
npm install
npm run build
```

Load `extension/dist` in `chrome://extensions` with Developer Mode enabled.
This is the release-eligible `interaction-only` profile. Use
`npm run build:research-reputation` only for an unpacked local experiment; it
cannot be packaged or released.

## Core workflows

```bash
npm run watch
npm run test
npm run test:e2e
npx tsc -p tsconfig.json --noEmit
npm run verify:versions
npm run package:ext
npm run gym:serve
```

## Effective contribution workflow

1. Reproduce the issue in the Gym or with an existing test.
2. Decide whether the change belongs in navigation logic, credential logic, storage, popup/options UI, or service-worker state.
3. Make the smallest coherent code change.
4. Add or update the relevant unit or E2E test.
5. Run the narrowest useful checks first, then the broader suite before pushing.
6. Update docs when behavior, settings, commands, or workflows changed.

## Claims and evidence

Security-product claims are part of the implementation and receive the same
review discipline as code.

**Verified-claims policy.** No user-facing protection claim ships without a
committed measurement artifact or a CI-verified fixture behind it. Design
intent, a merged PR, an issue title, or a green local run that leaves nothing
committed are not evidence; if no artifact or CI-verified fixture exists, narrow
the claim to what is actually proven or drop it until the evidence lands. The
same rule governs `docs/Project_Roadmap.md`: a gate checkbox is checked only
when that task's own **Done when** text is literally true today. A partially met
gate stays unchecked and carries a dated note recording what is still missing,
rather than being checked with a caveat.

- Describe a capability as shipped only when its production path and production
  asset are enabled in the packaged release. A placeholder, test fixture,
  never-firing path, or experimental toggle is not a shipped protection.
- Separate **implemented**, **regression-tested**, **measured**, **externally
  reviewed**, and **released**. Do not use one as shorthand for another.
- Comparative, efficacy, false-positive, performance, and privacy claims need a
  dated source or reproducible artifact. Include sample size, environment, and
  limitations; use confidence intervals for rate claims.
- Do not claim "only", "no competitor", "browsers cannot see", or superiority
  without a current comparative review. Browser and extension capabilities are
  time-sensitive.
- Keep exact test/signal/fixture counts out of public copy unless release tooling
  generates and verifies them.
- `docs/cws-listing/STORE_LISTING.md` is the single store-copy source. The root
  `docs/STORE_LISTING.md` is only a pointer.
- Every release claim must be checked against the exact packaged artifact during
  release review. If evidence is absent, narrow the claim rather than projecting
  planned behavior.

## Where to change things

- navigation scoring and click decisions
  - `extension/src/content/capture_isolated.ts`
  - `extension/src/shared/scoring.ts`
  - `extension/src/shared/nrs.ts`
- release-profile and reputation research
  - `config/release-profiles.json`
  - `scripts/check-release-profile.mjs`
  - `extension/src/shared/reputation.ts`
  - `scripts/build-bloom-filter.mjs`
- ClickFix / fake CAPTCHA detection
  - `extension/src/content/clickfix_detector.ts`
- main-world popup/redirect/form/clipboard enforcement
  - `extension/src/content/main_guard.ts`
- credential risk and prompts
  - `extension/src/content/credential_guard.ts`
  - `extension/src/content/credential_modal.ts`
  - `extension/src/shared/domain.ts`
- storage and persistence
  - `extension/src/shared/storage.ts`
  - `extension/src/shared/allowlist.ts`
- popup and options UI
  - `extension/src/popup/*`
  - `extension/src/options/*`
  - `extension/src/onboarding/*`
- design system (shared tokens, icons, typography)
  - `extension/src/shared/design_tokens.css`
  - `extension/src/shared/icons.ts`
- rollback and service-worker navigation state
  - `extension/src/sw/sw.ts`

## Adding a Gym case

1. Add a focused HTML fixture under `gym/`.
2. Link it from `gym/index.html`.
3. Add or extend a Playwright spec under `tests/e2e/`.
4. Keep the case deterministic, local, and explainable.
5. Prefer one scenario per page instead of a grab-bag page with many unrelated behaviors.

## Style expectations

- prefer small, testable modules
- keep content-script work bounded to the interaction being evaluated
- preserve explainability with reason codes and event-log coverage
- avoid network behavior and data exfiltration
- be careful with main-world patching and message-bridge assumptions
