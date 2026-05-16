---
name: ns-safe-slice
description: Implement one small, reviewable slice in NavSentinel without drifting across unrelated extension layers.
user-invocable: true
---

# NavSentinel Safe Slice

Workflow: restate the outcome, choose the smallest seam, read only needed files, patch one coherent change, run narrow verification, and sync docs only if truth changed.

Preferred checks:

- scoring/heuristic: `npm run test` plus relevant Gym/E2E
- content script or service worker: `npm run typecheck`, `npm run build`
- UI: `npm run build` plus popup/options or E2E smoke
- Gym fixture: link from `gym/index.html` and add/update E2E
- workflow/docs: path checks, stale-reference search, hook syntax checks

Guardrails: edit `extension/src`, not `extension/dist`; keep local-first behavior; avoid mixing unrelated guard layers.
