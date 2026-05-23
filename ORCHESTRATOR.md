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
| T-21 | Test coverage for ui_toast.ts | S | — | #124 | done (2/2 reviews) |
| T-22 | Test coverage for debug_overlay.ts | S | — | #125 | done (2/2 reviews) |
| T-23 | Test coverage for stateMachine.ts (consolidate) | S | — | #126 | done (2/2 reviews) |
| T-24 | Clean stale TODOs + remove dead stub in js_behavior_monitor | S | #127 | #128 | done (2/2 reviews) |
| T-25 | Deduplicate JsBehaviorState from js_behavior_monitor.ts | S | #127 | #129 | done (2/2 reviews) |

### Cycle 5: Type Safety & Next Up

| ID | Task | Effort | Issue | PR | Status |
|---|---|---|---|---|---|
| T-26 | Remove `as any` casts from credential_guard.ts | S | — | #130 | done (2/2 reviews) |
| T-27 | Remove `as any` casts from main_guard.ts + capture_isolated.ts | M | — | #131 | done (2/2 reviews) |
| T-28 | ARIA accessibility + shared seg_control extraction | M | — | #132 | done (2/2 reviews) |
| T-29 | Toggle switch aria-labelledby + aria-describedby | S | — | #133 | done (2/2 reviews) |
| T-30 | Popup accessibility: ARIA labels, live regions, landmarks | S | — | #134 | done (2/2 reviews) |
| T-31 | Decorative icon SVG aria-hidden + onboarding a11y | S | — | #135 | done (2/2 reviews) |
| T-33 | Unit tests for computeCDS scoring — all factors + boundaries | M | — | #136 | done (2/2 reviews) |
| T-34 | Unit tests for computeNRS — all factors, caps, thresholds, dedup | M | — | #137 | done (2/2 reviews) |
| T-35 | Expand popup_model.ts test coverage (5→30 tests) | S | — | #138 | done (2/2 reviews) |
| T-36 | Complete NRS property test generator + cap/threshold invariants | S | — | #139 | done (2/2 reviews) |
| T-37 | Unit tests for icons.ts (icon + logoSentinel) | S | — | #140 | done (2/2 reviews) |
| T-38 | Extract + test options.ts pure utilities (options_model.ts) | S | — | #141 | done (2/2 reviews) |
| T-40 | Tests for normalizeHost, isIPAddress, safeUrlParse in domain.ts | S | — | #142 | done (2/2 reviews) |
| T-42 | Expand credential_guard_model.ts tests (5→34, all branches) | S | — | #143 | done (2/2 reviews) |
| T-43 | Property-based tests for domain.ts utilities (fast-check) | S | — | #144 | done (2/2 reviews) |
| T-44 | Clean stale TODOs + remove dead stub in js_behavior_monitor | S | #127 | #145 | done (2/2 reviews) |
| T-45 | Property tests for visual_sim_hash.ts (hammingDistance, aHash, bHash) | S | — | #146 | done (2/2 reviews) |
| T-46 | Property tests for murmurhash3_32 and computeAdjustment | S | — | #147 | done (2/2 reviews) |
| T-47 | Property tests for smart_defaults.ts (pairKey, analyzeOutcomesForPair, isPairOnCooldownPure) | S | — | #148 | done (2/2 reviews) |
| T-48 | Property tests for nav_anomaly.ts (computeAnomalyScore, applyDecay, normalizeProfile, classifyDomain, pruneBurstRecords) | S | — | #149 | done (2/2 reviews) |
| T-49 | Property tests for domain_groups.ts + allowlist.ts (areSameOrganization, normalizeAllowlist, isAllowlisted) | S | — | #150 | done (2/2 reviews) |
| T-50 | Add missing nrs_js_behavior_suspicious explanation + test coverage | S | — | #151 | done (2/2 reviews) |
| T-51 | Property tests for reputation.ts bloom filter functions | S | — | #152 | done (2/2 reviews) |
| T-52 | Fix silent retry failure in storage append functions + tests | S | — | #153 | done (2/2 reviews) |
| T-53 | Fix importAll bugs: duplicate promptOutcomes check + slice(-0) | S | — | #154 | done (2/2 reviews) |
| T-54 | Property tests for storage.ts round-trip (exportAll/importAll) | S | — | #155 | done (2/2 reviews) |
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
| #124 | test/ui-toast-coverage | T-21 | 2/2 done, all findings fixed | open (ready for human) |
| #125 | test/debug-overlay-coverage | T-22 | 2/2 done, all findings fixed | open (ready for human) |
| #126 | test/state-machine-coverage | T-23 | 2/2 done, all findings fixed | open (ready for human) |
| #128 | fix/js-behavior-stale-todos | T-24 | 2/2 done, all findings fixed | open (ready for human) |
| #129 | fix/dedup-js-behavior-state-v2 | T-25 | 2/2 done, all findings fixed | open (stacked on #128) |
| #130 | fix/credential-guard-type-safety | T-26 | 2/2 done, all findings fixed | open (ready for human) |
| #131 | fix/main-guard-type-safety | T-27 | 2/2 done, all findings fixed | open (ready for human) |
| #132 | fix/a11y-and-function-type | T-28 | 2/2 done, all findings fixed | open (ready for human) |
| #133 | fix/toggle-accessibility | T-29 | 2/2 done, all findings fixed | open (ready for human) |
| #134 | fix/popup-accessibility | T-30 | 2/2 done, all findings fixed | open (ready for human) |
| #135 | fix/icon-svg-accessibility | T-31 | 2/2 done, no actionable findings | open (ready for human) |
| #136 | test/scoring-unit-coverage | T-33 | 2/2 done, all findings fixed | open (ready for human) |
| #137 | test/nrs-factor-coverage | T-34 | 2/2 done, all findings fixed | open (ready for human) |
| #138 | test/popup-model-coverage | T-35 | 2/2 done, all findings fixed | open (ready for human) |
| #139 | test/nrs-property-coverage | T-36 | 2/2 done, all findings fixed | open (ready for human) |
| #140 | test/icons-coverage | T-37 | 2/2 done, all findings fixed | open (ready for human) |
| #141 | refactor/options-model-extract | T-38 | 2/2 done, all findings fixed | open (ready for human) |
| #142 | test/domain-utils-coverage | T-40 | 2/2 done, all findings fixed | open (ready for human) |
| #143 | test/credential-guard-model-expand | T-42 | 2/2 done, all findings fixed | open (ready for human) |
| #144 | test/domain-property-tests | T-43 | 2/2 done, all findings fixed | open (ready for human) |
| #145 | fix/jsb-stale-todos-and-tests | T-44 | 2/2 done, no actionable findings | open (ready for human) |
| #146 | test/visual-sim-property-tests | T-45 | 2/2 done, all findings fixed | open (ready for human) |
| #147 | test/hash-adaptive-property-tests | T-46 | 2/2 done, all findings fixed | open (ready for human) |
| #148 | test/smart-defaults-property-tests | T-47 | 2/2 done, no actionable findings | open (ready for human) |
| #149 | test/nav-anomaly-property-tests | T-48 | 2/2 done, all findings fixed | open (ready for human) |
| #150 | test/domain-groups-property-tests | T-49 | 2/2 done, all findings fixed | open (ready for human) |
| #151 | fix/missing-explanation-code | T-50 | 2/2 done, no actionable findings | open (ready for human) |
| #152 | test/reputation-property-tests | T-51 | 2/2 done, all findings fixed | open (ready for human) |
| #153 | fix/storage-append-silent-failure | T-52 | 2/2 done, all findings fixed | open (ready for human) |
| #154 | fix/importall-bugs | T-53 | 2/2 done, all findings fixed | open (ready for human) |
| #155 | test/storage-property-tests | T-54 | 2/2 done, all findings fixed | open (ready for human) |

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
| #124 | R1 | Claude Opus (x2) | Timer leak in afterEach, replacement test missing second onDismiss, zero/negative timeout missing onDismiss, missing dismiss/throw/XSS/structure/focus/ordering tests, host parentElement/style.all unasserted | Fixed |
| #124 | R2 | Claude Opus | Source bug: double-dismiss calls onDismiss twice (no idempotency guard), replacement test missing getWraps assertion, auto-dismiss tests unpaired | Fixed (source + tests) |
| #125 | R1 | Claude Opus | Missing isolation canary, enum gaps (off/prompt/no), no XSS test, no zero/negative rect, no keyboard input, no non-empty cspInfo.reasons, no external host removal test, no structural order test | Fixed |
| #125 | R2 | Claude Opus | CDS/NRS separation assertions too weak (toContain vs exact line), nrsFactors test missing CDS-side check, misleading test name | Fixed |
| #126 | R1 | Claude Opus | Cross-file contamination (statemachine-timing.test.ts), non-deterministic Math.random, missing aliasing/undefined-pointer tests, misleading test name | Fixed (consolidated files) |
| #126 | R2 | Claude Opus | No findings above threshold | Clean |
| #128 | R1 | Claude Opus | No findings | Clean |
| #128 | R2 | Claude Opus | Dead computeJsBehaviorScore stub (real in shared/), inaccurate issue #127, duplicate JsBehaviorState types, lost perf targets, unaddressed Gemini comment | Fixed (stub removed, issue updated) |
| #129 | R1 | Claude Opus | Incomplete dedup: 5 SCORE_* constants still duplicated | Fixed (re-exported from shared) |
| #129 | R2 | Claude Opus | No findings above threshold | Clean |
| #130 | R1 | Claude Opus (x2) | Dead `typeof` guard on requestSubmit, unaddressed `as SubmitEvent`/`as ClipboardEvent` casts, DOMException instanceof Error (false alarm) | Fixed |
| #130 | R2 | Claude Opus | No findings above threshold | Clean |
| #131 | R1 | Claude Opus (x2) | Reflect.set returns false vs throws for non-writable properties (benign — empty catch blocks) | Acknowledged |
| #131 | R2 | Claude Opus | Dead `?.` on navigator.userActivation (intentionally kept for future Firefox port) | Acknowledged |
| #132 | R1 | Claude Opus | Wrong ARIA pattern (group→radiogroup), missing roving tabindex, wrong aria-current token, keyboard race guard, asymmetric click guards, code duplication | Fixed |
| #132 | R2 | Claude Opus | Missing static aria-checked, unmatched-value fallback, missing unit tests, rapid keyboard race (pre-existing), no keyboard E2E (unit-covered), auto-save asymmetry (pre-existing) | Fixed |
| #133 | R1 | Claude Opus | aria-label→aria-labelledby, missing aria-describedby, similarity toggle label, tests not validating HTML, 3/7 toggles uncovered | Fixed |
| #133 | R2 | Claude Opus | No actionable findings — ID collision/JS reference/E2E impact checks clean | Clean |
| #134 | R1 | Claude Opus | shieldArc needs role="img", SVG needs aria-hidden, dynamic label includes "(no host)", missing edge case test | Fixed |
| #134 | R2 | Claude Opus | shieldArc aria-label doesn't include score value (hidden by R1 aria-hidden fix), missing test | Fixed |
| #135 | R1 | Claude Opus | No actionable findings — pre-existing logo ID collision (low), test icon list manually maintained (low) | Clean |
| #135 | R2 | Claude Opus | No actionable findings — all 20 icon call sites confirmed decorative | Clean |
| #136 | R1 | Claude Opus | Missing titleLength tests, visibility:collapse, role=link, non-interactive cursor | Fixed |
| #136 | R2 | Claude Opus | Missing viewport coverage boundary tests (20%/35%), rounding error in 35% rect | Fixed |
| #137 | R1 | Claude Opus | CSP/navAnomaly boundary at exactly 20 untested, redirect depth=1, missing redirect combination test | Fixed |
| #137 | R2 | Claude Opus | Missing dblclick in individual factors section, CSP threshold test lacked exact NRS assertion | Fixed |
| #138 | R1 | Claude Opus | about:blank assertions too weak, missing empty site string test | Fixed |
| #138 | R2 | Claude Opus | Missing URL-with-port test case | Fixed |
| #139 | R1 | Claude Opus | Redirect chain missing threshold boundary, CSP/navAnomaly tests too narrow (only NRS=0), missing redirect chain cap test, missing pushStateAbuse monotonicity | Fixed |
| #139 | R2 | Claude Opus | Missing navAnomaly cap (15) and CSP cap (10) property tests — inconsistent with clickfix/jsBehavior cap tests | Fixed |
| #140 | R1 | Claude Opus | Missing CSS variable stroke color test, missing gradient URL/ID consistency test | Fixed |
| #140 | R2 | Claude Opus | Animation test too shallow (missing rotation/duration/repeat params), missing empty string edge case | Fixed |
| #141 | R1 | Claude Opus | Missing leading zeros test, fmtTime(NaN) assertion wrong (toLocaleString returns "Invalid Date", not "NaN") | Fixed |
| #141 | R2 | Claude Opus | Double blank lines left by function extraction | Fixed |
| #142 | R1 | Claude Opus | Missing leading-zeros IPv4, bracketed IPv6, whitespace-padded URL tests | Fixed |
| #142 | R2 | Claude Opus | No actionable findings — loose IPv6 regex is design choice | Clean |
| #143 | R1 | Claude Opus | Missing about:blank test for deriveCredentialPasteState, Infinity threshold fallback | Fixed |
| #143 | R2 | Claude Opus | No actionable findings — all branches covered, test naming adequate | Clean |
| #144 | R1 | Claude Opus | Missing LEVENSHTEIN_MAX_LEN guard test, misleading "valid https URLs" description | Fixed |
| #144 | R2 | Claude Opus | Misleading "(up to max len)" parenthetical in test name | Fixed |
| #145 | R1 | Claude Opus | No actionable findings — pure deletion, verified no imports of dead stub | Clean |
| #145 | R2 | Claude Opus | No actionable findings — no stale TODOs remain, remaining items correctly retained | Clean |
| #146 | R1 | Claude Opus | Unused arbHash32 arbitrary, missing color RGB test for grayscale conversion | Fixed |
| #146 | R2 | Claude Opus | No actionable findings — alpha/sizing/division-by-zero all verified correct | Clean |
| #147 | R1 | Claude Opus | Missing high-score allow test (0.3 weight discount path not exercised) | Fixed |
| #147 | R2 | Claude Opus | No actionable findings — cancel neutrality, windowing, avalanche all verified | Clean |
| #148 | R1 | Claude Opus | No actionable findings — all 15 properties verified correct | Clean |
| #148 | R2 | Claude Opus | No actionable findings — streak reset, cooldown expiry, case insensitivity all correct | Clean |
| #149 | R1 | Claude Opus | Dead helper, weak if(score>0) guards, missing idempotence/monotonicity/keyword tests | Fixed |
| #149 | R2 | Claude Opus | Tautological valid-domain test, missing MAX_DECAY_ITERATIONS cap test, dead parameter | Fixed |
| #150 | R1 | Claude Opus | Weak case-merge assertion, all-lowercase generators, missing key isolation/preservation/PSL/whitespace tests | Fixed |
| #150 | R2 | Claude Opus | Preservation property case-collision bug (last-writer-wins mismatch), two tautological determinism tests | Fixed |
| #151 | R1 | Claude Opus | No actionable findings — exhaustive cross-reference confirmed all 48 reason codes covered | Clean |
| #151 | R2 | Claude Opus | No actionable findings — explanation accuracy, PSL codes, wording all verified | Clean |
| #152 | R1 | Claude Opus | Tautological seed test, tautological h2-odd test, deterministic FP probes, missing m=0/ArrayBuffer/bit-uniqueness tests | Fixed |
| #152 | R2 | Claude Opus | Missing insert-idempotency property, non-zero byteOffset untested, insertDomain(k=0) untested | Fixed |
| #153 | R1 | Claude Opus | 24 TS errors (missing `as unknown`), missing afterEach cleanup, tautological logLimit test, no set()/get() throw tests, hardcoded key constants, missing setCount in prompt failure test | Fixed |
| #153 | R2 | Claude Opus | Tautological logLimit (same), untested null/undefined item guard, unfaithful brokenChrome mock, no concurrent appends test, missing resolves assertion | Fixed |
| #154 | R1 | Claude Opus | Missing no-settings logLimit test, removed comment, non-array promptOutcomes untested, adaptive scores clearing design concern | Fixed/Documented |
| #154 | R2 | Claude Opus | Tautological adaptive scores test (2<MIN_OUTCOMES, wrong key), no combined import test, no empty array test | Fixed |
| #155 | R1 | Claude Opus | No-op onSuiteSettingsChange test (mock discards listeners), incomplete settings comparison (6/12 fields), unused variable, slow property bounds | Fixed |
| #155 | R2 | Claude Opus | Optional fields missing from generators (round-trip gap), weak event/outcome count assertions (<=), potential duplicate IDs | Fixed |

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
| NavSentinel-wt-toast | test/ui-toast-coverage | #124 | complete |
| NavSentinel-wt-debug-overlay | test/debug-overlay-coverage | #125 | complete |
| NavSentinel-wt-state-machine | test/state-machine-coverage | #126 | complete |
| NavSentinel-wt-todo-cleanup | fix/js-behavior-stale-todos | #128 | complete |
| NavSentinel-wt-dedup-jsb | fix/dedup-js-behavior-state-v2 | #129 | complete |
| NavSentinel-wt-type-safety | fix/credential-guard-type-safety | #130 | complete |
| NavSentinel-wt-main-guard-types | fix/main-guard-type-safety | #131 | complete |
| NavSentinel-wt-a11y-types | fix/a11y-and-function-type | #132 | complete |
| NavSentinel-wt-toggle-a11y | fix/toggle-accessibility | #133 | complete |
| NavSentinel-wt-popup-a11y | fix/popup-accessibility | #134 | complete |
| NavSentinel-wt-icon-a11y | fix/icon-svg-accessibility | #135 | complete |
| NavSentinel-wt-scoring-tests | test/scoring-unit-coverage | #136 | complete |
| NavSentinel-wt-nrs-factors | test/nrs-factor-coverage | #137 | complete |
| NavSentinel-wt-popup-model | test/popup-model-coverage | #138 | complete |
| NavSentinel-wt-nrs-property | test/nrs-property-coverage | #139 | complete |
| NavSentinel-wt-icons-tests | test/icons-coverage | #140 | complete |
| NavSentinel-wt-options-model | refactor/options-model-extract | #141 | complete |
| NavSentinel-wt-domain-utils | test/domain-utils-coverage | #142 | complete |
| NavSentinel-wt-cred-model-expand | test/credential-guard-model-expand | #143 | complete |
| NavSentinel-wt-domain-props | test/domain-property-tests | #144 | complete |
| NavSentinel-wt-jsb-cleanup | fix/jsb-stale-todos-and-tests | #145 | complete |
| NavSentinel-wt-vsim-props | test/visual-sim-property-tests | #146 | complete |
| NavSentinel-wt-hash-adapt-props | test/hash-adaptive-property-tests | #147 | complete |
| NavSentinel-wt-smart-props | test/smart-defaults-property-tests | #148 | complete |
| NavSentinel-wt-nav-anomaly-props | test/nav-anomaly-property-tests | #149 | complete |
| NavSentinel-wt-domain-groups-props | test/domain-groups-property-tests | #150 | complete |
| NavSentinel-wt-explanation-fix | fix/missing-explanation-code | #151 | complete |
| NavSentinel-wt-reputation-props | test/reputation-property-tests | #152 | complete |
| NavSentinel-wt-storage-fix | fix/storage-append-silent-failure | #153 | complete |
| NavSentinel-wt-importall-fix | fix/importall-bugs | #154 | complete |
| NavSentinel-wt-storage-props | test/storage-property-tests | #155 | complete |

