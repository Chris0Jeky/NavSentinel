# NavSentinel Project Roadmap

*Created 2026-04-09. Supersedes `Execution_Tracker.md` and `Implementation_Roadmap.md`.*

This is the single source of truth for what needs to be built, in what order, and how to
know it's done. It synthesizes the findings from
[Product Thesis Review](Product_Thesis_Review.md) and
[Comprehensive Project Analysis](Comprehensive_Project_Analysis.md) into an actionable plan.

---

## Status Snapshot

| Phase | Title | Tasks | Done | Status |
|---|---|---|---|---|
| 0 | Stabilize | 6 | 6 | **Done** |
| 1 | Validate Foundation | 8 | 8 | **Tasks done** (gate open — FP rate above target) |
| 2 | Target 2025-2026 Threats | 13 | 3 | **In progress** |
| 3 | Productize | 12 | 0 | Blocked on Phase 2 |
| 4 | Differentiate | 8 | 0 | Future |

Total: **47 tasks** across 5 phases.

Last updated: 2026-05-01

---

## Decision Log

Decisions taken during this planning session. Each is final unless explicitly revisited.

| # | Decision | Rationale |
|---|---|---|
| D01 | **5-phase structure** (0: Stabilize, 1: Validate, 2: Threats, 3: Productize, 4: Differentiate) | Aligns with Thesis Review phases but adds Phase 0 for existing debt. Each phase has a clear gate. |
| D02 | **Single roadmap replaces Execution_Tracker + Implementation_Roadmap** | Two stale planning docs cause confusion. One living document is easier to maintain for a solo dev. |
| D03 | **Task IDs: P{phase}-{seq}** (e.g., P0-01) | Encodes priority implicitly. Easy to reference in commits and PRs. |
| D04 | **Effort: S / M / L / XL** | S: < 4 hours, single focus. M: 4-12 hours, 2-5 files. L: 2-5 days, new subsystem. XL: 1-2 weeks, cross-cutting. |
| D05 | **Branch convention: `{type}/{slug}`** | Types: `fix/`, `feat/`, `test/`, `infra/`, `docs/`. Replaces the `codex/` prefix from the merge era. |
| D06 | **PSL: build-time bundled JSON** | Ship a static JSON asset compiled from publicsuffix.org at build time. No runtime network calls. Add a `scripts/update-psl.mjs` build script. Update manually or via dependabot-like cadence. |
| D07 | **Bloom filter: build-time from free feeds** | Compile from URLhaus + OpenPhish at build time. ~125KB budget for 100K domains. Ship as binary asset. No runtime lookups. |
| D08 | **No ML at this stage** | ML adds model size, inference complexity, and update mechanism overhead. Heuristic/pattern detection keeps the extension light and auditable. Revisit in Phase 4 if heuristics plateau. |
| D09 | **DoubleClickjacking = headline feature** | No consumer extension detects this. The attack bypasses all traditional defenses. NavSentinel is architecturally positioned. This is the single strongest differentiator. |
| D10 | **Drop "(Dev)" branding** | Ship as "NavSentinel". The Dev suffix signals unfinished work and undermines trust. |
| D11 | **Local prompt telemetry** | Track allow/dismiss/trust/block outcomes in `chrome.storage.local`. Display in options page. No data leaves the machine. Enables evidence-based threshold tuning. |
| D12 | **Position: "Catches what Safe Browsing can't see"** | Don't compete on URL reputation (Google wins). Compete on interaction-level detection that cloud tools structurally can't do. Complementary layer positioning. |
| D13 | **Content analysis = pattern matching, not ML** | Match against 20-30 known phishing kit HTML fingerprints. Check brand logo/domain mismatches. Simple, auditable, effective against commodity phishing. |
| D14 | **Phase gates are mandatory** | Don't start Phase N+1 until Phase N gates are met. Prevents scope creep and ensures each layer is solid before building on it. |
| D15 | **Archive old planning docs** | Move `Execution_Tracker.md` and `Implementation_Roadmap.md` to `docs/archive/`. They're historical records of the merge era. |
| D16 | **Local-first thesis maintained across all phases** | No feature may introduce runtime network calls. Build-time data bundling is acceptable. This is the core product thesis and competitive moat. |
| D17 | **NRS: implement per existing spec** | The spec in `Intent_Model_and_Scoring.md` is the design doc. Implement the weights and thresholds as written, then tune based on Phase 1 testing data. |
| D18 | **Test corpus separate from gym** | Phishing snapshots and clickjacking PoCs go under `tests/corpus/`, not `gym/`. Gym remains deterministic local fixtures. Corpus is external samples for validation. |
| D19 | **FP measurement is a Phase 1 gate** | Cannot claim the foundation is validated without knowing the false positive rate. Automated Tranco top-1000 measurement is required before Phase 2 starts. |
| D20 | **Security audit in Phase 3** | Seek a volunteer external security reviewer. The code is clean enough to audit now; the product needs to be feature-complete enough to be worth auditing. |

---

## Phase Overview

### Phase 0: Stabilize
**Goal**: Fix known gaps, recover lost work, establish a clean baseline for forward development.

**Why first**: The project has 13 missing E2E tests, stale docs, and unmerged stress infrastructure. Building new features on a foundation with known gaps creates compounding risk.

**Timeline**: 1-2 weeks.

### Phase 1: Validate Foundation
**Goal**: Harden core heuristics (PSL, CDS evasion, lookalike, NRS) and establish real-world measurement (FP rates, phishing corpus, red-team testing).

**Why second**: The Thesis Review identified specific, fixable weaknesses in the detection logic. Fixing these before adding new capabilities ensures the foundation is sound. Measurement infrastructure ensures future work is evidence-based.

**Timeline**: 4-8 weeks.

### Phase 2: Target 2025-2026 Threats
**Goal**: Add detection for the attack families growing fastest: DoubleClickjacking, ClickFix, OAuth abuse, phishing URLs, phishing content.

**Why third**: The threat landscape has shifted toward browser-context interaction-level attacks. This is NavSentinel's natural territory. The window to be first-to-market on DoubleClickjacking and ClickFix detection is open but closing.

**Timeline**: 8-16 weeks.

### Phase 3: Productize
**Goal**: Transform from developer tool to user-facing product. UX improvements, onboarding, CWS listing, release infrastructure.

**Why fourth**: Product polish without solid detection is theater. Solid detection without product polish is unused. The order matters: security value first, then accessibility.

**Timeline**: 6-12 weeks.

### Phase 4: Differentiate
**Goal**: Advanced capabilities that establish long-term competitive advantage. Visual similarity, JS behavior analysis, cross-browser, community intelligence.

**Why last**: These are high-effort, high-reward capabilities that depend on a validated, shipped product as foundation. They are the long game.

**Timeline**: Ongoing.

---

## Phase 0: Stabilize

### Task Table

