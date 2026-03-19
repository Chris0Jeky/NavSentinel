# Implementation Roadmap

## Current state

The SentinelSuite merge is complete on `main`.

The shipped baseline now includes:

- hardened isolated-world and main-world navigation enforcement
- rollback handling for suspicious redirect-style navigations
- credential-submit protection and trusted-domain workflows
- popup and options UI
- unified local storage, import/export, and bounded event logging
- build, packaging, CI, and strict type verification

As of 2026-03-19 there are no open GitHub PRs and no open GitHub issues. The remaining work is follow-up backlog, not in-flight merge work.

The detailed execution order for that follow-up work now lives in:

- `docs/Execution_Tracker.md`

## Active follow-up themes

### 1. Broaden automated coverage

Highest-value next work:

- automate Gym Levels 2, 3, 4, 7, 8, and 9
- add stress coverage for popup bursts, delayed chains, and worker churn
- add lower-cost property/fake-timer tests for scoring, DOM hints, and state timing

This is the clearest current gap because the infrastructure exists, but several important fixtures and stress paths are still unguarded.

### 2. Tighten operator ergonomics

Most likely UX follow-up:

- better event-log filtering and search
- clearer separation in the UI between navigation allowlist and trusted domains
- optional richer event metadata for trust/allow decisions

This is useful, but lower priority than broadening coverage.

### 3. Release and repo hygiene

Still outstanding:

- issue templates
- changelog or release-notes workflow
- optional release-tag automation
- README/screenshots polish for operator surfaces

### 4. Optional future integration

`RESOURCES/link` and `RESOURCES/hardened` remain intentionally out of scope for the merged baseline.

If revisited, they should be treated as separate explicitly-scoped projects, not folded into routine follow-up work.

## What is stale now

These ideas are no longer the active roadmap:

- the old staged "merge SentinelSuite into NavSentinel" plan
- worktree-specific integration instructions
- slice tracking for the merge branch

Those materials are kept only as archive/history.

## Practical next steps

1. Finish Playwright coverage for the remaining Gym levels.
2. Add a stress lane for worker-state churn and repeated popup/redirect cases.
3. After test coverage improves, decide whether the next tranche should be operator UX cleanup or release/repo polish.
