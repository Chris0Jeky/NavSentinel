---
name: ns-repo-map
description: Quickly find the correct NavSentinel code seam, what to ignore, and what verification proves the change.
user-invocable: true
---

# NavSentinel Repo Map

Use when you need to find the right change point quickly without broad repo search.

## Steps

1. Confirm the requested domain and likely runtime surface.
2. Read `autodoc/AGENT_INDEX.md`.
3. Use `rg` to find symbols, reason codes, Gym links, and tests.
4. Return a short edit plan: files to touch, files to leave alone, and verification.

## Key Seams By Area

### Navigation And Scoring

- `extension/src/content/capture_isolated.ts`
- `extension/src/shared/scoring.ts`
- `extension/src/shared/nrs.ts`
- tests: `tests/nrs*.test.ts`, `tests/scoring.property.test.ts`, E2E Gym specs

### Main-World Guard

- `extension/src/content/main_guard.ts`
- `extension/src/content/pushstate_guard.ts`
- `extension/src/content/dblclick_guard.ts`
- tests: pushState, doubleclick, phase2 E2E

### Credential Guard

- `extension/src/content/credential_guard.ts`
- `extension/src/content/credential_guard_model.ts`
- `extension/src/content/credential_modal.ts`
- `extension/src/shared/domain.ts`
- tests: credential model/domain and credential E2E

### Service Worker State

- `extension/src/sw/sw.ts`
- `extension/src/shared/session_state.ts`
- tests: rollback, session state, stress E2E

### UI

- `extension/src/popup/*`
- `extension/src/options/*`
- tests: popup model, storage, suite UI E2E

## Ignore

- `extension/dist/`, `dist/`, `node_modules/`, `test-results/`, `playwright-report/`
- `HistoryDump.txt`, PDF research dumps, generated reputation binaries
- archived docs unless provenance is requested

## Output

A short plan of where to edit and what tests/docs to update.
