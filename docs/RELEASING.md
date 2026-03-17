# Releasing NavSentinel

This repository can build and package the MV3 extension as a zip artifact with `manifest.json` at the archive root.

## Versioning

Keep these versions identical:

- `package.json`
- `extension/manifest.json`

Use `npm run verify:versions` before packaging or CI changes.

## Local release checklist

1. Update `package.json` and `extension/manifest.json`.
2. Run:

```bash
npm ci
npm run verify:versions
npm test
npm run build
npm run package:ext
```

3. Confirm the archive exists under `artifacts/`.
4. Tag and publish using your normal git/release workflow.

## Packaging output

`npm run package:ext` produces:

- `artifacts/navsentinel-vX.Y.Z.zip`

## CI

The CI workflow verifies version parity, runs unit tests, builds the extension, packages it, and runs Playwright E2E coverage.
