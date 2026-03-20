# Resource Map

Archived on 2026-03-19 after the SentinelSuite merge landed on `main`.

This file remains useful for historical provenance, but the active documentation set now
starts from the merged repository rather than the pre-merge resource inputs.

## Current Repository

### Runtime code

- `extension/src/content/`
  - gesture capture, main-world guard, credential guard, toast, modal, debug overlay
- `extension/src/shared/`
  - storage, allowlist, domain analysis, CDS scoring, common types, state helpers
- `extension/src/sw/`
  - service worker rollback and DNR sync
- `extension/src/popup/`
  - quick operator controls
- `extension/src/options/`
  - full settings and state-management UI

### Test surfaces

- `gym/`
  - deterministic local HTML scenarios
- `tests/credential-domain.test.ts`
  - unit coverage for credential/domain heuristics
- `tests/e2e/`
  - Playwright specs for Gym-backed flows

### Release and process

- `scripts/check_versions.mjs`
  - enforces package and manifest version alignment
- `scripts/package.mjs`
  - builds the zip artifact
- `.github/workflows/ci.yml`
  - build, unit, package, and E2E CI
- `playwright.config.ts`
  - keeps Playwright scoped to true E2E specs

## Planning And Historical Inputs

- `MasterPlan.md`
  - original design intent and early scope framing
- [Expansion_Tracker.md](./Expansion_Tracker.md)
  - durable summary of the later suite-expansion merge and follow-up work

## Where To Look First

### If a popup or redirect is misbehaving

- `extension/src/content/capture_isolated.ts`
- `extension/src/content/main_guard.ts`
- `extension/src/shared/scoring.ts`
- `extension/src/sw/sw.ts`

### If a password form prompt is wrong

- `extension/src/content/credential_guard.ts`
- `extension/src/content/credential_modal.ts`
- `extension/src/shared/domain.ts`
- `extension/src/shared/storage.ts`

### If settings or trust state look wrong

- `extension/src/shared/storage.ts`
- `extension/src/shared/allowlist.ts`
- `extension/src/popup/popup.ts`
- `extension/src/options/options.ts`

### If CI or packaging is wrong

- `playwright.config.ts`
- `vite.config.ts`
- `.github/workflows/ci.yml`
- `scripts/check_versions.mjs`
- `scripts/package.mjs`
