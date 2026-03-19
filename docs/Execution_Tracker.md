# Execution Tracker

## Purpose

This is the active tracker for post-merge follow-up work on `main`.

Use it as the source of truth for:

- what is actually still outstanding
- how the remaining work is grouped into reviewable batches
- what order those batches should land in
- which branch/PR each batch belongs to

Historical merge-tracking material lives under `docs/archive/`.

## Current baseline

- SentinelSuite merge is complete on `main`
- no open GitHub PRs
- no open GitHub issues
- current repo gaps are follow-up work, not merge work

## Outstanding inventory

### Test coverage

- missing Playwright coverage for Gym Levels 2, 3, 4, 7, 8, and 9
- popup/operator-surface browser coverage is still light
- no dedicated stress lane for worker churn or bursty popup/redirect sequences

### CI and release-process alignment

- there is still no dedicated stress lane for worker churn and bursty redirect sequences

### Repo and release hygiene

- no issue templates
- no changelog or release-notes workflow
- no README screenshots for operator surfaces
- manifest still uses `NavSentinel Suite (Dev)`

## Batch plan

### Batch 1: Tracker and CI alignment

Planned branch:
- `codex/post-merge-tracker-and-ci`

Scope:
- add this execution tracker
- make it discoverable from the active docs
- add a dedicated `typecheck` script
- make CI run `npm run typecheck`
- align release/process docs with that CI reality

Why first:
- low risk
- immediately closes one concrete release-process gap
- creates the document that the rest of the stack can use

### Batch 2: E2E lane split and rollback formalization

Planned branch:
- `codex/post-merge-e2e-lanes`

Scope:
- split E2E into clearer scripts/lane intent
- move rollback coverage out of ad hoc gating into a dedicated named lane
- align rollback assertions with the affordances the product currently guarantees
- reserve live-web checks as non-blocking
- add any helper/config cleanup needed to support the next coverage batches

Why second:
- it reduces friction for all later test work
- it keeps the next Gym coverage PRs focused on scenarios rather than harness churn

### Batch 3: Adversarial Gym coverage

Planned branch:
- `codex/post-merge-gym-adversarial`

Scope:
- automate Levels 2, 3, and 4

Why separate:
- these are attacker-style navigation cases
- they belong together conceptually
- they should be reviewable independently from legitimacy-flow tests

### Batch 4: Legitimate-flow Gym coverage

Planned branch:
- `codex/post-merge-gym-legit`

Scope:
- automate Levels 7, 8, and 9

Why separate:
- these are false-positive regression cases
- they need a different review mindset than the attacker cases

### Batch 5: Popup and operator-surface coverage

Planned branch:
- `codex/post-merge-popup-operator`

Scope:
- add popup browser automation where stable
- expand options/popup coverage around trust state, event visibility, and mode changes
- optionally land light operator UX cleanup that falls naturally out of the tests

Why here:
- by this point the main E2E harness and Gym coverage should already be stronger
- popup coverage is important, but less foundational than the missing Gym levels

### Batch 6: Release and repo hygiene

Planned branch:
- `codex/post-merge-release-hygiene`

Scope:
- issue templates
- changelog or release-notes workflow
- README screenshots
- decide whether to drop the `(Dev)` manifest branding for the next release path

Why last:
- these are useful, but not as risk-reducing as the test and CI work

## Dependencies

- Batch 2 should stack on Batch 1
- Batches 3 and 4 should stack on Batch 2
- Batch 5 should stack on Batch 4 unless it needs to be split off
- Batch 6 can stack last, or be split if it stays independent

## Success criteria

- every current Gym level has at least one deterministic automated path
- CI matches the documented release bar for typechecking/build/test/package
- rollback and worker-state-sensitive paths are no longer hidden behind ad hoc local gates
- popup/options operator surfaces have meaningful browser coverage
- release-facing repo polish no longer looks unfinished

## Status table

| Batch | Title | Status |
| --- | --- | --- |
| 1 | Tracker and CI alignment | open in PR #5 |
| 2 | E2E lane split and rollback formalization | in progress |
| 3 | Adversarial Gym coverage | planned |
| 4 | Legitimate-flow Gym coverage | planned |
| 5 | Popup and operator-surface coverage | planned |
| 6 | Release and repo hygiene | planned |