| ID | Title | Effort | Status | Depends On | Branch |
|---|---|---|---|---|---|
| P0-01 | Recover missing Wave 2-4 E2E tests | M | **done** | -- | `fix/recover-wave2-4-tests` |
| P0-02 | Land Wave 5 gym fixtures and stress tests | M | **done** | P0-01 | `feat/wave5-stress` |
| P0-03 | Wire stress lane into CI | S | **done** | P0-02 | `feat/wave5-stress` |
| P0-04 | Property tests for scoring and state machine | M | **done** | -- | `feat/wave5-stress` |
| P0-05 | Clean up stale branches | S | **done** | -- | (no branch needed) |
| P0-06 | Archive stale docs and refresh navigation | S | **done** | -- | `docs/roadmap-refresh` |

### Task Details

#### P0-01: Recover missing Wave 2-4 E2E tests

13 E2E tests for RW-08 through RW-20 were lost during the stacked PR merge process. The gym
fixtures exist on `main` but no automated tests exercise them. Tests exist on the
`codex/realworld-wave5-worker-stress` branch.

**What to do**:
- Cherry-pick or manually port the 13 test cases from the wave branches
- Verify each test passes against the existing gym fixtures on `main`
- Add to the regression lane

**Affected scenarios**: RW-08 (OAuth consent reuse), RW-09 (popup ambiguity), RW-10
(keyboard auth), RW-11 (fake invoice), RW-12 (wallet burst), RW-14 (express-pay overlay),
RW-15 (bank alert redirect), RW-16 (doc preview), RW-17 (media overlay), RW-18 (browser
update), RW-19 (tech-support scare), RW-20 (chat widget abuse).

**Files**: `tests/e2e/navsentinel.spec.ts`

**Done when**: All 13 scenarios have passing E2E assertions on `main`. CI green.

#### P0-02: Land Wave 5 gym fixtures and stress tests

RW-21 through RW-25 gym fixtures and the stress test infrastructure were in-progress on the
wave5 branch. A backup patch was saved.

**What to do**:
- Port gym fixtures for RW-21 (allow-once double-spend), RW-22 (rollback after worker
  restart), RW-23 (multi-tab prompts), RW-24 (idle-resume popup), RW-25 (rapid close/reopen)
- Port `playwright.stress.config.ts` and `navsentinel.stress.spec.ts`
- Add `test:e2e:stress` npm script

**Files**: `gym/rw21-*.html` through `gym/rw25-*.html`, `playwright.stress.config.ts`,
`tests/e2e/navsentinel.stress.spec.ts`, `package.json`

**Done when**: Wave 5 fixtures exist, stress spec runs locally, `npm run test:e2e:stress` works.

#### P0-03: Wire stress lane into CI

The stress lane should run on a schedule, not on every PR.

**What to do**:
- Add a `schedule` trigger to `.github/workflows/ci.yml` (e.g., nightly)
- Or create a separate `stress.yml` workflow
- Ensure stress failures produce traces/artifacts for debugging

**Files**: `.github/workflows/ci.yml` or new `stress.yml`, `package.json`

**Done when**: Stress lane runs nightly in CI. Failures produce downloadable traces.

#### P0-04: Property tests for scoring and state machine

The Thesis Review identified that the CDS is "only 68 lines of code with 9 factors -- an
attacker needs about 10 minutes to design around it." Property tests help discover
unexpected edge cases in the scoring logic before attackers do.

**What to do**:
- Add `fast-check` as a dev dependency
- Property tests for `computeCDS` -- verify score monotonicity, bounds, reason code
  consistency, no negative scores
- Property tests for DOM hint builder -- verify hint extraction handles edge-case DOM shapes
- Fake-timer tests for `stateMachine.ts` -- verify token expiry, window boundaries, cleanup

**Files**: `tests/scoring.property.test.ts`, `tests/statemachine-timing.test.ts`, `package.json`

**Done when**: Property tests pass. `npm test` includes them. At least 100 random cases per property.

#### P0-05: Clean up stale branches

10+ merged branches and 3 genuinely stale branches remain on the remote.

**What to do**:
- Delete all branches whose content has been merged to main
- Delete stale unmerged branches: `codex/stacked-credential-edges`,
  `codex/stacked-followups`, `codex/stacked-popup-coverage`
- Preserve `codex/realworld-wave5-worker-stress` until P0-02 is complete

**Done when**: Only `main` and any active development branches remain.

#### P0-06: Archive stale docs and refresh navigation

**What to do**:
- Move `docs/Execution_Tracker.md` to `docs/archive/Execution_Tracker.md`
- Move `docs/Implementation_Roadmap.md` to `docs/archive/Implementation_Roadmap.md`
- Update `docs/README.md` to point to `Project_Roadmap.md` as the active planning doc
- Update `docs/archive/README.md` to list the newly archived files
- Update any cross-references in other docs

**Done when**: `docs/README.md` lists `Project_Roadmap.md` as the active planning doc.
No other doc references the old tracker as current.

### Phase 0 Gate

Phase 0 is complete when:
- [x] All 13 recovered E2E tests pass on main
- [x] Wave 5 gym fixtures and stress spec exist on main
- [x] Stress lane runs in CI on a schedule
- [x] Property tests cover scoring and state machine
- [x] Stale branches deleted
- [x] Documentation navigation updated

---

## Phase 1: Validate Foundation

### Task Table

