# NavSentinel Work Orchestrator

Started: 2026-05-23
Mode: Continuous end-to-end task cycle with adversarial reviews

## Active Constraints
- Each PR gets 2 independent adversarial reviews before handoff
- Small incremental commits
- Worktrees for isolation
- Stacked branches when tasks depend on each other
- No PR merges — all PRs left open for human review
- Pre-existing errors and bugs addressed alongside new work

## Task Backlog

### Cycle 1: Hygiene & Bug Fixes (COMPLETE)

| ID | Task | Effort | Issue | PR | Status |
|---|---|---|---|---|---|
| T-01 | Fix `ws` npm audit vulnerability | S | #113 | #114 | done |
| T-02 | Clean stale TODO comments in js_behavior_monitor.ts | S | #106 | #114 | done |
| T-03 | Remove dead `computeJsBehaviorScore` stub | S | #106 | #114 | done |
| T-04 | Update AGENT_INDEX.md (issues, counts) | S | — | #114 | done |
| T-05 | Update Project_Roadmap.md (P4-01, P4-02 status) | S | — | #114 | done |
| T-06 | Close stale issue #106 | S | #106 | — | done |

### Cycle 2: Infrastructure (COMPLETE)

| ID | Task | Effort | Issue | PR | Status |
|---|---|---|---|---|---|
| T-07 | Shadow DOM mutation monitor | M | #97 | #115 | done (stacked on #114) |
| T-08 | Add ESLint flat config + CI lint | M | — | #116 | done (2/2 reviews) |

### Cycle 3: Toolchain & Cleanup (COMPLETE)

| ID | Task | Effort | Issue | PR | Status |
|---|---|---|---|---|---|
| T-09 | Toolchain migration (vite/vitest/esbuild) | L | #113 | #118 | done (2/2 reviews) |
| T-10 | Duplicate JsBehaviorState types cleanup | S | — | #117 | done (2/2 reviews) |
| T-11 | Minor code quality fixes | S | — | #119 | done (2/2 reviews) |

### Cycle 4: CI & Infrastructure Hardening

| ID | Task | Effort | Issue | PR | Status |
|---|---|---|---|---|---|
| T-19 | Add perf budget check to all CI jobs | S | — | #120 | done (2/2 reviews) |
| T-17 | Test coverage for sw.ts service worker | L | — | #121 | done (2/2 reviews) |
| T-18 | Test coverage for credential_modal.ts | M | — | #122 | done (2/2 reviews) |
| T-20 | Test coverage for credential_guard.ts | M | — | #123 | done (2/2 reviews) |
| T-21 | Test coverage for ui_toast.ts | S | — | — | in progress |

### Cycle 5: Next Up

