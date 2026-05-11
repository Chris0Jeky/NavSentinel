---
name: ns-repo-map
description: Quickly find the correct NavSentinel code seam, what to ignore, and what verification proves the change.
user-invocable: true
---

# NavSentinel Repo Map

Use `autodoc/AGENT_INDEX.md` first, then `rg` for symbols, reason codes, Gym links, and tests.

Key seams:

- navigation/scoring: `extension/src/content/capture_isolated.ts`, `extension/src/shared/scoring.ts`, `extension/src/shared/nrs.ts`
- main-world guard: `extension/src/content/main_guard.ts`, `pushstate_guard.ts`, `dblclick_guard.ts`
- credential guard: `credential_guard.ts`, `credential_guard_model.ts`, `credential_modal.ts`, `shared/domain.ts`
- service worker state: `extension/src/sw/sw.ts`, `extension/src/shared/session_state.ts`
- UI: `extension/src/popup/*`, `extension/src/options/*`

Ignore `extension/dist`, `dist`, `node_modules`, reports, artifacts, generated binaries, dumps, and archived docs unless needed.

Output: where to edit, what to leave alone, and what tests/docs to update.
