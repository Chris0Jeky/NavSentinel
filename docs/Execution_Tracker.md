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
- PR #5 merged the post-merge test hardening and coverage stack
- refer to the GitHub repository for the current state of open PRs and issues
- current repo gaps are operator-surface polish, stress coverage, and more realistic attack simulation

## Outstanding inventory

### Test coverage

- popup/operator-surface browser coverage is still lighter than the main Gym regression set
- no dedicated stress lane for worker churn or bursty popup/redirect sequences
- no large real-world adversarial scenario program that simulates search, OAuth, document, payments, or support-scam style abuse chains

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

### Batch 5: Premium operator surfaces and popup coverage

Planned branch:
- `codex/premium-ui-adversarial-program`

Scope:
- give the popup and options page a more deliberate premium/operator feel
- expand popup/options browser coverage around trust state, event visibility, and mode changes
- keep the same IDs and controls so operator workflows stay familiar

Why here:
- by this point the main E2E harness and Gym coverage are stronger
- this is the right moment to improve the operator surfaces without mixing that work into the merge-hardening stack

### Batch 6: Real-world adversarial simulation program

Planned branch:
- `codex/premium-ui-adversarial-program` (combined with Batch 5 in the seed PR)

Scope:
- create a discoverable scenario backlog grounded in real attack families
- group scenarios into reviewable waves and implementation priorities
- map each scenario to the product expectation, Gym fixture shape, and test lane

Why next:
- this is the highest-value way to turn “more tests” into a realistic security program
- it gives the repo a shared source of truth for the next large Gym/stress expansion

### Batch 7: Release and repo hygiene

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
- Batch 5 can now start directly on `main`
- Batch 6 should stack conceptually on Batch 5 because popup/operator clarity helps scenario review and demoing
- Batch 7 can land after the active product/testing follow-up batches

## Success criteria

- every current Gym level has at least one deterministic automated path
- CI matches the documented release bar for typechecking/build/test/package
- rollback and worker-state-sensitive paths are no longer hidden behind ad hoc local gates
- popup/options operator surfaces have meaningful browser coverage
- there is a realistic scenario program that goes beyond toy clickjacking fixtures
- release-facing repo polish no longer looks unfinished

## Status table

| Batch | Title | Status |
| --- | --- | --- |
| 1 | Tracker and CI alignment | folded into PR #5 |
| 2 | E2E lane split and rollback formalization | folded into PR #5 |
| 3 | Adversarial Gym coverage | folded into PR #5 |
| 4 | Legitimate-flow Gym coverage | folded into PR #5 |
| 5 | Premium operator surfaces and popup coverage | in progress |
| 6 | Real-world adversarial simulation program | in progress |
| 7 | Release and repo hygiene | planned |
