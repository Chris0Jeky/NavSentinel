---
name: ns-safe-slice
description: Implement one small, reviewable slice in NavSentinel without drifting across unrelated extension layers.
user-invocable: true
---

# NavSentinel Safe Slice

Use this when implementing or editing inside this repo.

## Workflow

1. Restate the requested outcome in one sentence.
2. Identify the smallest seam that advances it.
3. Read only the files needed to confirm that seam.
4. If the seam crosses content-script, service-worker, storage, or UI boundaries, check `docs/Architecture_and_Data_Flow.md`.
5. Make one coherent change set.
6. Run the narrowest meaningful verification.
7. Update docs, roadmap, or `autodoc/AGENT_INDEX.md` only if their truth changed.
8. Summarize outcome, residual risk, and next safe slice.

## Preferred Checks

- scoring or heuristic change -> `npm run test` plus targeted Gym/E2E where relevant
- content script or service worker change -> `npm run typecheck` and `npm run build`
- UI change -> `npm run build` plus popup/options or E2E smoke coverage
- type contract change -> `npm run typecheck`
- Gym fixture -> link from `gym/index.html` and add or update `tests/e2e/*.spec.ts`
- docs or workflow change -> validate paths, stale references, and hook/script syntax

## Extra Repo Guardrails

- Edit source under `extension/src/`, not compiled output in `extension/dist/`.
- Do not mix navigation-guard and credential-guard logic changes in the same slice unless the request explicitly spans both.
- Keep content-script, shared, popup, options, and service-worker modules focused.
- If you touch scoring thresholds, verify in the Gym, not just unit tests.
- Keep local-first behavior intact; no runtime network calls without explicit product approval.
