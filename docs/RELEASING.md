# Releasing

## Preconditions

- Node `20.18.1` or newer
- clean working tree on the release branch
- package version and manifest version aligned

## Release Verification

Run all of these before treating a branch as releasable:

```bash
npm run verify:versions
npx tsc -p tsconfig.json --noEmit
npm run build
npm run test
npm run test:e2e
npm run package:ext
```

## What CI Covers

CI currently runs:

- `npm run verify:versions`
- `npm test`
- `npm run build`
- `npm run package:ext`
- `xvfb-run -a npm run test:e2e`

Playwright uses `playwright.config.ts`, which is intentionally scoped to `tests/e2e/**/*.spec.ts`.

## Packaging

```bash
npm run package:ext
```

Expected artifact:

```text
artifacts/navsentinel-v<version>.zip
```

## Suggested Release Flow

1. Merge the PR with green CI.
2. Pull the merged branch locally.
3. Re-run the full verification set if anything changed since the last green CI run.
4. Produce the artifact with `npm run package:ext`.
5. Record:
- version
- key behavior changes
- tests run
- known residual risks

## When Not To Release

- E2E failures in Gym-backed tests
- version mismatch between `package.json` and `extension/manifest.json`
- unreviewed changes to `main_guard.ts`, `credential_guard.ts`, `storage.ts`, or `sw.ts`
- docs that still describe an old workflow or missing feature