| ID | Title | Effort | Status | Depends On | Branch |
|---|---|---|---|---|---|
| P1-01 | Public Suffix List integration | L | **done** | P0 gate | `feat/psl-integration` |
| P1-02 | Harden CDS against trivial evasion | L | **done** | P0-04 | `feat/cds-hardening` (PR #20) |
| P1-03 | Enhance lookalike detection | M | **done** | P1-01 | `feat/lookalike-v2` |
| P1-04 | Implement NRS | L | **done** | P1-02 | `feat/nrs-impl` (PR #28) |
| P1-05 | False positive measurement on Tranco top-1000 | L | **done** | P1-01 | `test/fp-measurement` (PR #24); FP rate fix on `fix/fp-rate-reduction` (PR #32); re-run on `test/fp-measurement-rerun` (PR #39) |
| P1-06 | Real-world phishing test corpus | L | **done** | P1-01 | `test/phishing-corpus` (PR #30); corpus run on `test/phishing-corpus-run` (PR #38) |
| P1-07 | CDS evasion red-team test suite | M | **done** | P1-02 | `test/cds-evasion` (PR #25) |
| P1-08 | Local prompt telemetry | M | **done** | P0 gate | `feat/prompt-telemetry` (PR #21) |

### Task Details

#### P1-01: Public Suffix List integration

**The single highest-impact change for credential risk accuracy** (Thesis Review, Section
7.1). The hardcoded 43-entry `MULTIPART_SUFFIXES` in `domain.ts` misclassifies thousands of
cloud-hosted domains. `evil.herokuapp.com` is treated as having registrable domain
`herokuapp.com` when it IS the registrable domain. This means cross-site detection fails
silently for all cloud-hosted phishing.

**What to do**:
- Add `scripts/update-psl.mjs` that fetches the public suffix list from
  `publicsuffix.org/list/public_suffix_list.dat` and compiles it to a JSON trie structure
- Store the compiled PSL as `extension/src/shared/psl_data.json` (or `.ts` const)
- Replace `MULTIPART_SUFFIXES` and `getRegistrableDomain()` in `domain.ts` with PSL-based
  extraction
- Add the update script to the build pipeline
- Add unit tests for cloud domains: `herokuapp.com`, `cloudfront.net`,
  `azurewebsites.net`, `pages.dev`, `workers.dev`, `vercel.app`, `netlify.app`

**Files**: `extension/src/shared/domain.ts`, new `extension/src/shared/psl_data.json`,
new `scripts/update-psl.mjs`, `tests/credential-domain.test.ts`

**Size estimate**: PSL compiles to ~150-200KB JSON. Acceptable for a bundled extension.

**Done when**: `getRegistrableDomain("evil.herokuapp.com")` returns `evil.herokuapp.com`.
All existing domain tests still pass. Cloud-domain tests added and passing.

#### P1-02: Harden CDS against trivial evasion

The Thesis Review (Section 4.2) lists specific evasion techniques that take ~10 minutes to
craft. The CDS needs composite scoring so that multiple weak signals escalate.

**Specific evasion patterns to address**:
1. `opacity: 0.09` (just above the 0.08 threshold) -- add gradient penalty instead of cliff
2. Overlays < 35% viewport -- add scaling penalty for 20-35% range
3. Overlays with `aria-label` -- weight label quality, not just presence
4. `z-index: 9998` -- lower the threshold or add gradient
5. No retargeting (single consistent target) -- rely more on composite signals
6. `display: block; visibility: visible` with deceptive positioning -- add position heuristics

**Design approach**: Shift from binary triggers to weighted factors with diminishing returns.
A single factor below threshold shouldn't trigger, but 3-4 factors near their thresholds
should.

**What to do**:
- Refactor `computeCDS` to support continuous scoring (gradients) for key factors
- Add a composite escalation rule: if 3+ factors contribute non-zero weight, apply a
  multiplier
- Add gym fixtures for each evasion pattern
- Verify no regression on existing gym fixtures

**Files**: `extension/src/shared/scoring.ts`, `extension/src/content/dom_builder.ts`,
new evasion gym fixtures, `tests/scoring.property.test.ts`

**Done when**: No single-factor evasion from the Thesis Review list succeeds. Existing gym
tests still pass. Property tests cover the new scoring logic.

#### P1-03: Enhance lookalike detection

Current lookalike detection uses Levenshtein distance with max 2, which catches `paypa1.com`
but misses `paypal-secure.com`, subdomain stuffing, and visual homoglyphs.

**What to do**:
- Add **subdomain stuffing detection**: flag when a well-known brand name appears as a
  subdomain of an unrelated domain (`paypal.login.example.com`)
- Add **visual homoglyph normalization**: normalize confusable characters before comparison
  (I/l, 0/O, rn/m, vv/w). Use a static confusable-pairs table.
- Add **brand keyword detection**: flag when the registrable domain contains a top-brand
  keyword with extra characters (`paypal-secure.com`, `apple-verify.com`)
- Maintain a small built-in brand list (top 50 phishing targets: Google, Apple, Microsoft,
  Amazon, PayPal, Netflix, banks, etc.)

**Files**: `extension/src/shared/domain.ts`, `tests/credential-domain.test.ts`

**Done when**: Catches `paypal-secure.com`, `paypaI.com` (capital I), `paypal.login.example.com`,
`apple-verify.net`. No false positives on `paypal.com` itself or legitimate subdomains.

#### P1-04: Implement NRS (Navigation Risk Score)

The NRS spec already exists in `docs/Intent_Model_and_Scoring.md`. It layers additional
navigation-context factors on top of CDS.

**What to do**:
- Create `extension/src/shared/nrs.ts` (or extend `scoring.ts`)
- Implement NRS = CDS + navigation factors per the existing spec:
  - New tab/window: +20
  - Cross-site destination: +20
  - Attempt within 0-250ms of pointerdown: +10
  - `navigator.userActivation.isActive`: +5
  - Multiple attempts within one gesture: +25
  - Destination matches allowlist: -100
  - Explicit new-tab intent (middle-click/ctrl): -30
- Wire NRS into `capture_isolated.ts` as the primary navigation decision score
- Expose NRS in debug overlay and event log alongside CDS
- Keep CDS computation unchanged (NRS builds on it)

**Files**: new `extension/src/shared/nrs.ts` or extended `scoring.ts`,
`extension/src/content/capture_isolated.ts`, `extension/src/content/debug_overlay.ts`

**Done when**: NRS computed on every navigation decision. Reason codes include both CDS and
NRS factors. Debug overlay shows both scores. All existing E2E tests still pass (thresholds
may need adjustment).

#### P1-05: False positive measurement on Tranco top-1000

**This is a Phase 1 gate requirement** (Decision D19). Cannot claim the foundation is
validated without knowing the real-world false positive rate.

**What to do**:
- Create `scripts/measure-fp.mjs` that:
  - Fetches the current Tranco top-1000 list
  - Launches Chromium with NavSentinel loaded
  - Visits each site, performs basic interactions (scroll, click 2-3 links)
  - Records every NavSentinel prompt, block, or warning
  - Outputs a CSV report: site, action, NavSentinel response, was-it-correct
- Run manually at first, later automate in CI
- Target: < 0.1% false positive rate on top-1000

**Files**: new `scripts/measure-fp.mjs`, new `tests/fp-results/` (gitignored results)

**Done when**: Script runs, produces a report, FP rate is measured. If rate > 0.1%, create
follow-up tasks to tune thresholds.

**Result (2026-05-01)**: 0.72% FP rate (1/138: unity3d.com). Above 0.1% target.
Follow-up tuning tasks created per the definition above:

1. **Tune NRS/CDS composite scoring for multi-domain ecosystems** — unity3d.com FP is
   caused by `intent_mismatch_under_interactive` (CDS) + `nrs_cross_site` (+20) pushing
   NRS to 70 (block threshold). Options: raise NRS_BLOCK_THRESHOLD, reduce nrs_cross_site
   weight when CDS has only one factor, or add same-organisation domain heuristics.
2. **Re-run measurement after tuning** to verify rate drops below 0.1%.

#### P1-06: Real-world phishing test corpus

Validate detection against real phishing pages, not just synthetic gym fixtures.

**What to do**:
- Create `tests/corpus/` directory structure
- Write `scripts/fetch-phishing-corpus.mjs` that downloads 50-100 phishing page snapshots
  from PhishTank/OpenPhish (HTML snapshots via wget, sandboxed)
- Write a Playwright test that loads each snapshot with NavSentinel and records detection
  outcome
- Track true positive rate (correctly detected) and false negative rate (missed)
- Add a `.gitignore` entry for `tests/corpus/snapshots/` (don't commit third-party HTML)

**Files**: new `scripts/fetch-phishing-corpus.mjs`, new `tests/corpus/`,
new `tests/e2e/corpus-validation.spec.ts`

**Done when**: Corpus test runs against 50+ snapshots. TP/FN rates are measured and recorded.
Results inform P1-02 hardening priorities.

#### P1-07: CDS evasion red-team test suite

Build deliberately evasive overlays to validate that P1-02 hardening worked.

**What to do**:
- Create gym fixtures that combine multiple near-threshold signals:
  - `gym/evasion-01-opacity-009.html` (opacity just above threshold)
  - `gym/evasion-02-size-34pct.html` (viewport coverage just below threshold)
  - `gym/evasion-03-labeled-overlay.html` (overlay with aria-label)
  - `gym/evasion-04-zindex-9998.html` (z-index just below threshold)
  - `gym/evasion-05-composite.html` (combines all near-threshold signals)
- Write E2E tests asserting that composite evasion (evasion-05) is still caught
- Iterate: if any evasion fixture evades detection, create a follow-up task

**Files**: `gym/evasion-*.html`, `tests/e2e/evasion.spec.ts`

**Done when**: All individual evasion fixtures are documented (some may legitimately evade
single-signal detection). The composite evasion fixture is caught. Results feed back into
scoring refinement.

#### P1-08: Local prompt telemetry

Enable evidence-based threshold tuning by tracking how users respond to prompts.

**What to do**:
- Add a `promptOutcomes` store in `chrome.storage.local`:
  - Schema: `{ domain, type (nav|cred), score, outcome (allow|block|trust|dismiss), timestamp }`
  - Bounded to last 500 entries (same pattern as event log)
- Record outcome on every toast allow/block and credential modal decision
- Add a "Prompt Statistics" section to the options page showing:
  - Total prompts, allow rate, trust rate, dismiss rate
  - Top-prompted domains
  - Average score at allow vs. block

**Files**: `extension/src/shared/storage.ts`, `extension/src/content/capture_isolated.ts`,
`extension/src/content/credential_guard.ts`, `extension/src/options/options.ts`,
`extension/src/options/options.html`

**Done when**: Prompt outcomes are recorded. Options page shows statistics. No data leaves
the machine.

### Phase 1 Gate

Phase 1 is complete when:
- [x] PSL integration is live and cloud-domain tests pass
- [x] CDS resists the 5 specific evasion patterns from the Thesis Review (PR #20 merged, PR #25 red-team suite confirms)
- [x] Lookalike detection catches subdomain stuffing, homoglyphs, and brand keywords (PR #22 merged)
- [x] NRS is implemented per spec and wired into navigation decisions (PR #28 merged)
- [ ] False positive rate on Tranco top-200 measured at 0.72% (1/138: unity3d.com); measurement complete but above 0.1% target — follow-up tuning needed for multi-domain ecosystem FPs (PR #24, fixes via PR #32, re-run 2026-05-01)
- [x] At least 50 real phishing pages tested, TP rate measured (P1-06 infrastructure merged via PR #30; corpus run: 100 pages tested, 28% overall TP, 100% credential guard TP on 5 pages with detectable password forms; ~16 additional password-form pages missed due to dynamic JS injection in static snapshots)
- [x] CDS evasion red-team suite exists and composite evasion is caught (PR #25 merged)
- [x] Prompt telemetry is recording locally (PR #21 merged)

---

## Phase 2: Target 2025-2026 Threats

### Task Table

| ID | Title | Effort | Status | Depends On | Branch |
|---|---|---|---|---|---|
| P2-01 | DoubleClickjacking detection | XL | **done** | P1 gate | `feat/double-clickjacking` (PR #36) |
| P2-02 | ClickFix / fake CAPTCHA detection | L | **done** | P1 gate | `feat/clickfix-detection` (PR #37) |
| P2-03 | Local bloom filter URL reputation | L | **done** | P1-01 | `feat/bloom-reputation` (PR #35) |
| P2-04 | Page content fingerprinting | L | pending | P1 gate | `feat/content-fingerprint` |
| P2-05 | OAuth consent flow monitoring | L | pending | P2-01 | `feat/oauth-monitoring` |
| P2-06 | Redirect chain correlation | L | pending | P1-04 | `feat/redirect-chains` |
| P2-07 | DOM mutation monitoring | M | pending | P1 gate | `feat/dom-mutation` |
| P2-08 | History.pushState gating | M | pending | P2-06 | `feat/pushstate-gating` |
| P2-09 | Gym fixtures for new detections | M | pending | P2-01, P2-02 | `test/phase2-gym` |
| P2-10 | Competitive benchmark suite | L | pending | P1-05, P1-06 | `test/competitive-bench` |
| P2-11 | NRS scoring ceiling and compound FP mitigation | M | pending | P2-01, P2-03 | -- |
| P2-12 | Integrate ClickFix scoring into NRS pipeline | M | pending | P2-02 | -- |
| P2-13 | Bloom filter per-frame loading optimization | S | pending | P2-03 | -- |

### Task Details

#### P2-01: DoubleClickjacking detection (HEADLINE FEATURE)

**This is NavSentinel's strongest differentiator opportunity** (Decision D09). No consumer
extension detects DoubleClickjacking. The January 2025 attack bypasses X-Frame-Options, CSP
frame-ancestors, AND SameSite cookies.

**Attack sequence to detect**:
1. User double-clicks on attacker page
2. First click triggers `window.open()` to attacker-controlled child window
3. Child window uses `window.opener.location` to navigate parent to target page (OAuth
   consent, MFA confirm, payment button)
4. Child window closes itself
5. User's second click (from the double-click) lands on the sensitive button in the
   now-navigated parent

**Detection approach**:
- In `main_guard.ts`: already patches `window.open`. Add tracking of
  `window.opener.location` writes.
- In `capture_isolated.ts`: already captures click timing. Add double-click window
  detection (two clicks < 500ms apart where `window.open` fires between them).
- New signal: if a child window modifies `opener.location` and then closes within 1 second,
  flag the next click on the parent as potentially hijacked.
- New CDS/NRS factor: `double_click_hijack_window` with high weight (+40).

**What to do**:
- Add `opener.location` assignment interception in `main_guard.ts`
- Add double-click timing correlation in `capture_isolated.ts`
- Add child-window-close tracking via service worker tab lifecycle
- Create 3+ gym fixtures: basic DoubleClickjacking, OAuth variant, MFA variant
- Add E2E tests

**Files**: `extension/src/content/main_guard.ts`, `extension/src/content/capture_isolated.ts`,
`extension/src/sw/sw.ts`, new gym fixtures, new E2E tests

**Done when**: DoubleClickjacking attack pattern is detected and blocked. No false positives
on legitimate double-click interactions or normal popup flows. At least 3 gym variants pass.

#### P2-02: ClickFix / fake CAPTCHA detection

ClickFix attacks accounted for **47% of all initial access in 2025** (Microsoft). They use
fake CAPTCHA overlays that write malicious commands to clipboard and instruct users to paste.

**Detection approach**:
- In `main_guard.ts`: intercept `navigator.clipboard.writeText()` in main world
- In `capture_isolated.ts`: detect large overlay patterns that match CAPTCHA-like layouts
  (centered box, "verify you are human" text patterns, instruction text)
- New signal: clipboard write + overlay pattern + instruction-to-paste = high risk
- New CDS factor: `clipboard_write_with_overlay` (+35)

**What to do**:
- Patch `navigator.clipboard.writeText` in `main_guard.ts` (similar to `window.open` patch)
- Add content pattern matching for common ClickFix indicators:
  - "verify you are human"
  - "press Win+R" or "press Ctrl+V"
  - "copy and paste"
  - CAPTCHA-like visual structure (centered modal, checkbox icon)
- Track clipboard write events and correlate with overlay state
- Create gym fixtures and E2E tests

**Files**: `extension/src/content/main_guard.ts`, `extension/src/content/capture_isolated.ts`,
new gym fixtures

**Done when**: Fake CAPTCHA + clipboard write pattern is detected. No false positives on
real CAPTCHAs (reCAPTCHA, hCaptcha, Turnstile). At least 2 gym variants pass.

#### P2-03: Local bloom filter URL reputation

Bundle a bloom filter of known-bad domains. Catches 60-70% of active phishing campaigns
without any network calls (Thesis Review, Section 7.2).

**What to do**:
- Add `scripts/build-bloom-filter.mjs` that:
  - Fetches URLhaus and OpenPhish domain feeds
  - Extracts unique domains
  - Compiles to a bloom filter binary
  - Outputs to `extension/src/shared/reputation_data.bin`
- Add `extension/src/shared/reputation.ts` with bloom filter lookup
- Wire reputation check into navigation decisions (NRS factor: `known_bad_domain` +50)
- Wire reputation check into credential guard (risk factor: known-bad domain)
- Add unit tests with known-bad domains and false positive verification

**Size budget**: ~125KB for 100K domains (acceptable for extension bundle).

**Files**: new `scripts/build-bloom-filter.mjs`, new `extension/src/shared/reputation.ts`,
new `extension/src/shared/reputation_data.bin`, `extension/src/shared/scoring.ts` or `nrs.ts`

**Done when**: Bloom filter lookup works. Known-bad domains from test feed are caught.
False positive rate of bloom filter itself is < 0.01%. No runtime network calls.

#### P2-04: Page content fingerprinting

The credential risk model doesn't analyze page content at all (Thesis Review, Section 4.2).
A phishing page on HTTPS with a clean domain that uses JavaScript exfiltration scores risk
= 0. Pattern matching against known phishing kit structures addresses this.

**What to do**:
- Create `extension/src/content/content_analyzer.ts`
- Implement fingerprint checks:
  - Login form + brand logo/favicon from a different domain
  - Page title containing a well-known brand but domain doesn't match
  - Known phishing kit HTML structures (common template fingerprints)
  - Suspicious form action patterns (data: URIs, base64-encoded, javascript:)
- Run analysis on page load and on form focus
- Feed results into credential risk scoring as additional factors
- Start with 20-30 common phishing kit fingerprints

**Files**: new `extension/src/content/content_analyzer.ts`,
`extension/src/content/credential_guard.ts`, `extension/src/shared/domain.ts`

**Done when**: Brand/domain mismatch detection works for top 20 brands. At least 5 phishing
kit fingerprints are detected. No false positives on legitimate brand login pages.

#### P2-05: OAuth consent flow monitoring

OAuth consent phishing rose 146% in 2024. ConsentFix attacks merge fake CAPTCHAs with OAuth
abuse. NavSentinel already gates popups; this extends that to specifically track OAuth flows.

**What to do**:
- Detect OAuth redirect patterns: URL contains `oauth`, `authorize`, `consent`, `login`
  with redirect parameters
- Track the full OAuth flow: initial redirect → consent page → callback
- Flag when a consent flow redirects to an unexpected endpoint
- Flag when `window.opener` is manipulated post-consent
- Wire into NRS as additional factors

**Files**: `extension/src/content/main_guard.ts`, `extension/src/sw/sw.ts`,
`extension/src/content/capture_isolated.ts`

**Done when**: OAuth consent flows are tracked. Unexpected post-consent redirects are flagged.
Legitimate OAuth flows (Google, GitHub, Microsoft) are not disrupted.

#### P2-06: Redirect chain correlation

Multi-hop redirects (A -> B -> C) are invisible because each navigation is evaluated
independently (Thesis Review, Section 4.2). Real malvertising uses 3-7 hop chains.

**What to do**:
- In `sw.ts`: maintain a per-tab navigation chain with timestamps
- Correlate navigations within a 10-second window as a chain
- Score the chain as a whole: if any hop is to a known redirector pattern, elevate risk of
  the final destination
- New NRS factor: `redirect_chain_depth` (scaled by chain length)
- New NRS factor: `redirect_via_known_redirector` (+15 per known redirector hop)
- Cap chain tracking at 10 hops to bound memory

**Files**: `extension/src/sw/sw.ts`, `extension/src/shared/nrs.ts`

**Done when**: Redirect chains are tracked. A 3-hop chain through a redirector elevates the
final destination's score. Chain state is bounded and cleaned up. Existing rollback tests
still pass.

#### P2-07: DOM mutation monitoring

Many attacks inject deceptive elements after the page appears safe. A MutationObserver
catches delayed-injection attacks (Thesis Review, Section 7.8).

**What to do**:
- Add a MutationObserver in `capture_isolated.ts` that watches for:
  - New fixed-position, full-viewport elements added after initial load
  - Form action attribute changes on existing forms
  - Password field injection into existing forms
  - New `<iframe>` elements with suspicious attributes
- Rate-limit observations to avoid performance impact
- Feed mutation signals into CDS/NRS as context

**Files**: `extension/src/content/capture_isolated.ts` or new `mutation_monitor.ts`

**Done when**: Post-load overlay injection is detected. Form action changes trigger
re-evaluation. No measurable performance regression on normal pages.

#### P2-08: History.pushState gating

Detect suspicious same-tab URL manipulation within a short window after a gesture
(from Analysis doc, Section 11).

**What to do**:
- In `main_guard.ts`: patch `history.pushState` and `history.replaceState`
- Track state changes within 2 seconds of a user gesture
- Flag rapid cross-origin-looking pushState changes (URL path dramatically changes)
- Correlate with gesture token state

**Files**: `extension/src/content/main_guard.ts`

**Done when**: Suspicious pushState abuse after gestures is flagged. Normal SPA navigation
is not disrupted.

#### P2-09: Gym fixtures for new detections

Create comprehensive gym coverage for all Phase 2 detection capabilities.

**What to do**:
- DoubleClickjacking variants (basic, OAuth, MFA, payment)
- ClickFix variants (CAPTCHA overlay, clipboard write, Win+R instruction)
- Redirect chain variants (2-hop, 3-hop, through known redirector)
- DOM mutation variants (delayed overlay, form action change, password injection)
- pushState abuse variants

**Files**: `gym/doubleclick-*.html`, `gym/clickfix-*.html`, `gym/chain-*.html`,
`gym/mutation-*.html`, `gym/pushstate-*.html`

**Done when**: Each Phase 2 detection capability has at least 2 gym fixtures (one attack,
one legitimate variant). E2E tests cover all fixtures.

#### P2-10: Competitive benchmark suite

Run the same test corpus against competing tools to quantify NavSentinel's additive value
(Thesis Review, Section 8.5).

**What to do**:
- Create `scripts/benchmark.mjs` that runs a test corpus against:
  - NavSentinel alone
  - Chrome Safe Browsing alone
  - NavSentinel + Safe Browsing together
- Measure detection rate and FP rate for each configuration
- Document results and identify gaps
- Optionally test against uBlock Origin, Netcraft if feasible

**Files**: new `scripts/benchmark.mjs`, new `tests/benchmark-results/`

**Done when**: Benchmark runs. NavSentinel demonstrates additive value over Safe Browsing
alone for interaction-level attacks. Results documented.

#### P2-11: NRS scoring ceiling and compound FP mitigation

NRS has no ceiling. Bloom filter FP (+50) + DoubleClickjacking (+40) + cross-site (+20) +
new-tab (+20) = 130 on a potentially legitimate page. No mitigating factor for "user
previously allowed this popup."

**What to do**:
- Add `openerWindowPreviouslyAllowed` NRS factor (-20)
- Consider a soft ceiling where factors beyond 100 get diminishing returns
- Add test for compound scoring scenarios

**Files**: `extension/src/shared/nrs.ts`, `extension/src/shared/scoring.ts`,
`tests/scoring.property.test.ts`

**Done when**: Compound NRS scenarios are bounded. A page triggering multiple factors does not
produce runaway scores. Previously-allowed popups reduce NRS. Tests cover compound scenarios.

#### P2-12: Integrate ClickFix scoring into NRS pipeline

ClickFix detection runs a parallel scoring pipeline (`scanForClickFix` returns up to 60
points) that isn't fed into NRS. A page doing both ClickFix and navigation manipulation gets
two separate UI interventions with no unified threat score.

**What to do**:
- Add a `clickfixActive` field to `NavigationContext`
- Feed ClickFix score into NRS when both clipboard signals and navigation signals are present
- Unify the UI response so a single threat assessment covers both vectors

**Files**: `extension/src/shared/nrs.ts`, `extension/src/content/capture_isolated.ts`,
`extension/src/content/clickfix_detector.ts`

**Done when**: ClickFix score feeds into NRS when both signals are present. A single unified
UI response is shown. No regression on standalone ClickFix or navigation detection.

#### P2-13: Bloom filter per-frame loading optimization

`capture_isolated.ts` runs in `all_frames`. Each frame loads its own copy of
`reputation_data.bin`. On a page with 10 iframes, that's 10 fetches and 10 ArrayBuffer
allocations.

**What to do**:
- Load bloom filter only in `window.top === window` context
- Expose a message-based lookup API for child frames, or accept the duplication for
  simplicity (local file fetches are fast)

**Files**: `extension/src/content/capture_isolated.ts`,
`extension/src/shared/reputation.ts`

**Done when**: Child frames no longer independently load the bloom filter binary. Reputation
lookups still work for navigations originating from child frames. Performance improvement
measurable on iframe-heavy pages.

### Phase 2 Gate

Phase 2 is complete when:
- [x] DoubleClickjacking detection works and has gym coverage (PR #36 merged)
- [x] ClickFix / fake CAPTCHA detection works and has gym coverage (PR #37 merged)
- [x] Bloom filter catches known-bad domains without network calls (PR #35 merged)
- [ ] Page content fingerprinting detects brand/domain mismatches
- [ ] Redirect chains are correlated and scored as a unit
- [ ] DOM mutations are monitored for post-load injection
- [ ] Competitive benchmark demonstrates additive value
- [ ] No regression in Phase 1 measurements (FP rate, TP rate)

---

## Phase 3: Productize

### Task Table

| ID | Title | Effort | Status | Depends On | Branch |
|---|---|---|---|---|---|
| P3-01 | Plain-English risk explanations | M | pending | P2 gate | `feat/plain-english-ui` |
| P3-02 | Visual risk indicators (icon color) | M | pending | P2 gate | `feat/icon-risk` |
| P3-03 | Smart defaults that learn | M | pending | P1-08 | `feat/smart-defaults` |
| P3-04 | Onboarding flow | L | pending | P3-01, P3-02 | `feat/onboarding` |
| P3-05 | Adaptive scoring with user feedback | L | pending | P1-08, P3-03 | `feat/adaptive-scoring` |
| P3-06 | Chrome Web Store listing | M | pending | P3-01, P3-02 | `docs/cws-listing` |
| P3-07 | Release infrastructure | M | pending | P2 gate | `infra/release` |
| P3-08 | Issue templates and repo hygiene | S | pending | -- | `docs/repo-hygiene` |
| P3-09 | Seek volunteer security audit | S | pending | P2 gate | (no branch) |
| P3-10 | Migrate SW ephemeral state to chrome.storage.session | M | pending | P2-01 | -- |
| P3-11 | jsdom/happy-dom test environment for ClickFix DOM tests | S | pending | P2-02 | -- |
| P3-12 | Bloom filter size monitoring in CI | S | pending | P2-03 | -- |

### Task Details

#### P3-01: Plain-English risk explanations

Replace technical reason codes with user-friendly messages (Thesis Review, Section 5.3).

**Mapping examples**:
- `intent_mismatch_under_interactive` -> "This button is hidden behind another element"
- `no_accessible_name` -> "This clickable area has no visible label"
- `overlay_large_interactive` -> "A large overlay is covering the page"
- `retargeted_target_mismatch` -> "The click target changed between press and release"
- `invisible_but_clickable` -> "An invisible element received your click"
- `double_click_hijack_window` -> "A page tried to hijack your double-click"
- `clipboard_write_with_overlay` -> "This page wrote to your clipboard while showing a fake dialog"

**What to do**:
- Create a reason-code-to-English mapping module
- Use plain English in toast notifications and credential modal
- Keep reason codes available in debug overlay and event log for technical users
- Ensure translations are concise (< 80 characters)

**Files**: new `extension/src/shared/explanations.ts`, `extension/src/content/ui_toast.ts`,
`extension/src/content/credential_modal.ts`

**Done when**: All toast and modal messages use plain English. Debug overlay still shows
reason codes. User doesn't need security knowledge to understand warnings.

#### P3-02: Visual risk indicators (icon color)

Color-code the browser action icon based on page risk level (Thesis Review, Section 5.3).
Gives users passive awareness without modal interruptions.

**What to do**:
- Create icon variants: green (safe/trusted), yellow (caution/elevated), red (risky/blocked),
  gray (extension off)
- Set icon via `chrome.action.setIcon()` based on current page state
- Update on navigation, trust changes, and mode changes
- Add badge text for active block count (optional)

**Files**: `extension/assets/` (new icon variants), `extension/src/sw/sw.ts` or
`extension/src/popup/popup.ts`

**Done when**: Icon changes color based on page risk. Green for trusted domains, yellow for
unknown, red when a block/prompt has fired. Gray when mode is off.

#### P3-03: Smart defaults that learn

If a user always allows a particular site, suggest adding it to the allowlist rather than
prompting every time (Thesis Review, Section 5.3).

**What to do**:
- Use prompt telemetry data (P1-08) to identify patterns
- After 3 consecutive "allow" decisions for the same domain pair, show a suggestion:
  "You've allowed this 3 times. Add to allowlist?"
- Implement as a modified toast with an extra "Always allow" affordance
- Respect user's choice if they dismiss the suggestion

**Files**: `extension/src/content/capture_isolated.ts`, `extension/src/shared/storage.ts`,
`extension/src/content/ui_toast.ts`

**Done when**: Repeated allow patterns trigger an allowlist suggestion. User can accept or
dismiss. Allowlist is updated if accepted.

#### P3-04: Onboarding flow

A new user installs and immediately gets prompts with no context (Thesis Review, Section 5.2).

**What to do**:
- Create an onboarding page that opens on first install
- Walk through: what the extension does, what prompts look like, how to respond
- Use gym fixtures as interactive examples (safe, sandboxed)
- Show the extension detecting a gym attack and explain what happened
- End with: how to adjust settings, how to trust domains, how to report issues

**Files**: new `extension/src/onboarding/` directory, `extension/src/sw/sw.ts` (first-install
detection via `chrome.runtime.onInstalled`)

**Done when**: Onboarding page opens on first install. User understands the extension's
purpose and how to use it within 2 minutes.

#### P3-05: Adaptive scoring with user feedback

Use prompt outcome data to adjust thresholds locally (Thesis Review, Section 7.9). The
extension learns from the user's decisions without telemetry.

**What to do**:
- Per-domain score adjustment: if user consistently allows a domain at score X, slightly
  lower the effective threshold for that domain
- Per-domain score adjustment: if user consistently blocks, slightly raise sensitivity
- Bound adjustments: threshold can shift by at most +/- 15 from base
- Store adjustments in `chrome.storage.local`
- Expose adjusted thresholds in debug overlay

**Files**: `extension/src/shared/storage.ts`, `extension/src/content/capture_isolated.ts`,
`extension/src/shared/scoring.ts`

**Done when**: Adaptive adjustments happen. Adjustments are bounded. Debug overlay shows
effective thresholds. Reset option available in settings.

#### P3-06: Chrome Web Store listing

Prepare and submit for CWS distribution.

**What to do**:
- Write store description using the positioning from Decision D12
- Create screenshots (popup, blocked navigation, credential prompt, options page)
- Write privacy disclosure (aligns with existing PRIVACY.md)
- Prepare promotional assets
- Handle CWS review requirements

**Headline claim** (from Thesis Review, Section 10):
"The only browser extension that detects DoubleClickjacking, ClickFix overlays, and OAuth
consent flow abuse -- without sending your data anywhere."

**Done when**: Extension is listed and installable from CWS.

#### P3-07: Release infrastructure

**What to do**:
- Drop "(Dev)" from `manifest.json` name -> "NavSentinel" (Decision D10)
- Add CHANGELOG.md with keep-a-changelog format
- Add `scripts/release.mjs` that bumps version, updates changelog, creates tag
- Add GitHub Release creation (manual or via CI)
- Ensure `verify:versions` checks new fields

**Files**: `extension/manifest.json`, new `CHANGELOG.md`, new `scripts/release.mjs`,
`.github/workflows/ci.yml`

**Done when**: Release workflow exists. Version bumps are scripted. Tags create GitHub Releases.

#### P3-08: Issue templates and repo hygiene

**What to do**:
- Add `.github/ISSUE_TEMPLATE/` with templates for:
  - Bug report (with repro steps, extension version, OS/browser)
  - Feature request
  - Security vulnerability (point to SECURITY.md)
  - False positive report (with site, expected behavior, actual behavior)
- Add pull request template

**Files**: `.github/ISSUE_TEMPLATE/*.md`, `.github/PULL_REQUEST_TEMPLATE.md`

**Done when**: Templates exist and render correctly on GitHub.

#### P3-09: Seek volunteer security audit

The code is clean and readable but hasn't been reviewed by an external security professional
(Thesis Review, Section 6).

**What to do**:
- Identify potential reviewers (security-focused OSS contributors, academic contacts)
- Prepare a focused audit scope document (bridge security, CDS evasion, storage isolation)
- Reach out with the scope and a link to the repo
- Address findings

**Done when**: At least one external security professional has reviewed the bridge design
and CDS logic. Findings addressed or documented as accepted risks.

#### P3-10: Migrate SW ephemeral state to chrome.storage.session

All SW Maps (`childWindowByTab`, `allowUntilByTab`, `gestureUntilByTab`, etc.) are lost on
MV3 SW restart. DoubleClickjacking detection fails silently if SW restarts mid-detection.

**What to do**:
- Migrate critical tab state to `chrome.storage.session` (survives SW restart, cleared on
  browser close)
- Keep TTL-based cleanup
- Requires Chrome 102+

**Files**: `extension/src/sw/sw.ts`, `extension/src/shared/storage.ts`

**Done when**: Critical tab state survives SW restart. DoubleClickjacking detection works
across SW lifecycle boundaries. TTL cleanup still functions. Existing E2E tests still pass.

#### P3-11: jsdom/happy-dom test environment for ClickFix DOM tests

7 ClickFix tests are skipped because they require DOM environment (`hasLegitCaptcha` tests
that check for iframes, class names). Currently verified via gym fixtures only.

**What to do**:
- Configure Vitest with jsdom or happy-dom environment for `clickfix-detector.test.ts`
- Move from `.skipIf(!hasDOM)` to always-run

**Files**: `vitest.config.ts`, `extension/src/content/clickfix_detector.test.ts`

**Done when**: All 7 previously-skipped ClickFix DOM tests run and pass in CI. No
`.skipIf(!hasDOM)` guards remain.

#### P3-12: Bloom filter size monitoring in CI

`reputation_data.bin` will grow when real phishing feeds are used. Need to enforce the 2MB
cap and alert on unexpected size changes.

**What to do**:
- Add a CI step that checks `reputation_data.bin` size and fails if > 2MB
- Add the bloom filter build to the CI pipeline

**Files**: `.github/workflows/ci.yml`, `scripts/build-bloom-filter.mjs`

**Done when**: CI fails if bloom filter exceeds 2MB. Bloom filter build is reproducible in CI.

### Phase 3 Gate

Phase 3 is complete when:
- [ ] All user-facing messages are in plain English
- [ ] Icon changes color based on page risk
- [ ] Smart defaults suggest allowlist additions
- [ ] Onboarding flow exists and works on first install
- [ ] Extension is listed on Chrome Web Store
- [ ] Release workflow is scripted
- [ ] Issue templates exist
- [ ] At least one external security review completed

---

## Phase 4: Differentiate

These tasks are the long game. They depend on a shipped, validated product (Phase 3) and are
ordered by estimated impact. Timelines are intentionally open-ended.

### Task Table

| ID | Title | Effort | Status | Depends On |
|---|---|---|---|---|
| P4-01 | Visual similarity detection | XL | pending | P3 gate |
| P4-02 | JavaScript behavior analysis | XL | pending | P3 gate |
| P4-03 | Cross-browser port (Firefox MV3) | XL | pending | P3 gate |
| P4-04 | Community threat intelligence | XL | pending | P3 gate |
| P4-05 | CSP / permissions analysis | L | pending | P2 gate |
| P4-06 | Sub-resource integrity awareness | M | pending | P2 gate |
| P4-07 | Per-domain behavioral profiling | L | pending | P1-08 |
| P4-08 | Navigation pattern anomaly detection | L | pending | P4-07 |

### Task Details

#### P4-01: Visual similarity detection

Screenshot the page and compare against known brand login page templates using perceptual
hashing. Catches phishing pages that perfectly mimic a login form regardless of domain or
URL. Libraries like `blockhash` work entirely client-side.

**Key decisions (deferred)**:
- Template set: which brand login pages to include
- Hash algorithm: blockhash vs. pHash vs. dHash
- Performance budget: how often to capture/compare
- Storage: where to keep the template database

#### P4-02: JavaScript behavior analysis

Monitor for suspicious JavaScript patterns: form submit handlers that POST to unexpected
endpoints, clipboard access, credential field value reads, beacon/fetch to third parties
during form submission.

**Key decisions (deferred)**:
- Interception scope: which APIs to patch in main world
- Performance budget: overhead of monitoring fetch/beacon
- False positive management: many legitimate sites read form values

#### P4-03: Cross-browser port (Firefox MV3)

When Firefox MV3 stabilizes, port the extension. The architecture is already mostly
portable (TypeScript, Vite). Main differences: WebExtension API naming, popup behavior,
content script injection timing.

**Key decisions (deferred)**:
- When Firefox MV3 is stable enough
- Whether to maintain a single codebase or fork
- Build system changes needed

#### P4-04: Community threat intelligence

Optional, privacy-preserving shared intelligence. Users can opt-in to share anonymized
threat signals (domain hashes, not URLs) with other NavSentinel users.

**Key decisions (deferred)**:
- Protocol design: what data is shared, how it's anonymized
- Infrastructure: peer-to-peer vs. lightweight relay
- Privacy guarantees: differential privacy, k-anonymity, or other mechanism
- Governance: who runs the relay, how is abuse prevented

#### P4-05: CSP / permissions analysis

Analyze page CSP headers and permission requests as additional risk signals. A page with
no CSP or an overly permissive CSP in combination with other risk signals elevates concern.

#### P4-06: Sub-resource integrity awareness

Flag when scripts or resources loaded during navigation lack SRI hashes, particularly on
pages that handle credentials.

#### P4-07: Per-domain behavioral profiling

Track per-domain navigation patterns over time to detect sites that consistently trigger
suspicious scores. Sites with a pattern of near-threshold activity are more suspicious than
sites that occasionally trigger one factor.

#### P4-08: Navigation pattern anomaly detection

Build a local model of the user's normal navigation patterns. Flag significant deviations
(e.g., the user never visits crypto sites but suddenly navigates to three wallet-connect
pages in 10 seconds).

---

## Cross-Cutting Concerns

### Security Testing Program

The Thesis Review (Section 8) defines a comprehensive testing methodology. It is not a
single task but a practice that evolves across phases:

| Phase | Testing Focus |
|---|---|
| 0 | Recover existing E2E coverage, add property tests |
| 1 | FP measurement (Tranco 1000), phishing corpus, CDS evasion red-team |
| 2 | New-detection gym fixtures, competitive benchmarks |
| 3 | Onboarding usability testing, CWS review compliance |
| 4 | Continuous corpus expansion, community-reported samples |

**Industry benchmark targets** (from Thesis Review, Section 8.1):

| Metric | Target | Phase to measure |
|---|---|---|
| Clickjacking TP rate | > 80% | Phase 1 |
| Phishing URL TP rate | > 60% | Phase 2 (after bloom filter) |
| Credential theft TP rate | > 50% | Phase 2 (after content fingerprinting) |
| FP rate on Tranco top-1000 | < 0.1% | Phase 1 |
| FP rate on common workflows | 0% | Phase 1 |
| CDS evasion resistance | No trivial bypass | Phase 1 |
| Bridge security | No page-accessible bypass | Phase 3 (audit) |

### Documentation Maintenance

Update these docs as capabilities change:

| Doc | Update trigger |
|---|---|
| `Intent_Model_and_Scoring.md` | Any scoring/NRS/CDS change |
| `Architecture_and_Data_Flow.md` | New runtime components (mutation monitor, content analyzer) |
| `Testing_and_Gym.md` | New test lanes or gym fixtures |
| `Threat_Model_and_Cases.md` | New detection capabilities |
| `SECURITY.md` | Security audit findings |
| `PRIVACY.md` | Any new data storage |
| `README.md` | Major feature additions |

### Performance Budget

The extension must remain lightweight. Budget per navigation:

| Operation | Budget |
|---|---|
| CDS computation | < 5ms |
| NRS computation | < 10ms |
| Bloom filter lookup | < 1ms |
| Content fingerprinting | < 50ms |
| DOM mutation check | < 5ms per mutation batch |
| Total per-navigation overhead | < 100ms |

Extension bundle size budget:

| Component | Budget |
|---|---|
| Extension JS (minified) | < 200KB |
| PSL data | < 200KB |
| Bloom filter | < 150KB |
| Icons and assets | < 50KB |
| Total extension size | < 600KB |

---

## Archived Documents

These planning documents are superseded by this roadmap and should be moved to
`docs/archive/`:

| Document | Reason |
|---|---|
| `docs/Execution_Tracker.md` | Tracked the post-merge batch plan (Batches 1-7). All batches either complete or absorbed into this roadmap. |
| `docs/Implementation_Roadmap.md` | Tracked post-merge follow-up themes. Content absorbed into Phase 0 and Phase 1 of this roadmap. |

Documents that remain active and are **not** archived:

| Document | Why it stays |
|---|---|
| `docs/Real_World_Adversarial_Program.md` | Scenario backlog is still the source of truth for gym fixture design. Referenced by Phase 0 tasks. |
| `docs/Testing_Expansion_Strategy.md` | Test lane strategy remains valid. Referenced by Phase 0 and Phase 1 tasks. |
| `docs/Demo_Showcase_Plan.md` | Demo system is complete and the plan documents it. |

---

## References

- [Product Thesis Review](Product_Thesis_Review.md) -- Critical assessment of security
  value, usability, competitive positioning, and expansion strategy
- [Comprehensive Project Analysis](Comprehensive_Project_Analysis.md) -- Full repo
  inventory, gap analysis, architecture deep dive, and recommended next steps
- [Intent Model and Scoring](Intent_Model_and_Scoring.md) -- CDS and NRS specifications
- [Real-World Adversarial Program](Real_World_Adversarial_Program.md) -- Scenario backlog
- [Testing Expansion Strategy](Testing_Expansion_Strategy.md) -- Test lane strategy
- [Architecture and Data Flow](Architecture_and_Data_Flow.md) -- Runtime layer documentation
