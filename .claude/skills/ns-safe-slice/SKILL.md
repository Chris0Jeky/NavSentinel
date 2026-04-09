---
name: ns-safe-slice
description: Implement one small, reviewable slice in NavSentinel without drifting across unrelated extension layers.
user-invocable: true
---

# NavSentinel Safe Slice

Use this when you are implementing or editing inside this repo.

## Workflow

1. Restate the task in one sentence.
2. Identify the smallest seam that advances it.
3. Read only the files needed to confirm that seam.
4. If the seam crosses content-script / service-worker / UI boundaries, check the architecture doc first.
5. Make one coherent change set.
6. Run the narrowest meaningful verification.
7. Summarize outcome, residual risk, and next slice.

## Preferred checks

- scoring or heuristic change -> `npm run test` (Vitest)
- content script or UI change -> `npm run build` then manual load or E2E
- type contract change -> `npm run typecheck`
- Gym fixture -> `npm run test:e2e` or targeted Playwright spec
- docs or workflow change -> validate paths and accuracy

## Extra repo guardrails

- edit source under `extension/src/`, not compiled output in `extension/dist/`
- do not mix navigation-guard logic changes with credential-guard logic changes in the same slice
- keep content-script, shared, popup, options, and service-worker modules focused and small
- if you touch scoring thresholds, verify in the Gym, not just in unit tests