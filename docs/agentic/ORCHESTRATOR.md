# NavSentinel Orchestrator

**Purpose:** Single control file for the autonomous end-to-end work cycle. Reuse this file across sessions. It tracks the backlog, in-flight slices, PR/merge gates, and a running cycle log.

**Created:** 2026-05-30 | **Mode:** continuous, subagent/workflow-driven

> Authority: this file sits *below* `AGENTS.md`, `docs/Project_Roadmap.md`, and `autodoc/AGENT_INDEX.md`. It is an operational ledger, not a source of product truth. When a slice changes roadmap/index truth, sync those per their protocols.

---

## Operating Loop (per task)

1. **Select** the highest-value unblocked slice from the Backlog. Prefer narrow, reviewable diffs. Respect dependencies (use stacked branches).
2. **Branch** off the correct base (`main`, or the parent slice's branch for stacked work). Use a worktree when slices run in parallel or must not collide.
3. **Implement** in small, incremental commits — one concern per commit. Keep nav-guard / credential-guard / SW / UI concerns separate.
4. **Verify** with the narrowest sufficient lane: `npm run typecheck`, `npm run lint`, `npm run test`; add E2E/Gym/corpus only when the seam needs it.
5. **Open PR** with a factual summary, verification evidence, and residual risk.
6. **Review Gate** — two *independent* adversarial review rounds (see below). Address **every** finding of all severities. Address all bot comments.
7. **Docs sync** — roadmap/index/ledger only when truth changed.
8. **Log** the cycle outcome below, update Backlog statuses, then pick the next slice.

Never stop on "out of tasks" — run a Discovery pass (analysis → seed new backlog items) and continue.

## PR & Merge Gates (from CLAUDE.md)

- **Gate 1:** Two independent adversarial review rounds; all findings fixed between/after rounds.
- **Gate 2:** CI green — typecheck, lint, build, unit, E2E. No new failures.
- **Gate 3:** Manual/behavioral verification where applicable.
- **Gate 4:** Zero tech debt — no TODO without a linked issue, no undocumented workaround, no skipped tests.
- **Gate 5:** Docs sync.

### Merge timing rule

- **Never merge the newest open PR.** Let it age.
- A PR may be considered for merge once it is roughly **3 PRs old**, has passed both adversarial rounds, has all bot comments addressed, and some time has elapsed since opening.
- Stacked PRs merge bottom-up (parent before child).

### Stacked branch policy

When slice B depends on unmerged slice A: branch B off A (`slice/<A>` → `slice/<B>`). Record the stack in the In-Flight table. Rebase children onto the new base only via `git merge` (no history rewrite on shared branches; protected-branch rules apply).

---

## Backlog

Status legend: `TODO` · `IN-PROGRESS` · `IN-REVIEW` · `MERGE-READY` · `DONE` · `BLOCKED`

| ID | Slice | Source | Priority | Status | Depends on | Notes |
|----|-------|--------|----------|--------|-----------|-------|
| ORCH-DISCOVERY | Codebase analysis → seed bug/improvement backlog | this turn | P1 | TODO | — | fan-out review of hot-spot files |
| P4-01c | Real spoof-detection templates (replace placeholders) | Roadmap | P2 | TODO | — | visual_sim.ts uses synthetic fingerprints |
| P4-02 | Behavioral anomaly heuristics | Roadmap | P3 | BLOCKED | capture telemetry | needs P4-05 signal store |
| P4-05 | Telemetry-free behavioral signal store (IndexedDB ring buffer) | Roadmap | P3 | TODO | — | design pending; unblocks P4-02 |
| P4-03 | Cross-tab correlation | Roadmap | P4 | TODO | — | planned |
| P4-04 | Reputation feed refresh | Roadmap | P4 | TODO | — | planned |
| P4-06 | Adaptive threshold tuning (FP < 2% on corpus) | Roadmap | P4 | BLOCKED | P4-02 | |

---

## In-Flight

| Slice | Branch | Base | Worktree | PR | Round 1 | Round 2 | Bots | Opened |
|-------|--------|------|----------|----|---------|---------|------|--------|
| _(none yet)_ | | | | | | | | |

---

## Cycle Log

| # | Date | Slice | Action | Result |
|---|------|-------|--------|--------|
| 0 | 2026-05-30 | bootstrap | Created orchestrator; baseline = typecheck clean, lint 0/0, 2206 tests pass (1 skip) | OK |
