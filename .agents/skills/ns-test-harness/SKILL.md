---
name: ns-test-harness
description: Choose or extend NavSentinel tests across Vitest, Playwright, Gym, corpus, rollback, stress, and false-positive lanes.
user-invocable: true
---

# NavSentinel Test Harness

References: `docs/Testing_and_Gym.md`, `docs/Testing_Expansion_Strategy.md`, `gym/index.html`.

Use unit tests for pure scoring/model/storage behavior. Use Gym-backed Playwright for browser windows, tabs, content-script worlds, and extension UI. Use rollback/stress lanes for lifecycle and timing. Use corpus/FP lanes for evidence claims.

Commands: `npm run typecheck`, `npm run test`, `npm run build`, `npm run test:e2e`, `npm run test:e2e:rollback`, `npm run test:e2e:stress`, `npm run test:e2e:corpus`, `npm run measure:fp`.

Output the changed test surface, why the lane proves the behavior, and any remaining gap.
