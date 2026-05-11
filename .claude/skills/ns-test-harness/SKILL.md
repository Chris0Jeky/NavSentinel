---
name: ns-test-harness
description: Choose or extend NavSentinel tests across Vitest, Playwright, Gym, corpus, rollback, stress, and false-positive lanes.
user-invocable: true
---

# NavSentinel Test Harness

Use when adding tests, selecting verification, or proving detection behavior.

## Primary References

- `docs/Testing_and_Gym.md`
- `docs/Testing_Expansion_Strategy.md`
- `gym/index.html`
- `playwright.config.ts` and specialized Playwright configs

## Where Tests Live

- unit/model tests: `tests/*.test.ts`
- E2E tests: `tests/e2e/*.spec.ts`
- E2E helpers: `tests/e2e/extension_test_utils.ts`
- deterministic fixtures: `gym/*.html`
- corpus inputs/results: `tests/corpus/`, `tests/fp-results/`

## Test Strategy

1. Prefer the narrowest deterministic unit test for pure scoring, model, storage, and parser behavior.
2. Use Gym-backed Playwright when the behavior depends on browser windows, tabs, content-script worlds, or extension UI.
3. Use stress and rollback lanes for timing, worker lifecycle, churn, and multi-tab behavior.
4. Use corpus and FP lanes for evidence claims; do not turn them into default local smoke checks unless they become deterministic and cheap.

## Determinism Rules

- Avoid live web unless using the explicit live lane.
- Avoid current time unless frozen or bounded.
- Keep one scenario per Gym page where practical.
- Assert both positive behavior and absence of unwanted tabs/prompts when relevant.

## Preferred Commands

```bash
npm run typecheck
npm run test
npm run build
npm run test:e2e
npm run test:e2e:rollback
npm run test:e2e:stress
npm run test:e2e:corpus
npm run measure:fp
```

## Output

- test file or fixture changed
- reason the selected lane proves the change
- remaining coverage gap, if any
