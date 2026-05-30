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

Roadmap truth verified against `docs/Project_Roadmap.md` (Phases 0-3 done; Phase 4: P4-05–P4-08 done, P4-01/P4-02 in progress, P4-03/P4-04 pending). Baseline 2026-05-30: main started at 2206 Vitest tests; PR #180's D-PROF branch verifies 2211; PR #182's D-STORE branch verifies 2218 with typecheck/lint/build clean.

| ID | Slice | Source | Priority | Status | Depends on | Notes |
|----|-------|--------|----------|--------|-----------|-------|
| ORCH-DISCOVERY | Codebase analysis → seed bug/improvement backlog | this turn | P1 | DONE | — | discovery workflow `wf_c7d868c7-3b1`; confirmed findings listed below |
| ORCH-HYGIENE | Prune merged local branches + 2 orphaned `worktree-agent-*` | analysis | P2 | DONE | — | all locals merged into main except `fix/jsb-stale-todos-and-tests`; `git branch -d` safe-deleted merged branches |
| FF-02 | Firefox Vite build config + `src/sw/background.html` + dual build scripts | Roadmap P4-03 | P2 | TODO | FF-01 (#173, merged) | base of FF stack |
| FF-03 | `session_state` Firefox compat (`storage.session`→namespaced `storage.local` shim) | Roadmap P4-03 | P3 | TODO | FF-02 | **stacked on FF-02** |
| FF-04 | `world:"MAIN"` guard parity for Firefox + transition-qualifier gaps | Roadmap P4-03 | P4 | TODO | FF-03 | **stacked on FF-03** |
| JSB-127 | JS behavior monitor: perf validation (patch/getter overhead budgets) + residual `JsBehaviorState` dedup | issue #127 | P3 | TODO | — | unmerged branch `fix/jsb-stale-todos-and-tests` may hold partial work — inspect before branching |
| P4-01c | Real perceptual brand templates (replace placeholder hashes) | Roadmap P4-01 | P4 | BLOCKED | real brand login screenshots | `scripts/build-brand-templates.mjs` emits seeded-PRNG placeholders; spoof detection wired but cannot fire. Needs a sanctioned source of brand screenshots — product decision. |
| P2-GATE-FP | Re-run FP/TP measurement after P4 additions (Phase 2 gate open item) | Roadmap | P4 | TODO | — | `npm run measure:fp`; confirm < 0.1% still holds |
| P4-04 | Community threat intelligence | Roadmap | P5 | BLOCKED | protocol/privacy product decisions | XL, deferred — not an autonomous pick |

---

## Discovery Findings (Cycle 2, `wf_c7d868c7-3b1`) → PR grouping

14 adversarially-confirmed findings. Grouped into coherent, single-seam PRs. Severity = adversary-adjusted.

| PR | Findings | Files | Sev | Status |
|----|----------|-------|-----|--------|
| **D-PROF** | getDomainRisk + getTopSuspiciousDomains read-modify-write not serialized through `pending` chain → lost decay/visit mutations | `domain_profile.ts` | HIGH×2 | MERGE-PENDING (#180 aging) |
| **D-STORE** | `appendPromptOutcome` get-modify-write race → silent prompt-outcome loss; verify check too weak | `storage.ts`, `sw.ts` | HIGH | MERGE-PENDING (#182 aging) |
| **D-BRIDGE** | pendingOutbound FIFO-discards oldest (drops early alerts); challenge handshake has no timeout (bridge dead-locks queuing forever) | `main_guard.ts` | HIGH×2 | TODO |
| **D-FOCUS** | credential modal Tab focus-trap escapes to untrusted page when focus leaves ShadowRoot | `credential_modal.ts` | HIGH | TODO |
| **D-SWRATE** | `captureTimestampsByTab` rate-limit Map not in SessionStateManager → resets on SW restart, rate-limit bypass | `sw.ts`, `session_state.ts` | HIGH | TODO |
| **D-ANOM** | getAnomalyScoreSync burst window lags async writer by 1 nav (under-scores bursts); sessionNavCount not initialized from stored profile on fresh content-script load | `nav_anomaly.ts` | HIGH+MED | TODO |
| **D-IFRAME** | mutation_monitor doesn't flag `data:`/`blob:` iframes (cross-domain check returns false on empty host) | `mutation_monitor.ts` | MED | TODO |
| **#issue: heartbeat** | main_guard module globals have no recovery/heartbeat after content-script reload | `main_guard.ts` | MED | SEED ISSUE (medium, architectural — needs design) |
| **#issue: url-min** | full URLs (w/ query) persisted in `storage.session` (lastUrlByTab/oauth/rollback) — minimal-persistence violation | `sw.ts` | LOW | SEED ISSUE (touches rollback; needs care) |
| **#issue: sri-partial** | SRI scorer gives 0 penalty for 0.5–1.0 partial coverage; no script/style weighting | `sri_checker.ts` | LOW | SEED ISSUE (FP-risk; needs threat-validation measurement) |
| **#issue: csp-headers** | CSP analyzer only sees meta-tag CSP, blind to HTTP-header CSP → FP source | `csp_analyzer.ts` | LOW | SEED ISSUE (MV3 limitation; needs SW webRequest design) |

PRs D-* are independent (different files) → parallel branches off `main`, **not** stacked. FF-02→FF-03→FF-04 are the stacked set.

## In-Flight

| Slice | Branch | Base | Worktree | PR | Round 1 | Round 2 | Bots | Opened |
|-------|--------|------|----------|----|---------|---------|------|--------|
| D-PROF | `fix/domain-profile-concurrency` | `main` | no | #180 | done (1 approve / 1 changes-req → all fixed) | done (changes-req → all fixed) | early Gemini/Codex/Copilot review records checked; no unresolved actionable bot item | 2026-05-30, aging for merge |
| D-STORE | `fix/prompt-outcome-race` | `main` | no | #182 | done (cross-context writer + docs fixes) | done (reset barrier + import bounding fixes; same-ms recheck fixed) | Gemini resolved; Copilot review-error checked with no actionable finding | 2026-05-30, aging for merge |

---

## Cycle Log

| # | Date | Slice | Action | Result |
|---|------|-------|--------|--------|
| 0 | 2026-05-30 | bootstrap | Created orchestrator; baseline = typecheck clean, lint 0/0, 2206 tests pass | OK |
| 1 | 2026-05-30 | ORCH-HYGIENE | Pruned 55 merged local branches + 2 orphaned `worktree-agent-*` via `git branch -d` (refuses unmerged, so no work lost); `git worktree prune`. Kept `main` + unmerged `fix/jsb-stale-todos-and-tests`. Note: `origin/feat/ff-browser-shim` still on remote (FF-01 merged via #173) — remote cleanup deferred. | DONE |
| 2 | 2026-05-30 | ORCH-DISCOVERY | Discovery `wf_c7d868c7-3b1`: 14 adversarially-confirmed findings (7 subsystems, 32 agents). Grouped into 7 D-* PRs; seeded issues #175,#176,#178,#179 (#177 dup-closed) + #181 (cross-context, from R1). | DONE |
| 3 | 2026-05-30 | D-PROF | Serialized domain_profile readers + clearDomainProfiles through `pending` chain (#180). R1 (1 approve/1 changes-req) + R2 (changes-req): **all findings fixed** — clearDomainProfiles serialization, test-isolation reset, deterministic no-interleave test, same-domain coverage, afterEach mock restoration, reset caveat doc. Verified by SHA: branch tip `e6036ab`. typecheck clean, lint 0/0, **2211 tests pass**, **CI Build/Unit green**, **E2E green**. Early Gemini/Codex/Copilot bot review records were checked; Gemini's actionable status/ledger feedback is addressed and no unresolved bot action remains. **Held for merge** per aging rule (newest PR; merge only when ~3 PRs old). | IN-REVIEW → MERGE-PENDING |
| 4 | 2026-05-30 | D-STORE | PR #182 opened from `fix/prompt-outcome-race`. Initial implementation serialized same-context `appendPromptOutcome`/`clearPromptOutcomes`; Round 1 found MV3 cross-context writes still raced and docs were stale; Round 2 found delayed stale appends could repopulate after clear/import and import replacement was bounded too late; recheck found a same-millisecond stale-append gap. Follow-up routes append/clear/import-replace through the service worker as a single writer when runtime messaging is available, keeps direct fallback for unavailable runtime/tests, preserves intended IDs across clobbered-verify retries, filters corrupt prompt-outcome entries, adds a session-backed reset/import barrier that drops entries at or before reset timestamp, bounds import payloads before delegation, and adds regressions for retry preservation + independent module callers routed through one runtime writer + corrupt storage + delayed append after clear/import including same-timestamp cases + pre-delegation import bounding. Final recheck found no blockers; Gemini is resolved/outdated; Copilot's review-error record was checked with no actionable finding. Verified `npm run typecheck`, `npm run lint`, `npm run test -- tests/storage-append.test.ts` (41 pass), `npm run test` (74 files / 2218 tests), `npm run build`, and GitHub CI green. Held for merge per aging rule. | IN-REVIEW → MERGE-PENDING |
| — | 2026-05-30 | ENV INCIDENT | Harness returned **fabricated tool outputs** (non-existent file API, fake test/commit/push success, empty PR #180 reported as created, dup issue #177, false branch-switch confirmations). Mitigation now standing: one state-changing command per turn; redirect output to temp file + Read back; verify git by SHA (`rev-parse`/`ls-remote`); gh issues/PRs via `--body-file`. D-STORE is now PR #182, review-gate complete, and aging for merge. | STANDING GUARDRAIL |