| ID | Task | Effort | Issue | PR | Status |
|---|---|---|---|---|---|
| T-12 | Reduce ESLint warnings (59 remaining) | M | — | — | seeded (needs #116 merged first) |
| T-13 | Visual similarity detection (continue P4-01) | XL | — | — | pending |
| T-14 | FP measurement re-run (Phase 2 gate) | M | — | — | pending |

### Seeded / Future

| ID | Task | Effort | Issue | PR | Status |
|---|---|---|---|---|---|
| T-15 | P4-03: Firefox MV3 port | XL | — | — | pending |
| T-16 | P4-04: Community threat intelligence | XL | — | — | pending |
| T-17 | Test coverage for sw.ts service worker | L | — | #121 | done |
| T-18 | Test coverage for credential_modal.ts | M | — | #122 | done |

## PR Tracker

| PR# | Branch | Task(s) | Reviews | Status |
|---|---|---|---|---|
| #114 | fix/hygiene-stale-todos | T-01 to T-05 | 2/2 done, all findings fixed | open (ready for human) |
| #115 | feat/shadow-dom-mutation | T-07 | 2/2 done, all findings fixed | open (stacked on #114) |
| #116 | infra/eslint-flat-config | T-08 | 2/2 done, all findings fixed | open (ready for human) |
| #117 | fix/dedup-js-behavior-state | T-10 | 2/2 done, all findings fixed | open (ready for human) |
| #118 | infra/toolchain-migration | T-09 | 2/2 done, all findings fixed | open (ready for human) |
| #119 | fix/minor-code-quality | T-11 | 2/2 done, all findings fixed | open (ready for human) |
| #120 | infra/ci-perf-budget | T-19 | 2/2 done, all findings fixed | open (ready for human) |
| #121 | test/sw-coverage | T-17 | 2/2 done, all findings fixed | open (ready for human) |
| #122 | test/credential-modal-coverage | T-18 | 2/2 done, all findings fixed | open (ready for human) |
| #123 | test/credential-guard-coverage | T-20 | 2/2 done, all findings fixed | open (ready for human) |

## Review Log

| PR | Round | Reviewer | Key Findings | Disposition |
|---|---|---|---|---|
| #114 | R1 | Claude Opus | Roadmap count inconsistencies, source file count wrong | Fixed |
| #114 | R2 | Claude Opus | PR range misleading (#101-#105) | Fixed |
| #115 | R1 | Claude Opus | Memory leak (Set→WeakSet), missing NavSentinel host exclusion | Fixed |
| #115 | R2 | Claude Opus | Missing nested shadow test, no host removal cleanup | Fixed |
| #116 | R1 | Claude Opus | E2E broken (_fixtures), no CI lint, dead config, broad ignores | Fixed |
| #116 | R1 | Gemini | Broad ignores, Function type, Node floor, CI lint, eqeqeq style | Fixed/Acknowledged |
| #116 | R2 | Claude Opus | No blocking issues | Clean |
| #117 | R1 | Claude Opus | Orphaned JSDoc fragment | Fixed |
| #117 | R1 | Gemini | Missing re-exports, JSDoc fragment | Fixed/Rebutted |
| #117 | R2 | Claude Opus | No issues | Clean |
| #118 | R1 | Claude Opus | Missing engines field | Fixed |
| #118 | R1 | Gemini | False alarm on vite 8 versions, mock type regression, Node floor | Fixed/Acknowledged |
| #118 | R2 | Claude Opus | Mock type regression, missing vitest.config.ts in tsconfig | Fixed |
| #119 | R1 | Claude Opus | No issues | Clean |
| #119 | R1 | Gemini | — | — |
| #119 | R2 | Claude Opus | No issues | Clean |
| #120 | R1 | Claude Opus | reputation_data.bin MISS risk (not live), release job missing check, E2E missing check, lint gap (covered by #116) | Fixed |
| #120 | R2 | Claude Opus | Unguarded statSync TOCTOU, release job gap, bloom comment misleading, glob-to-regex incomplete | Fixed |
| #121 | R1 | Claude Opus | Async sentinel mock gap, hydration timing (false alarm), OAuth PSL path, weak badge assertions, missing tab removal/boundary/storage tests | Fixed |
| #121 | R2 | Claude Opus | childWindow/oauthFlow removal untested, blockCount clamp not verified, mismatch callbackUrl, 5000ms boundary | Fixed |
| #122 | R1 | Claude Opus (x2) | loadModule in beforeEach, outside-click false positive, orphaned keydown listener (source bug), missing Tab/focus/XSS/empty-actions tests | Fixed |
| #122 | R2 | Claude Opus | Promise leak on modal replacement (source bug), premature focus restore, weak innerHTML/listener assertions | Fixed |
| #123 | R1 | Claude Opus (x2) | Vacuous allowNextSubmit test, redundant dispatchPaste target setter, missing error-catch assertions, missing tests (requestSubmit fallback, paste/toast error, content boost cap, reasons, modal spec, trust outcome) | Fixed |
| #123 | R2 | Claude Opus | Non-conformant defaultConfig/defaultRisk types, timer-expiry untested, SubmitEvent vs Event, WeakMap state docs, weak cap assertion, missing paste getTrusted assertion, error-path field assertions | Fixed |

## Active Worktrees

| Worktree | Branch | PR | Status |
|---|---|---|---|
| NavSentinel-wt-hygiene | fix/hygiene-stale-todos | #114 | complete |
| NavSentinel-wt-shadow | feat/shadow-dom-mutation | #115 | complete |
| NavSentinel-wt-eslint | infra/eslint-flat-config | #116 | complete |
| NavSentinel-wt-dedup | fix/dedup-js-behavior-state | #117 | complete |
| NavSentinel-wt-toolchain | infra/toolchain-migration | #118 | complete |
| NavSentinel-wt-minor-fixes | fix/minor-code-quality | #119 | complete |
| NavSentinel-wt-ci-perf | infra/ci-perf-budget | #120 | complete |
| NavSentinel-wt-sw-tests | test/sw-coverage | #121 | complete |
| NavSentinel-wt-cred-modal | test/credential-modal-coverage | #122 | complete |
| NavSentinel-wt-cred-guard | test/credential-guard-coverage | #123 | complete |

## Notes

- Happy-dom `DOMException [AbortError]` noise in mutation-monitor tests — cosmetic, not a test failure
- `npm audit` after toolchain migration: 7→2 vulns (remaining: rollup via @crxjs/vite-plugin, upstream)
- Issue #106: Closed (all slices merged, stale comments cleaned)
- Issues #86, #90: Closed, AGENT_INDEX updated
- ESLint warnings (59) need #116 merged before addressing
- Codebase scan found: mostly UI entrypoint files (popup.ts, options.ts) lack unit tests — covered by E2E instead
- T-12 (ESLint warnings) is blocked on PR #116 merge since ESLint config only exists on that branch