## Notes

- Happy-dom `DOMException [AbortError]` noise in mutation-monitor tests — cosmetic, not a test failure
- `npm audit` after toolchain migration: 7→2 vulns (remaining: rollup via @crxjs/vite-plugin, upstream)
- Issue #106: Closed (all slices merged, stale comments cleaned)
- Issues #86, #90: Closed, AGENT_INDEX updated
- ESLint warnings (59) need #116 merged before addressing
- Codebase scan found: mostly UI entrypoint files (popup.ts, options.ts) lack unit tests — covered by E2E instead
- T-12 (ESLint warnings) is blocked on PR #116 merge since ESLint config only exists on that branch
- After PRs #130 + #131 merge: 18 `as any` casts remain — 13 in main_guard.ts (dynamic patching), 3 in credential_guard.ts (DOM API compat), 1 in capture_isolated.ts (userActivation), 1 error handler
- PR #132: ARIA radiogroup pattern, shared seg_control.ts, 10 new unit tests (1164 total), static aria-checked
- PR #134: Popup ARIA labels, live regions, landmarks, dynamic score label, 13 unit tests (1167 total)
- PR #141: options_model.ts extracted 4 pure functions (pct, avg, fmtTime, parseIntSafe) with 27 tests (1181 total on branch, 46 files)
- PR #136: 52 unit tests for computeCDS scoring (all factors, boundaries, gradients, edge cases). Total 1199+52=1251 on branch.
- PR #137: 51 new tests for computeNRS (was 33, now 84). All NavigationContext factors covered: redirect chains, OAuth, CSP, nav anomaly, diminishing returns. Total 1200+51=1251 on branch.
- ORCHESTRATOR note correction: "zero `as any` casts" was inaccurate — 18 remain (13 main_guard.ts, 3 credential_guard.ts, 1 capture_isolated.ts, 1 credential_guard.ts error handling). Most are legitimate DOM API gaps.
