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

**Updated 2026-06-13:** `main` @ **`da400fb`**, **0 open PRs**, typecheck clean, lint 0/0, **2426 tests pass**. Active track = **North-Star Phase 5** (issues **#232–#246**, `north-star` label; see [`docs/NORTHSTAR_ROADMAP.md`](../NORTHSTAR_ROADMAP.md)). Discovery cycles 3–4 merged 2026-06-06 (#197/#202/#208/#210/#212/#214/#220/#230).

| ID | Slice | Source | Priority | Status | Depends on | Notes |
|----|-------|--------|----------|--------|-----------|-------|
| ORCH-DISCOVERY | Codebase analysis → seed bug/improvement backlog | this turn | P1 | DONE | — | discovery `wf_c7d868c7-3b1` + follow-up audit complete; all 11 resulting D-series PRs merged 2026-06-05 |
| ORCH-HYGIENE | Prune merged local branches + 2 orphaned `worktree-agent-*` | analysis | P2 | DONE | — | completed in Cycle 1; remote cleanup remains separate housekeeping |
| D-HELPER | Shared `isVisiblePasswordField` helper across `sri_checker` + `content_analyzer` | issue #196 | P2 | **DONE** | — | merged as **#197** (2026-06-06). |
| FF-02 | Firefox Vite build config + `src/sw/background.html` + dual build scripts | Roadmap P4-03 / **P5-D3** (session_state prereq **#228**; note #245 is P5-D5 on-device ML, not FF) | P2 | TODO | FF-01 (#173, merged); **AI-4 ✅ decided = `web-ext`** | base of FF stack — now unblocked. **Prereq:** route `session_state.ts` (191/224/232/259) through `storageSessionShim` (else FF crashes on hydrate). |
| FF-03 | `session_state` Firefox compat (`storage.session`→namespaced `storage.local` shim) | Roadmap P4-03 | P3 | TODO | FF-02 | **stacked on FF-02** |
| FF-04 | `world:"MAIN"` guard parity for Firefox + transition-qualifier gaps | Roadmap P4-03 | P4 | TODO | FF-03 | **stacked on FF-03** |
| JSB-127 | JS behavior monitor: perf validation (patch/getter overhead budgets) + residual `JsBehaviorState` dedup | issue #127 | P3 | TODO | — | branch `fix/jsb-stale-todos-and-tests` is **gone** (AI-3 resolved; intent landed via later merges — `computeJsBehaviorScore` is now a live function). Start from current code + #231 cleanup; do **not** chase the dead branch. |
| P4-01c | Visual-sim → **logo-embedding pivot** (retires placeholder pHash to a pre-filter) | Roadmap P4-01 / **P5-D6 (#246)** | P4 | PIVOT ✅ (2026-06-13) | on-device-ML host #245; AI-5 reference logos | Pivot **confirmed by maintainer**; pHash→logo-embedding (Phishpedia 98.2% precision). AI-5 re-scoped to reference logos. |
| P2-GATE-FP | Re-run FP/TP measurement after P4 additions (Phase 2 gate open item) | Roadmap | P4 | TODO | — | `npm run measure:fp`; confirm < 0.1% still holds. Subsumed by **P5-A1** (#232) Smart-Mode-Silence CI gate. |
| P4-04 | Community threat intelligence | Roadmap | P5 | BLOCKED | protocol/privacy product decisions | XL, deferred — not an autonomous pick |
| **NS-P5** | **North-Star Phase 5** — 4 programs (FP-elim / advisor / feedback / architecture) | `docs/NORTHSTAR_ROADMAP.md` | **P1** | TODO | — | **Active track.** Issues **#232–#246**. Best first picks: **#238** (P5-C1 keystone capture-enrichment), **#233** (P5-A2 signal-level gating), **#234** (P5-A3 top-sites tier). |

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

**Codex pickup status (verified 2026-06-14):** `main` @ **`a68958c`** after #251 (`gym:serve` Vite-8 fix). Open PRs: **#249** (P5-C1 / #238, human Gate-3), **#253** (P5-B1 / #236, review fixes pushed through `9a93684`, CI/re-review running), **#254** (draft Codex contract/status refresh plus CI Xvfb apt hardening, CI green), **#255** (P5-A2 / #233 Smart Mode blank-prompt suppression, fixes pushed through `4a77b39`, CI green/re-review running), **#256** (P5-A4 / #235 container intent heuristic, local adversarial review fixes through `9bef0a5`, CI green, Gemini cursor-fallback finding open).

| Slice | Branch | Base | Worktree | PR | Round 1 | Round 2 | Bots | Opened |
|-------|--------|------|----------|----|---------|---------|------|--------|
| P5-C1 / #238 replay-grade `PromptOutcomeEntry` | `feat/p5c1-enrich-prompt-outcome` | `main` | existing branch | #249 | done | done | green | 2026-06-13; waiting on AI-6 manual Chrome Gate-3 + merge |
| P5-B1 / #236 silent-decision events | `feat/p5b1-silent-decision-events` | `main` | root checkout | #253 | done | done | pending after `9a93684` | Latest review comments fixed: commit-confirmed same-tab silent events, JS-driven allowed nav coverage, web-scheme filter, debug-free allowed bridge; local verification green |
| Codex contract/status refresh | `docs/codex-contract-refresh` | `origin/main` | `../NavSentinel-codex-contract` | #254 | Gemini done | Codex done | green after CI fix | Draft docs/CI PR; aligns `AGENTS.md` with `CLAUDE.md`, carries autonomous-loop status sync, and removes redundant Xvfb apt install after hosted-runner Microsoft feed 403 broke E2E |
| P5-A2 / #233 Smart Mode blank-prompt suppression | `feat/p5a2-signal-smart-gating` | `origin/main` | `../NavSentinel-p5a2-smart-gating` | #255 | local security review done | local runtime review done | green after `4a77b39` | Gemini keyboard-activation and Codex Live OAuth/OAuth-tracker feedback fixed; local verification: typecheck, lint, build, focused OAuth/Smart/SW tests 197 pass, targeted E2E 3 pass, perf budget 12/12, full unit 2443 pass |
| P5-A4 / #235 container intent heuristic | `feat/p5a4-container-intent` | `origin/main` | `../NavSentinel-p5a4-container-intent` | #256 | local scoring review done | local coverage review done | green after `9bef0a5`; Gemini finding open | Both local reviews found delegated/sibling navigation-container overlay evasion; fixed before PR by requiring contained underlying action. Gemini now asks for `hasActionIntent` cursor fallback robustness (`endsWith("pointer")`). |

---

## Cycle Log

| # | Date | Slice | Action | Result |
|---|------|-------|--------|--------|
| 17 | 2026-06-14 | P5-B1 / #236 | Addressed latest Codex findings in **PR #253** (`9a93684`): same-tab silent nav events now append from the SW only after matching top-frame commit, JS-driven allowed same-tab navigations get that durable path, true new-window `window.open` stays immediate while same-tab targets avoid duplicates, `ns-nav-allowed` is no longer debug-gated, and host-bearing non-web schemes are rejected. Local verification: focused silent/SW tests 67 pass, typecheck, build, lint, perf-budget 12/12, full unit 2467 pass, rollback E2E 3 pass. | IN-REVIEW |
| 16 | 2026-06-14 | CI / #254 | Fixed pre-existing GitHub Actions E2E setup failure on hosted Ubuntu: `npx playwright install --with-deps chromium` already installs browser deps, while the separate `sudo apt-get update && sudo apt-get install -y xvfb` step failed when Microsoft apt feeds returned 403. Removed the redundant Xvfb apt step from CI and stress workflows. Local validation: `agent:skills:validate`; GitHub CI now green (Build/Unit + E2E, release skipped). | IN-REVIEW |
| 15 | 2026-06-14 | P5-A4 / #235 | Opened **PR #256** (`9bef0a5`) for container-aware `intent_mismatch_under_interactive`: structural nav containers suppress only when the top container contains the underlying action; sibling/full-page/delegated overlays retain the mismatch. Two independent local reviews both found the high-severity evasion in the first implementation; all findings fixed before PR. Local verification: focused scoring/dom-builder tests 120 pass, typecheck, build, lint, perf-budget 12/12 (`capture_isolated` 61.0KB / 62KB), full unit 2433 pass with known happy-dom/network stderr. | IN-REVIEW |
| 14 | 2026-06-14 | P5-A2 / #233 | Addressed Codex OAuth-tracker parity finding in **PR #255** (`4a77b39`): `oauth_monitor.isOAuthUrl()` now recognizes Microsoft Live `/oauth20_authorize.srf`, matching Smart prompt suppression so OAuth mismatch/opener safeguards still arm. Local verification: focused OAuth/Smart/SW tests 197 pass, typecheck, build, lint, targeted E2E 3 pass, perf-budget 12/12 (`capture_isolated` 62.6KB / 63KB), full unit 2443 pass with known happy-dom/network stderr. | IN-REVIEW |
| 13 | 2026-06-14 | P5-A2 / #233 | Addressed Codex Live OAuth review finding in **PR #255** (`6e3421e`): `looksLikeOAuthUrl()` now recognizes `login.live.com` `/oauth20_authorize.srf` while still requiring OAuth query parameters. Local verification: focused Smart gate unit 16 pass, typecheck, build, lint, perf-budget 12/12 (`capture_isolated` 62.6KB / 63KB), targeted E2E 3 pass, full unit 2442 pass with known happy-dom/network stderr. | IN-REVIEW |
| 12 | 2026-06-14 | P5-B1 / #236 | Addressed remaining Codex event-log durability findings in **PR #253** (`42fff89`): bounded retry for delegated `ns-event-log-append`, serialized service-worker event-log writes, and corrupted-row normalization before protected-tail trimming. Local verification: focused storage tests 65 pass, typecheck, build, lint, perf-budget 12/12 (`capture_isolated` 61.3KB / 62KB), full unit 2464 pass with known happy-dom/network stderr. | IN-REVIEW |
| 11 | 2026-06-14 | P5-A2 / #233 | Implemented Smart Mode blank-anchor benign-context suppression in **PR #255** (`e28c3bf`, keyboard fix `df6d13b`): trusted pointer+click or keyboard gating, sub-threshold/benign NRS factor gate, curated IdP OAuth/payment matching, same-host/org low `no_accessible_name` suppression, and Gym/E2E regression. Two independent local adversarial reviews found NRS bypass, arbitrary 3DS-label trust, missing runtime coverage, and synthetic pointer spoofing; all addressed and re-reviewed clean. Gemini review found missing keyboard activation coverage; fixed in `df6d13b`. Local verification: typecheck, lint, build, perf-budget 12/12 (`capture_isolated` 62.6KB / 63KB), targeted E2E 3 pass, full unit 2442 pass with known happy-dom/network stderr. | IN-REVIEW |
| 10 | 2026-06-14 | CODEX PICKUP | Reused canonical orchestrator. Refreshed `AGENTS.md` against `CLAUDE.md` on docs PR **#254** (`71b1e29`, then Gemini formatting fix `e0fa07c`; `agent:skills:validate` pass). Rechecked open PRs. On **#253**, addressed all Gemini/Codex review findings in `da6eb35`: null-safe event log handling, SW-backed `ns-event-log-append`, and awaited credential silent write before resume. Local verification: targeted tests 117 pass, typecheck pass, build pass, perf-budget 12/12 pass, full unit 2461 pass, lint pass. #253/#254 CI and fresh Codex review requested; #249 still human Gate-3 blocked. | IN-REVIEW |
| 0 | 2026-05-30 | bootstrap | Created orchestrator; baseline = typecheck clean, lint 0/0, 2206 tests pass | OK |
| 1 | 2026-05-30 | ORCH-HYGIENE | Pruned 55 merged local branches + 2 orphaned `worktree-agent-*` via `git branch -d` (refuses unmerged, so no work lost); `git worktree prune`. Kept `main` + unmerged `fix/jsb-stale-todos-and-tests`. Note: `origin/feat/ff-browser-shim` still on remote (FF-01 merged via #173) — remote cleanup deferred. | DONE |
| 2 | 2026-05-30 | ORCH-DISCOVERY | Discovery `wf_c7d868c7-3b1`: 14 adversarially-confirmed findings (7 subsystems, 32 agents). Grouped into 7 D-* PRs; seeded issues #175,#176,#178,#179 (#177 dup-closed) + #181 (cross-context, from R1). | DONE |
| 3 | 2026-05-30 | D-PROF | Serialized domain_profile readers + clearDomainProfiles through `pending` chain (#180). R1 (1 approve/1 changes-req) + R2 (changes-req): **all findings fixed** — clearDomainProfiles serialization, test-isolation reset, deterministic no-interleave test, same-domain coverage, afterEach mock restoration, reset caveat doc. Verified by SHA: branch tip `e6036ab`. Prior CI was green, but pickup later found unresolved bot status-doc threads and a stale base. | IN-REVIEW |
| 4 | 2026-05-30 | GATE-CHECK | Pickup verified `main` == `origin/main` == `3eaf3828dff3466937d05c37da457eacdba1df94`. GitHub showed #180 and #182 open/mergeable with green prior CI, but #180 still had three unresolved non-outdated bot review threads and a stale base. Merged current `main` into #180, regenerated `FAILURE_LEDGER.md`, and refreshed roadmap/handoff/orchestrator/index status docs. Local verification: domain-profile focused tests, typecheck, lint, and build passed. #182 remains open and aging. | LOCAL-VERIFIED |
| — | 2026-05-30 | ENV INCIDENT | Harness returned **fabricated tool outputs** (non-existent file API, fake test/commit/push success, empty PR #180 reported as created, dup issue #177, false branch-switch confirmations). Mitigation now standing: one state-changing command per turn; redirect output to temp file + Read back; verify git by SHA (`rev-parse`/`ls-remote`); gh issues/PRs via `--body-file`. **PAUSED here per user instruction** (finish D-PROF, then pause). Next slice when resumed: D-STORE (`appendPromptOutcome` race). | PAUSED |
| 5 | 2026-06-05 | MERGE-BATCH | Maintainer (Chris) **waived Gate 3** (manual Chrome test) for the 11-PR D-series batch; merged oldest-first (#180→#195) as merge commits with `--delete-branch`. 10 merged clean; **#182** conflicted post-#180 on status docs only (`storage.ts`/`sw.ts` auto-merged clean) — resolved by taking `main`, verified locally (tsc clean, lint 0/0, **2298** unit tests pass), CI re-ran **green** (Build/Unit + E2E) on the merge head, then merged. Verified `main`==`origin/main`==`4bd60ce`, 0 open PRs, branches pruned. Deferred manual checks → `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md`. | DONE |
| 6 | 2026-06-05 | DOCS-RECONCILE (#184) | Brought roadmap / AGENT_INDEX / HANDOFF / ORCHESTRATOR / failure_ledger to current truth post-merge; recorded the form-submit patch-order bug (fixed in #185) in `failure_ledger.jsonl`. | DONE |
| 7 | 2026-06-06 | DISCOVERY CYCLES 3–4 | Further discovery + hardening passes (separate sessions). 8 PRs merged: **#197** (#196 shared credential-field helper), **#202** (#188 options import/clear failure), **#208** (homoglyph + IPv6-literal domain spoofs), **#210** (#206 clickfix CAPTCHA-iframe validation), **#212** (#204 adaptive decisive-outcome gate), **#214** (#205 popup gauge scope), **#220** (#207 oauth callback indicator), **#230** (#211 mutation-monitor iframe hostname). Seeded open issues #198–#231. `main` → `da400fb`. | DONE |
| 8 | 2026-06-13 | NORTH-STAR RESEARCH+AUDIT | Re-ran the rate-limited research initiative fresh vs `da400fb`. Internal audit (95 agents, **153 verified findings**) + 3 deep-research passes (broad + 2 gap-fill; a 4th GAP-D pass running). Wrote Phase-5 program plan **`docs/NORTHSTAR_ROADMAP.md`** (D21–D25) + artifacts `docs/research/NORTHSTAR_*`. Filed **15 issues #232–#246** (`north-star`). Re-hydrated roadmap/HANDOFF/ORCHESTRATOR/ACTION_ITEMS to `da400fb`. Cleaned 6 agent-Bash-noise lines from `failure_ledger.jsonl`. AI-3 resolved, AI-4 = web-ext, AI-5 (visual-sim pivot) pending maintainer. Baseline: 2426 tests green. | DONE |
| 9 | 2026-06-13 | P5 SESSION 2 | Merged **#247** (North-Star docs; fixed all 10 gemini+codex review findings first) + **#248** (failure-ledger hygiene: `PostToolUseFailure` → gitignored `failure_autolog.jsonl`; curated ledger scrubbed 78→**7** real entries; `smoke_test.py` made branch-aware; esbuild GHSA + smoke `invalid_signal` ledger entries marked fixed). Implemented **P5-C1 / #238** (replay-grade `PromptOutcomeEntry`: `cds`/`nrsFactors`/`navAnomalyScore`/`adaptiveAdj`/`thresholdUsed`/`elementContext`; nav-`reasons` + cred-`destDomain` consistency) → **PR #249**. Two adversarial review rounds (self-run 23-agent workflow + Codex's 5 findings) — all fixed incl. import-path sanitization, `cursor: url()` privacy drop, block-path `destDomain`, cred action-host. 2444 unit tests, lint 0/0, typecheck clean, **all 12 perf budgets pass** (`capture_isolated` 61→62KB, documented). **#249 awaiting Gate-3 + merge.** Deferred (roadmap follow-up under P5-C5): persist variable-weight NRS input magnitudes for exact offline NRS re-scoring. | IN-REVIEW |
