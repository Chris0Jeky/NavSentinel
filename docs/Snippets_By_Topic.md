# Snippets By Topic

This file is intentionally curated. It is no longer a raw planning dump.

## Core Commands

### Install and build

```bash
npm install
npm run build
```

### Development loop

```bash
npm run watch
npm run gym:serve
```

### Verification

```bash
npm run verify:versions
npx tsc -p tsconfig.json --noEmit
npm run test
npm run test:e2e
npm run package:ext
```

## File Pointers

### Navigation interception

```text
extension/src/content/capture_isolated.ts
extension/src/content/main_guard.ts
extension/src/shared/scoring.ts
extension/src/sw/sw.ts
```

### Credential interception

```text
extension/src/content/credential_guard.ts
extension/src/content/credential_modal.ts
extension/src/shared/domain.ts
extension/src/shared/storage.ts
```

### UI and operator workflow

```text
extension/src/popup/popup.ts
extension/src/options/options.ts
extension/src/content/ui_toast.ts
```

## Useful Targeted Test Runs

### Navigation E2E only

```bash
npx playwright test tests/e2e/navsentinel.spec.ts
```

### Credential E2E only

```bash
npx playwright test tests/e2e/credential-guard.spec.ts
```

### Credential heuristics unit tests

```bash
npm run test -- tests/credential-domain.test.ts
```

## Packaging Reminder

```bash
npm run package:ext
```

Artifact output:

```text
artifacts/navsentinel-v0.2.0.zip
```

## Effective Investigation Pattern

1. Reproduce in the Gym.
2. Inspect popup and options state.
3. Check the event log.
4. Run the targeted unit or E2E test.
5. Only then broaden to a live-web repro.
