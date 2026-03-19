# Contributing

This repo is best worked on as a browser-extension project with deterministic local fixtures. The fastest way to make good changes is to keep a Gym page, a focused test, and a small code change aligned.

## Environment

- Node.js 20.18.1+ recommended
- Chrome or Chromium for MV3 testing

## Install and build

```bash
npm install
npm run build
```

Load `extension/dist` in `chrome://extensions` with Developer Mode enabled.

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

## Where to change things

- navigation scoring and click decisions
  - `extension/src/content/capture_isolated.ts`
  - `extension/src/shared/scoring.ts`
- main-world popup/redirect/form enforcement
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
- rollback and DNR sync
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
