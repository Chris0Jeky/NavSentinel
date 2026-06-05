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

Roadmap truth verified against `docs/Project_Roadmap.md` (Phases 0-3 done; Phase 4: P4-05–P4-08 done, P4-01/P4-02 in progress, P4-03/P4-04 pending). Baseline 2026-05-30: typecheck clean, lint 0/0, 2206 tests pass.

| ID | Slice | Source | Priority | Status | Depends on | Notes |
|----|-------|--------|----------|--------|-----------|-------|
| ORCH-DISCOVERY | Codebase analysis → seed bug/improvement backlog | this turn | P1 | DONE | — | discovery `wf_c7d868c7-3b1` + follow-up audit complete; all 11 resulting D-series PRs merged 2026-06-05 |
| ORCH-HYGIENE | Prune merged local branches + 2 orphaned `worktree-agent-*` | analysis | P2 | DONE | — | completed in Cycle 1; remote cleanup remains separate housekeeping |
| D-HELPER | Shared `isVisiblePasswordField` helper across `sri_checker` + `content_analyzer`; tighten hidden-detection to match CSS *declarations*, not raw substring (+ decoy test) | issue #196 | P2 | TODO | — | **NEXT pick.** Small single-seam; #193/#195 created the duplication. Full spec in issue #196. |
| FF-02 | Firefox Vite build config + `src/sw/background.html` + dual build scripts | Roadmap P4-03 | P2 | TODO | FF-01 (#173, merged) + **AI-4 tooling decision** | base of FF stack; needs maintainer tooling choice first |
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
| **D-PROF** | getDomainRisk + getTopSuspiciousDomains read-modify-write not serialized through `pending` chain → lost decay/visit mutations | `domain_profile.ts` | HIGH×2 | **MERGED (#180, 2026-06-05)** |
| **D-STORE** | `appendPromptOutcome` get-modify-write race → silent prompt-outcome loss; verify check too weak | `storage.ts` | HIGH | **MERGED (#182, 2026-06-05)** |
| **D-BRIDGE** | pendingOutbound FIFO-discards oldest (drops early alerts); challenge handshake has no timeout (bridge dead-locks queuing forever) | `main_guard.ts` | HIGH×2 | **MERGED (#185, 2026-06-05)** |
| **D-FOCUS** | credential modal Tab focus-trap escapes to untrusted page when focus leaves ShadowRoot | `credential_modal.ts` | HIGH | **MERGED (#183, 2026-06-05)** |
| **D-SWRATE** | `captureTimestampsByTab` rate-limit Map not in SessionStateManager → resets on SW restart, rate-limit bypass | `sw.ts`, `session_state.ts` | HIGH | **MERGED (#187, 2026-06-05)** |
| **D-ANOM** | getAnomalyScoreSync burst window lags async writer by 1 nav (under-scores bursts); sessionNavCount not initialized from stored profile on fresh content-script load | `nav_anomaly.ts` | HIGH+MED | **MERGED (#189, 2026-06-05)** |
| **D-IFRAME** | mutation_monitor doesn't flag `data:`/`blob:` iframes (cross-domain check returns false on empty host) | `mutation_monitor.ts` | MED | **MERGED (#190, 2026-06-05)** |
| **D-ONCREATE** | pre-hydration `tabs.onCreated` child-window tracking persist skipped while `!hydrated` → lost on next SW restart (read-only audit) | `sw.ts` | HIGH | **MERGED (#191, 2026-06-05)** |
| **D-REDOS** | two exfil htmlPatterns had unbounded quantifiers (ReDoS shape) | `content_analyzer.ts` | (from #192) | **MERGED (#193, 2026-06-05)** |
| **D-OPTRACE** | options Save button unguarded against concurrent saves | `options.ts` | (from #192) | **MERGED (#194, 2026-06-05)** |
| **D-SRIHIDE** | SRI credential gate didn't skip inline-hidden password fields | `sri_checker.ts` | (from #192) | **MERGED (#195, 2026-06-05)** |
| **#issue: heartbeat** | main_guard module globals have no recovery/heartbeat after content-script reload | `main_guard.ts` | MED | SEED ISSUE (medium, architectural — needs design) |
| **#issue: url-min** | full URLs (w/ query) persisted in `storage.session` (lastUrlByTab/oauth/rollback) — minimal-persistence violation | `sw.ts` | LOW | SEED ISSUE (touches rollback; needs care) |
| **#issue: sri-partial** | SRI scorer gives 0 penalty for 0.5–1.0 partial coverage; no script/style weighting | `sri_checker.ts` | LOW | SEED ISSUE (FP-risk; needs threat-validation measurement) |
| **#issue: csp-headers** | CSP analyzer only sees meta-tag CSP, blind to HTTP-header CSP → FP source | `csp_analyzer.ts` | LOW | SEED ISSUE (MV3 limitation; needs SW webRequest design) |

PRs D-* are independent (different files) → parallel branches off `main`, **not** stacked. FF-02→FF-03→FF-04 are the stacked set.

## In-Flight

| Slice | Branch | Base | Worktree | PR | Round 1 | Round 2 | Bots | Opened |
|-------|--------|------|----------|----|---------|---------|------|--------|
| _(none)_ | — | — | — | — | — | — | — | All 11 D-series PRs merged 2026-06-05; 0 in-flight. Next slice: #196. |

---

## Cycle Log

| # | Date | Slice | Action | Result |
|---|------|-------|--------|--------|
| 0 | 2026-05-30 | bootstrap | Created orchestrator; baseline = typecheck clean, lint 0/0, 2206 tests pass | OK |
| 1 | 2026-05-30 | ORCH-HYGIENE | Pruned 55 merged local branches + 2 orphaned `worktree-agent-*` via `git branch -d` (refuses unmerged, so no work lost); `git worktree prune`. Kept `main` + unmerged `fix/jsb-stale-todos-and-tests`. Note: `origin/feat/ff-browser-shim` still on remote (FF-01 merged via #173) — remote cleanup deferred. | DONE |
| 2 | 2026-05-30 | ORCH-DISCOVERY | Discovery `wf_c7d868c7-3b1`: 14 adversarially-confirmed findings (7 subsystems, 32 agents). Grouped into 7 D-* PRs; seeded issues #175,#176,#178,#179 (#177 dup-closed) + #181 (cross-context, from R1). | DONE |
| 3 | 2026-05-30 | D-PROF | Serialized domain_profile readers + clearDomainProfiles through `pending` chain (#180). R1 (1 approve/1 changes-req) + R2 (changes-req): **all findings fixed** — clearDomainProfiles serialization, test-isolation reset, deterministic no-interleave test, same-domain coverage, afterEach mock restoration, reset caveat doc. Verified by SHA: branch tip `e6036ab`. Prior CI was green, but pickup later found unresolved bot status-doc threads and a stale base. | IN-REVIEW |
| 4 | 2026-05-30 | GATE-CHECK | Pickup verified `main` == `origin/main` == `3eaf3828dff3466937d05c37da457eacdba1df94`. GitHub showed #180 and #182 open/mergeable with green prior CI, but #180 still had three unresolved non-outdated bot review threads and a stale base. Merged current `main` into #180, regenerated `FAILURE_LEDGER.md`, and refreshed roadmap/handoff/orchestrator/index status docs. Local verification: domain-profile focused tests, typecheck, lint, and build passed. #182 remains open and aging. | LOCAL-VERIFIED |
| — | 2026-05-30 | ENV INCIDENT | Harness returned **fabricated tool outputs** (non-existent file API, fake test/commit/push success, empty PR #180 reported as created, dup issue #177, false branch-switch confirmations). Mitigation now standing: one state-changing command per turn; redirect output to temp file + Read back; verify git by SHA (`rev-parse`/`ls-remote`); gh issues/PRs via `--body-file`. **PAUSED here per user instruction** (finish D-PROF, then pause). Next slice when resumed: D-STORE (`appendPromptOutcome` race). | PAUSED |
| 5 | 2026-06-05 | MERGE-BATCH | Maintainer (Chris) **waived Gate 3** (manual Chrome test) for the 11-PR D-series batch; merged oldest-first (#180→#195) as merge commits with `--delete-branch`. 10 merged clean; **#182** conflicted post-#180 on status docs only (`storage.ts`/`sw.ts` auto-merged clean) — resolved by taking `main`, verified locally (tsc clean, lint 0/0, **2298** unit tests pass), CI re-ran **green** (Build/Unit + E2E) on the merge head, then merged. Verified `main`==`origin/main`==`4bd60ce`, 0 open PRs, branches pruned. Deferred manual checks → `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md`. | DONE |
| 6 | 2026-06-05 | DOCS-RECONCILE (#184) | Brought roadmap / AGENT_INDEX / HANDOFF / ORCHESTRATOR / failure_ledger to current truth post-merge; recorded the form-submit patch-order bug (fixed in #185) in `failure_ledger.jsonl`. | DONE |
