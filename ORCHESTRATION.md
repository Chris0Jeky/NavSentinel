# NavSentinel Autonomous Orchestration

**Purpose**: This file is the single source of truth for the autonomous multi-session workflow. Read this FIRST after any context compaction or session restart. It survives wipes because it's on disk.

**Last updated**: 2026-05-16T11:10:00Z

---

## How To Continue After Context Compaction

1. Read this file (`ORCHESTRATION.md`).
2. Read `docs/Project_Roadmap.md` for phase/task definitions.
3. Run `gh pr list --state open --json number,title,headRefName,statusCheckRollup` to see PR states.
4. Run the TaskList tool to see task tracker state.
5. Check the **Active Branches** and **PR Tracker** sections below for in-flight work.
6. Pick up the first incomplete task and continue.
7. After completing any task, update this file AND the task tracker.
8. After completing a PR (2 review rounds + all fixes), update the **PR Tracker** section.

## Workflow Rules

- **Branches**: Use `feat/`, `fix/`, `test/`, `infra/`, `docs/` prefixes per roadmap convention.
- **Worktrees**: Use `--isolation worktree` for subagent work when possible.
- **Commits**: Small, focused, one logical change per commit. Imperative mood.
- **PRs**: Create PR after implementation. Do NOT merge future PRs into main unless needed for dependency.
- **Stacked branches**: When task B depends on task A's code, branch B off A's branch.
- **Reviews**: Every PR gets 2 rounds of adversarial review (subagents). Post comments, fix ALL findings.
- **Tests**: Run `npm run test` + `npm run typecheck` before every commit. Run E2E where relevant.
- **Docs**: Update roadmap when task status changes. Update AGENT_INDEX.md for new seams.
- **Manual testing**: Use Playwright MCP or browser tools to test UI changes when possible.
- **This file**: Update the sections below after every significant state change.

## Current Phase Status

| Phase | Done | Total | Status |
|-------|------|-------|--------|
| 0     | 6    | 6     | COMPLETE |
| 1     | 8    | 8     | COMPLETE |
| 2     | 13   | 13    | COMPLETE |
| 3     | 9    | 12    | 3 in PR (#73, #81, #82) |
| 4     | 3    | 8     | 1 in PR (#78), 4 gated on P3 merge |

**Total: 39/47 tasks done on main** — all remaining in reviewed PRs.

## PR Tracker

All PRs have completed 2 rounds of adversarial review with findings fixed.

| PR  | Branch | Task | CI | R1 | R2 | Mergeable | Notes |
|-----|--------|------|----|----|----|-----------|-------|
| #72 | test/coverage-gaps | AUD-01 (early) | ✅ | ✅ | ✅ | YES | |
| #73 | feat/onboarding | P3-04 | ✅ | ✅ | ✅ | YES | |
| #74 | docs/freshness-sweep | AUD-02 | ✅ | ✅ | ✅ | YES | |
| #78 | feat/nav-anomaly | P4-08 | ✅ | ✅ | ✅ | YES | |
| #79 | fix/bridge-security | AUD-03 | ✅ | ✅ | ✅ | YES | Overlaps #85 on ns-allow-target-nav |
| #80 | fix/accessibility | AUD-05 | ✅ | ✅ | ✅ | YES | |
| #81 | docs/cws-listing | P3-06 | ✅ | ✅ | ✅ | YES | |
| #82 | docs/security-audit-prep | P3-09 | ✅ | ✅ | ✅ | YES | |
| #83 | test/perf-budget | AUD-04 | ✅ | ✅ | ✅ | YES | |
| #84 | test/coverage-audit | AUD-01 | ✅ | ✅ | ✅ | YES | |
| #85 | fix/main-world-sendmessage | Issue #77 | ✅ | ✅ | ✅ | YES | Merge before #79 |

**Merge order recommendation**: #85 → #79 (conflict resolution needed), then others in any order.

## Open Issues

| Issue | Title | Status |
|-------|-------|--------|
| #75 | Writable/configurable patches | Addressed by PR #79 |
| #76 | Extension fingerprinting via globals | Addressed by PR #79 |
| #77 | chrome.runtime.sendMessage in MAIN world | Addressed by PR #85 |
| #86 | Bridge session race (pre-existing) | Seeded, design issue |

## What's Left

### Unblocked now
- Security audit of codebase (background agent running)
- Code quality sweeps
- Additional test coverage

### Gated on Phase 3 merge
- P4-01: Visual similarity detection (XL)
- P4-02: JS behavior analysis (XL)
- P4-03: Cross-browser Firefox port (XL)
- P4-04: Community threat intelligence (XL)

## Active Branches

- `fix/main-world-sendmessage` — PR #85, complete (R2 done)

## Notes

- PRs #67-71 were merged to main in previous sessions.
- Background agents sharing working directory can cause branch-switching race conditions. Use worktree isolation when possible.
- `failure_ledger.jsonl` gets modified by the pre-tool hook — restore it before branch switches.
- Pre-tool hook blocks destructive ops on protected branches.
- Test count: ~806 unit + ~50 E2E = ~856 total passing (on main).
