# NavSentinel Project Roadmap

*Created 2026-04-09. Truth refresh 2026-07-10; live/status sync 2026-07-17.*

This is the execution roadmap. [`Product_Strategy.md`](Product_Strategy.md) owns
the product thesis, portfolio boundaries, and evidence gates; GitHub issues own
implementation detail; [`ACTION_ITEMS.md`](../ACTION_ITEMS.md) owns human-only
work. The phase/task material below remains useful implementation history, but
phase labels and artifact counts must not be read as product readiness.

---

## Status Snapshot

| Phase | Title | Tasks | Implementation artifacts merged | Validation/release state |
|---|---|---|---|---|
| 0 | Stabilize | 6 | 6 | Engineering baseline complete |
| 1 | Validate Foundation | 8 | 8 | **Validation gate open** (stale FP result; invalid corpus result) |
| 2 | Target interaction threats | 13 | 13 | **Efficacy/competitive gate open**; reputation asset is a test fixture |
| 3 | Productize | 12 | 12 | **Release/distribution gate open**: drafts/scope are not CWS distribution or an audit |
| 4 | Differentiate | 8 | 4 | **Frozen** until beta evidence; visual-sim is queued for removal and JS behavior is unmeasured |

The historical registry contains 47 implementation tasks; 43 have merged
artifacts. Do not publish that ratio as a product-completion score. Product
readiness is tracked only by the outcome gates below.

**Completed cross-cutting initiative:** UI Redesign (9 phases, R1–R9) — done 2026-05-16. See [REDESIGN_ORCHESTRATION.md](REDESIGN_ORCHESTRATION.md).

### Current outcome gates

| Gate | State | Required next move |
|---|---|---|
| Release integrity | **Blocked** | Complete RI-01 beyond #464's synthetic-input rejection and #466's dormant broker boundary; finish #356 Gate-3; excise visual-sim (#424); remove fake DNR; purpose-specific data minimization; beta-off JS behavior; #175/#186 bridge identity/recovery |
| Release profile | **Decision required** | AI-9/AI-16 choose the recommended interaction-only beta or a reproducible, budgeted real reputation build |
| Brand/store | **Blocked** | AI-19 name clearance; #455 pre-collection disclosure/consent; one canonical claims-verified listing; assets and fresh-install checks |
| Detection validation | **Open** | #417 methodology, #416/#426 rerun, confidence-aware reporting |
| Comparative value | **Open** | #418 against current Chrome and relevant Chrome extensions; Edge/Opera remain contextual until supported |
| Distribution | **Not started** | unlisted beta, 15 invitations, 10 activated daily-use installs, D14/D30 check-ins |
| Public security posture | **Blocked** | independent external review of the exact beta commit/package |

### Live execution truth

Verified 2026-07-17: root `main` matched `origin/main`; v0.4.0; main CI green;
80 open issues; no milestone, tag, GitHub release, CWS release, or branch
protection. The exact audit baseline is recorded only in dated
`Product_Strategy.md`; verify live. Current PR truth:

| PR | Current state |
|---|---|
| #273 | Closed 2026-07-13 from a stale base; recreate from current `main` or defer |
| #356 | Current-main refresh passes 2,875 unit plus 65/65 E2E; its live precheck must confirm local/remote/PR equality, two fresh exact-head reviews, and green CI before AI-13 |
| #399 | Closed 2026-07-13; measurement-held under #223/#417 and not a beta blocker |
| #463 | Merged exact green dependency head `91aab4f` as `2888483`; #459 closed as intended |
| #464 | Current-main refresh passes 2,874 unit plus 65/65 E2E; its live precheck must confirm local/remote/PR equality, two fresh exact-head reviews, and green CI before AI-21 |
| #466 | Open RI-01 dormant pending-decision SW boundary; three runtime blockers fixed, emitted static-worker gate added in `dfea4da`, parser replaced by a real module lexer in `ddfacf0`, unsupported import attributes rejected in `c0305f9`, and session-stored signals restricted to finite codes in `2402297`; live exact-head reviews/CI and AI-22 remain |

**RI-01 implementation note (verified 2026-07-17):** PR #464 isolates the
production synthetic-navigation sub-slice: only trusted input can mint
navigation allowances, a preceding trusted pointerdown remains risk evidence,
and an untrusted `_blank` click cannot enter the benign-anchor exemption. Its
targeted attack/compatibility checks and all 65 one-worker E2E tests passed on
its pre-dependency head; AI-21 real-Chrome Gate-3 remains mandatory after its
current-main refresh. PR #466 now supplies a dormant, context-bound
pending-decision service-worker boundary: shared contracts/store, authenticated
content/extension senders, browser-derived tab/frame/document context, a
worker-owned destination capability, positive current-frame enumeration,
one-shot consumption, and top-navigation/tab cleanup. Its broker factory is
statically imported through a dedicated MV3-compatible module chunk while
construction stays deferred, preserving the service-worker budget without
unsupported `import()`. Build and package now fail if that emitted worker graph
regresses to dynamic/preload, missing, remote, or out-of-dist imports. It executes
no action. Remaining RI-01 work includes a real producer and extension-origin
presentation/actions, removing injected allow/trust/resume authority, integrated
branch gates, trusted-click redressing coverage, and real Chrome verification.
Windows Defender quarantined one tracked adversarial ClickFix property fixture
only in the older checkpoint worktree; AI-20 owns the human review.

The North-Star and Horizon documents are frozen option portfolios. Their 15
Horizon issues (#439–#453) do not authorize implementation and should be culled
or moved to a post-beta milestone. Start each session with
[`HANDOFF.md`](agentic/HANDOFF.md), live GitHub state, and
[`ACTION_ITEMS.md`](../ACTION_ITEMS.md).

### Corrective action register

This is the single mutable action register. Reuse existing issues to avoid
backlog inflation; rows without a public issue remain release tasks until the
maintainer chooses disclosure/ownership.

| ID | Priority | Action | Owner/gate | Existing home | Done when |
|---|---|---|---|---|---|
| RI-01 | P0 beta blocker | Move all proceed/allow/trust/resume authority out of page-injected UI | Agent + Gate-3 | Private release task | Injected UI is warn/cancel only; extension-origin action is tab/destination-bound with TTL; synthetic input, trusted-click redressing, host tamper/removal, tab switch, and stale state cannot lower protection |
| RI-02 | P0 beta blocker | Excise visual-sim capture, templates, scoring hook, WAR, tests, and state | Agent + Gate-3 | #424 | No viewport capture path or placeholder asset remains; #374 is optional coordination, not a prerequisite |
| RI-03 | P0 beta blocker | Finish #356 human Gate-3; recreate or defer #273 | Chris + agent | #273/#356; #399 stays deferred | #356's current exact head passes Gate-3 and merge gates; any #273 replacement guide points only to a current green branch; #399 remains outside beta blockers until its measurement methodology is ready |
| RI-04 | P0 product decision | Implement the selected interaction-only or real-reputation profile | Chris + agent | #321 / AI-9 / AI-16 | Release script, tag CI, manifest/WAR, runtime initialization, package checks/budgets, tests, provenance/cadence (if real), and every claim agree for the selected profile; verify both only if both are intentionally retained |
| RI-05 | P0 beta blocker | Remove fake DNR feature surface and unused permissions | Agent + Gate-3 | CWS checklist; redesign #242/#243 later | No test rules/toggle/DNR permission in beta manifest |
| RI-06 | P0 privacy blocker | Inventory every store; minimize by purpose; add complete reset | Agent + privacy review | Extend #176 or seed one scoped follow-up | Persistent records use least-identifying data; exact session URLs remain only for correctness with tab binding/TTL; rollback/OAuth/allow tests pass; all behavioral stores have one clear control and accurate export/disclosure |
| RI-07 | P0 beta blocker | Add an explicit beta capability flag that leaves JS behavior instrumentation off | Agent + Gate-3 | #127 or a scoped release-profile issue | Fresh beta defaults/migration/UI/runtime agree; fetch/XHR/beacon/password-value prototypes are not wrapped; core navigation remains active; compatibility/perf evidence required to enable |
| RI-08 | P0 beta blocker | Authenticate/recover the MAIN-world bridge and fail closed when unavailable | Agent + Gate-3 | #175/#186 | Hostile page code cannot become the trusted peer or suppress protection; reload/death recovery is bounded and tested |
| RI-09 | Public-launch blocker | Obtain an independent external security review | Agent + external reviewer | P3-09 | Exact release commit/package reviewed; findings resolved or explicitly accepted |
| PM-01 | P0 release blocker | Clear or replace the working product name | Chris | AI-19 | Search/domain/CWS/legal decision recorded before submission |
| PM-02 | P0 release blocker | Verify one canonical store/privacy copy and reporting route against the package | Agent + Chris submission | `docs/cws-listing/`; `SECURITY.md` | Correct category, complete data inventory, supported claims, private vulnerability route, derived minimum Chrome, assets/fresh install complete |
| PM-03 | P0 beta compliance blocker | Add pre-install disclosure/consent evidence plus in-product activation | Agent + Gate-3 | #455 | CWS listing/install consent mapping is evidenced; fresh installs stay passive until in-product activation; Limited Use declaration, categories/uses, and revocation/reset match the package |
| EV-01 | P1 after integrity | Recruit and measure the first daily-use cohort | Chris-led | #425 — rebody before use | 15 invitations; 10 activated; 7/10 enabled D14 and 6/10 D30; every non-install/disable reason recorded |
| EV-02 | P1 | Finish valid FP/TP methodology and reproducible runs | Agent + headed/network gate | #416/#417/#426 | Committed inputs/results and confidence-aware reporting; no tune-before-measure |
| EV-03 | P1 | Compare additive value with current protections | Agent + headed lane | #418 | Pre-registered scenarios/configurations; wins, misses, interruption, performance, and data flow published |
| EV-04 | P1 after integrity | Measure representative-site compatibility and runtime overhead | Agent + headed lane | Reuse #127/#420; no new issue before queue cull | Declared normal journeys have zero unexplained functional breakage/page errors; startup/action latency and CPU budgets are fixed, measured, and published before broad instrumentation is enabled |
| OPS-01 | P1 | Rotate roadmap/orchestrator and cull duplicate epics | Agent + Chris dispositions | #437 and #439–#453 | Short current roadmap, archived history, one milestone-categorized queue |

### Existing issue dispositions

- #415: create one `v0.5.0-unlisted-beta` milestone containing only real blockers.
- #321: replace "build the filter" with RI-04 and the AI-9 decision.
- #356: P0; require the refreshed branch's live head-equality, exact-head
  review, and CI precheck, then hold for AI-13 human Gate-3. Recreate/defer #273; #399 is closed and remains
  measurement-deferred under #223/#417.
- #419/#421/#422: close enacted scope; retain only concrete unfinished work.
- #423: close when the verified-claims policy lands.
- #424: rebody as RI-02; move #245/#246 to post-beta or close them.
- #425: replace public-launch-first/WAU wording with integrity-gated dogfood,
  15 invitations, 10 activated installs, and manual D14/D30 measurement; no
  public launch before the external review and no WAU KPI without an approved
  collection mechanism.
- #426: rebody as blocked on #417 plus a headed rerun.
- #437: rotate this file and ORCHESTRATOR after release-integrity work.
- #439 duplicates #420; cull or post-beta-milestone the remaining Horizon issues.
- Verify #184 against current truth and close it if reconciliation is complete.

### 90-day sequence

1. **Weeks 0–2:** freeze features; complete RI-01–RI-08 and PM-03, refresh PRs,
   clear the name/profile, and align package/store/privacy truth. Run headed
   checks only after agent preflight.
2. **Weeks 3–4:** package/submit unlisted; invite 15 daily-use users; record
   every failed install/onboarding and establish the 10-user activated cohort.
3. **Weeks 5–8:** weekly check-ins; classify interventions/overrides; finish
   corpus, comparison, and representative-site compatibility/performance lanes;
   fix only release defects, severe compatibility, or measured costly false positives.
4. **Weeks 9–12:** report D14/D30, corpus, and comparison evidence. If credible,
   fund only Decision Journal + recovery guidance; otherwise change segment/
   position or stop before advanced architecture.

Last updated: 2026-07-17

---

## Decision Log

Historical D01–D20 decisions are retained below. July-10 amendments are the
working posture pending AI-16 ratification; `docs/agentic/DECISIONS.md` has
higher authority when wording conflicts.

> **Cross-cutting process/posture decisions (2026-07-03, D-2026-07-03-A..H)** live in [`docs/agentic/DECISIONS.md`](agentic/DECISIONS.md) — ship/measure direction, priority ladder, browser-surface re-tiering + WIP cap, visual-sim excision, distribution sequence. D21-D26 (North-Star) are in [`NORTHSTAR_ROADMAP.md`](NORTHSTAR_ROADMAP.md).

| # | Decision | Rationale |
|---|---|---|
| D01 | **5-phase structure** (0: Stabilize, 1: Validate, 2: Threats, 3: Productize, 4: Differentiate) | Aligns with Thesis Review phases but adds Phase 0 for existing debt. Each phase has a clear gate. |
| D02 | **Single roadmap replaces Execution_Tracker + Implementation_Roadmap** | Two stale planning docs cause confusion. One living document is easier to maintain for a solo dev. |
| D03 | **Task IDs: P{phase}-{seq}** (e.g., P0-01) | Encodes priority implicitly. Easy to reference in commits and PRs. |
| D04 | **Effort: S / M / L / XL** | S: < 4 hours, single focus. M: 4-12 hours, 2-5 files. L: 2-5 days, new subsystem. XL: 1-2 weeks, cross-cutting. |
| D05 | **Branch convention: `{type}/{slug}`** | Types: `fix/`, `feat/`, `test/`, `infra/`, `docs/`. Replaces the `codex/` prefix from the merge era. |
| D06 | **PSL: build-time bundled JSON** | Ship a static JSON asset compiled from publicsuffix.org at build time. No runtime network calls. Add a `scripts/update-psl.mjs` build script. Update manually or via dependabot-like cadence. |
| D07 | **Reputation is an optional build-time release profile** | The old 150KB/100K-domain assumption is mathematically incompatible with the 0.01% FP target and current 500KB package cap. The recommended beta omits reputation unless feed provenance, licensing, cadence, cardinality, FP target, and package budget are explicitly solved. |
| D08 | **No ML at this stage** | ML adds model size, inference complexity, and update mechanism overhead. Heuristic/pattern detection keeps the extension light and auditable. Revisit in Phase 4 if heuristics plateau. |
| D09 | **Interaction correlation is the differentiator to test** | DoubleClickjacking remains useful coverage, but competitor-absence and superiority claims are unverified. The product must demonstrate additive wins against current browser protections. |
| D10 | **Use a release-quality name only after clearance** | "NavSentinel" is a working name that collides with an active GNSS security product. AI-19 is required before CWS submission. |
| D11 | **Local prompt telemetry** | Track allow/dismiss/trust/block outcomes in `chrome.storage.local`. Display in options page. No data leaves the machine. Enables evidence-based threshold tuning. |
| D12 | **Position as an auditable local interaction guard** | Complement built-in browser protection; do not claim browsers structurally cannot see the same threats. #418 must establish any comparative claim. |
| D13 | **Content analysis = pattern matching, not ML** | Match against 20-30 known phishing kit HTML fingerprints. Check brand logo/domain mismatches. Simple, auditable, effective against commodity phishing. |
| D14 | **Outcome gates are mandatory** | Earlier phases advanced while validation gates remained open. Future work is gated by release, evidence, and user outcomes—not artifact completion. |
| D15 | **Archive old planning docs** | Move `Execution_Tracker.md` and `Implementation_Roadmap.md` to `docs/archive/`. They're historical records of the merge era. |
| D16 | **Local-first privacy boundary** | The beta makes no runtime network calls and never uploads browsing data/telemetry. A future inbound signed-data update is not active authorization: it requires a new explicit product/privacy/release decision and must not carry browsing state outbound. |
| D17 | **NRS: implement per existing spec** | The spec in `Intent_Model_and_Scoring.md` is the design doc. Implement the weights and thresholds as written, then tune based on Phase 1 testing data. |
| D18 | **Test corpus separate from gym** | Phishing snapshots and clickjacking PoCs go under `tests/corpus/`, not `gym/`. Gym remains deterministic local fixtures. Corpus is external samples for validation. |
| D19 | **Quietness needs operational and claim-grade gates** | A top-1000 run is descriptive, not enough to substantiate `<0.1%`. Report sample size and confidence intervals; keep named benign journeys as the beta operational gate. |
| D20 | **Bridge integrity before beta; external review before public launch** | Document-start ordering is not peer authentication. Complete #175/#186 before beta; an audit scope is not an audit, so review the exact package before public distribution. |

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

**Historical rationale**: the threat landscape shifted toward interaction-level
attacks. As of 2026-07-10, browser-native and extension competitors cover parts
of this space; the task is to prove additive value, not claim first-mover status.

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
| P1-05 | False positive measurement on Tranco top-1000 | L | **harness merged; valid current measurement open** | P1-01 | `test/fp-measurement` (PR #24); old 0.72% run predates current code and the same-org fix; #416 must rerun committed methodology |
| P1-06 | Real-world phishing test corpus | L | **harness merged; methodology/result invalid and open** | P1-01 | `test/phishing-corpus` (PR #30); #417/#426 must complete current-host/trusted-input methodology and rerun |
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

**Fix (2026-05-01)**: Added same-organization domain groups
(`extension/src/shared/domain_groups.ts`) with an explicit list of multi-domain
ecosystems (Unity, Google, Microsoft, Amazon, Apple, Meta, etc.). When source
and destination are in the same group, `isCrossSite` is suppressed, preventing
the `nrs_cross_site` (+20) factor from firing. This eliminates the unity3d.com
FP without affecting detection for genuinely cross-site navigations.
Re-run measurement needed to confirm rate drops below 0.1%.

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

**Corpus-v2 status (#417):** the 2026-05-01 28% number is methodologically invalid in both
directions (served from 127.0.0.1 → domain/reputation signals neutered; synthetic
`isTrusted=false` clicks; static snapshots miss JS-injected forms) and its raw per-page
results are gitignored. The rebuild (#417) has four pillars: **(1) protected-vs-fired scoring —
DONE** (`tests/corpus/corpus_scoring.ts`, unit-tested; a post-render `nav_rollback` no longer
counts the same as a pre-harm block/prompt, so the TP number means "the user was protected");
**(2) real-hostname routing, (3) trusted clicks, (4) a committed manifest — remain**, each
needing a headed run to validate. The corpus TP triage (#426) is gated on this rebuild + a
headed re-run.

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
- [ ] False positive rate on Tranco top-200: measured at 0.72% (1/138: unity3d.com) on 2026-05-01, **above the 0.1% target**; a same-organization domain-groups fix (`domain_groups.ts`, PR #24/#32, `fix/fp-gate-multi-domain`) was added to suppress the unity3d.com cross-site penalty, **but the post-fix rate was never re-measured** — <0.1% remains unconfirmed and the figure is stale vs. current code; a top-1000 re-measurement is required (#416)
- [ ] At least 50 real phishing pages tested with valid current methodology and
  a pre-harm TP result. The old 100-page/28% run used static localhost
  snapshots and synthetic input; it is historical diagnostic evidence, not a
  completed outcome gate. Complete #417 and rerun through #416/#426.
- [x] CDS evasion red-team suite exists and composite evasion is caught (PR #25 merged)
- [x] Prompt telemetry is recording locally (PR #21 merged)

---

## Phase 2: Target 2025-2026 Threats

### Task Table

| ID | Title | Effort | Status | Depends On | Branch |
|---|---|---|---|---|---|
| P2-01 | DoubleClickjacking detection | XL | **done** | P1 gate | `feat/double-clickjacking` (PR #36) |
| P2-02 | ClickFix / fake CAPTCHA detection | L | **done** | P1 gate | `feat/clickfix-detection` (PR #37) |
| P2-03 | Local bloom filter URL reputation | L | **mechanism merged; production profile open (AI-9/RI-04)** | P1-01 | `feat/bloom-reputation` (PR #35); current asset is a test stub, not a production reputation layer |
| P2-04 | Page content fingerprinting | L | **done** | P1 gate | `feat/content-fingerprint` (PR #53) |
| P2-05 | OAuth consent flow monitoring | L | **done** | P2-01 | `feat/oauth-monitoring` (PR #47) |
| P2-06 | Redirect chain correlation | L | **done** | P1-04 | `feat/redirect-chains` (PR #51) |
| P2-07 | DOM mutation monitoring | M | **done** | P1 gate | `feat/dom-mutation` (PR #45) |
| P2-08 | History.pushState gating | M | **done** | P2-06 | `feat/pushstate-gating` (PR #60) |
| P2-09 | Gym fixtures for new detections | M | **done** | P2-01, P2-02 | `test/phase2-gym` (PR #61) |
| P2-10 | Benchmark suite (gym regression; competitor arm unbuilt) | L | **gym-regression suite done; competitive/Safe-Browsing arm never built — additive value unproven, #418** | P1-05, P1-06 | `test/competitive-bench` (PR #70) |
| P2-11 | NRS scoring ceiling and compound FP mitigation | M | **done** | P2-01, P2-03 | `fix/nrs-scoring-ceiling` (PR #57) |
| P2-12 | Integrate ClickFix scoring into NRS pipeline | M | **done** | P2-02 | `feat/clickfix-nrs-integration` (PR #44) |
| P2-13 | Bloom filter per-frame loading optimization | S | **done** | P2-03 | `fix/bloom-per-frame` (PR #46) |

### Task Details

#### P2-01: DoubleClickjacking detection (HEADLINE FEATURE)

This was the original differentiator hypothesis (Decision D09). Direct
DoubleClickjacking extensions now exist, so #418 must establish whether
NavSentinel's cross-event implementation adds measurable value. The January
2025 attack can bypass X-Frame-Options, CSP frame-ancestors, and SameSite
cookies.

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

Microsoft reports heavy ClickFix use in its 2025 incident-response/Defender
observations, but that dataset is not a global "all initial access" denominator.
Treat prevalence as time-sensitive. The technique uses fake CAPTCHA overlays
that write commands to the clipboard and instruct users to paste them. See the
[Microsoft Digital Defense Report 2025](https://www.microsoft.com/en-us/security/security-insider/threat-landscape/microsoft-digital-defense-report-2025).

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

Bundle an optional bloom filter of known-bad domains without runtime network
calls. The historical 60–70% coverage estimate is unverified and must not be
used as a product claim.

**What to do**:
- Add `scripts/build-bloom-filter.mjs` that:
  - Fetches URLhaus and OpenPhish domain feeds
  - Extracts unique domains
  - Compiles to a bloom filter binary
  - Outputs to `extension/public/reputation_data.bin`
- Add `extension/src/shared/reputation.ts` with bloom filter lookup
- Wire reputation check into navigation decisions (NRS factor: `known_bad_domain` +50)
- Wire reputation check into credential guard (risk factor: known-bad domain)
- Add unit tests with known-bad domains and false positive verification

**Budget correction (2026-07-10):** at a 0.01% target, 150KB supports about
64,000 entries, not 100,000, and the current package has only about 26KB of
aggregate headroom. Separate data/package budgets and release provenance are
required if AI-9 selects a real-filter profile.

**Files**: new `scripts/build-bloom-filter.mjs`, new `extension/src/shared/reputation.ts`,
new `extension/public/reputation_data.bin`, `extension/src/shared/scoring.ts` or `nrs.ts`

**Done when**: the selected release profile is honest. For interaction-only,
reputation is absent/disabled and unclaimed. For real-filter, feed licensing,
provenance, cadence, cardinality, bit density, sentinel membership, package
budget, and measured bloom FP all pass reproducibly. No runtime network calls.

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

OAuth and identity-flow abuse remain important, but the often-cited Microsoft
146% figure refers to adversary-in-the-middle phishing, not OAuth consent
phishing. ConsentFix attacks can combine fake CAPTCHAs with OAuth abuse.
NavSentinel already gates popups; this extends that to track a limited set of
OAuth redirect/callback behaviors.

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

#### P2-10: Benchmark suite (gym regression; competitor arm unbuilt)

*Intended* to run the same test corpus against competing tools to quantify NavSentinel's
additive value (Thesis Review, Section 8.5). **As shipped (PR #70), `scripts/benchmark.mjs`
is a NavSentinel-only gym-fixture regression harness** — it records per-scenario
detect/miss/false-positive against a committed baseline. The competitive arm described below
(Safe Browsing / competitor extensions) was **never built**, so the name "competitive" does
**not** denote evidenced additive value. Building that arm is network / headed-Chrome-gated
and tracked by **#418**; the benchmark-baseline re-run belongs to the measurement-reset
session **#416**.

**What to do**:
- Create `scripts/benchmark.mjs` that runs a test corpus against:
  - NavSentinel alone
  - Chrome Safe Browsing alone
  - NavSentinel + Safe Browsing together
- Measure detection rate and FP rate for each configuration
- Document results and identify gaps
- Optionally test against uBlock Origin, Netcraft if feasible

**Files**: new `scripts/benchmark.mjs`, new `tests/benchmark-results/`

**Done when**: Benchmark harness runs and results are documented. **NOT PROVEN** — `scripts/benchmark.mjs` has no Safe Browsing arm, `scripts/benchmark-baseline.json` has `lastRun: null`, and `tests/benchmark-results/` holds only `.gitkeep`, so no competitive additive-value comparison over Safe Browsing has ever been produced (#418).

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
- [ ] Production reputation outcome is proven for the selected release profile.
  PR #35 proves only reserved test-fixture membership; the current filter is a
  stub and AI-9/RI-04 remain open.
- [x] Page content fingerprinting detects brand/domain mismatches (PR #53 merged: 20 brands, 30 phishing kit fingerprints, tiered BrandSignal scoring)
- [x] Redirect chains are correlated and scored as a unit (PR #51 merged: per-hop scoring with caps, known redirector detection, 15s stale pruning)
- [x] DOM mutations are monitored for post-load injection (PR #45 merged: MutationObserver with cookie/chat/ARIA exclusions, 100ms debounce, 50-alert cap)
- [x] History.pushState gating detects URL manipulation (PR #60 merged: 2+ dot domain-like path check, %2E decode, rapid-fire detection, +20 NRS factor)
- [x] Phase 2 gym fixtures have comprehensive E2E coverage (PR #61 merged: 22 tests across 6 detection types, 4 new fixtures)
- [ ] Competitive benchmark demonstrates additive value — the benchmark *suite* exists (PR #70) but has never produced a competitive result: `benchmark.mjs` has no Safe Browsing arm, baseline `lastRun` is `null`, and `tests/benchmark-results/` holds only `.gitkeep`; additive value over Safe Browsing is unproven (#418)
- [ ] No regression in Phase 1 measurements (FP rate, TP rate) — needs re-run after P4 additions (blocked on FP re-measurement run)

---

## Phase 3: Productize

### Task Table

| ID | Title | Effort | Status | Depends On | Branch |
|---|---|---|---|---|---|
| P3-01 | Plain-English risk explanations | M | **done** | P2 gate | `feat/plain-english-ui` (PR #64) |
| P3-02 | Visual risk indicators (icon color) | M | **done** | P2 gate | `feat/icon-risk` (PR #65) |
| P3-03 | Smart defaults that learn | M | **done** | P1-08 | `feat/smart-defaults` (PR #62) |
| P3-04 | Onboarding flow | L | **done** | P3-01, P3-02 | `feat/onboarding` (PR #73) |
| P3-05 | Adaptive scoring with user feedback | L | **done** | P1-08, P3-03 | `feat/adaptive-scoring` (PR #66) |
| P3-06 | Chrome Web Store listing | M | **in progress** | P3-01, P3-02 | Drafts exist; name, assets, release profile, fresh-install verification, and submission remain |
| P3-07 | Release infrastructure | M | **done** | P2 gate | `infra/release` (PR #67) |
| P3-08 | Issue templates and repo hygiene | S | **done** | -- | `docs/issue-templates` (PR #50) |
| P3-09 | Prepare and obtain independent external security review | XL / external | **blocked** | RI-01–RI-08, PM-03 | Scope preparation exists; immutable release target, outreach, review, and remediation remain |
| P3-10 | Migrate SW ephemeral state to chrome.storage.session | M | **done** | P2-01 | `feat/sw-session-storage` (PR #63) |
| P3-11 | jsdom/happy-dom test environment for ClickFix DOM tests | S | **done** | P2-02 | `test/jsdom-clickfix-tests` (PR #49) |
| P3-12 | Bloom filter size monitoring in CI | S | **monitor merged; release-profile check open** | P2-03 | `infra/bloom-ci-check` (PR #48); current test-stub check does not prove a real-filter package |

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

**Headline claim** (from Thesis Review, Section 10) — ⚠️ **UNEVIDENCED SUPERLATIVE; do not ship as-is (#418):**
"The only browser extension that detects DoubleClickjacking, ClickFix overlays, and OAuth
consent flow abuse -- without sending your data anywhere."

The "only … that detects" wording is a competitive superlative with **no competitive benchmark
behind it** (P2-10's Safe-Browsing arm was never built — see #418), and the landscape has since
shifted (Chrome now ships local Gemini Nano scam detection — NORTHSTAR D21). The checked-in
  canonical store-listing draft (`docs/cws-listing/STORE_LISTING.md`, PR #81 —
  **not submitted**) must use the complementary local-interaction position in
  `Product_Strategy.md`. Do not use "only", "other extensions miss", or
  "browsers cannot see" without current comparative evidence.

**Done when**: Extension is listed and installable from CWS. **NOT MET
(2026-07-13)** — no submission, tag, or GitHub release exists. Name clearance
(AI-19), release-integrity tasks RI-01–RI-08, pre-collection disclosure and
consent (#455/PM-03), the release profile (AI-9), assets, fresh-install checks,
and submission remain.

#### P3-07: Release infrastructure

**What to do**:
- Drop "(Dev)" from `manifest.json` name -> "NavSentinel" (Decision D10)
- Add CHANGELOG.md with keep-a-changelog format
- Add `scripts/release.mjs` that bumps version, updates changelog, creates tag
- Add GitHub Release creation (manual or via CI)
- Ensure `verify:versions` checks new fields

**Files**: `extension/manifest.json`, new `CHANGELOG.md`, new `scripts/release.mjs`,
`.github/workflows/ci.yml`

**Done when**: Release workflow exists (`scripts/release.mjs` + tag-triggered CI job in `ci.yml`). Version bumps are scripted. The CI job is configured to create a GitHub Release on tag push, but it has never run — 0 git tags and 0 GitHub Releases exist to date.

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

#### P3-09: Prepare and obtain independent external security review

The code is clean and readable but hasn't been reviewed by an external security professional
(Thesis Review, Section 6).

This is not an S-sized implementation task. Scope preparation/outreach is
separate from externally scheduled review and potentially cross-cutting
remediation.

**What to do**:
- complete RI-01–RI-08 and PM-03, then freeze one immutable commit/package;
- finalize the focused scope, browser/version, manifest, build inputs, and hash;
- identify and engage an independent security reviewer;
- publish or retain a complete report according to the agreed disclosure model;
- resolve every finding or record an explicit owner-approved residual risk.

**Done when**: At least one external security professional has reviewed the bridge design
and CDS logic. Findings addressed or documented as accepted risks.

**Current state (2026-07-13): NOT MET.** `SECURITY_AUDIT_SCOPE.md` is
preparation, not an external audit. #175/#186 now block beta through RI-08; a
fresh external review of the exact package separately blocks public launch.

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

The merged monitor catches unexpected changes to the checked-in asset. It does
not establish that a real feed fits the extension's current aggregate and chunk
budgets, nor that the release package contains the intended filter.

**What to do**:
- Keep a profile-aware check for cardinality, bit density, sentinel membership,
  data provenance, and measured bloom false-positive rate.
- Check the packaged asset and aggregate/chunk budgets, not an obsolete 2 MB
  standalone cap.
- For interaction-only beta, prove reputation is absent or disabled and no
  reputation claim leaks into copy or runtime state.

**Files**: `.github/workflows/ci.yml`, `scripts/build-bloom-filter.mjs`,
`scripts/check-bloom-size.mjs`, release/package scripts

**Done when**: the selected release profile fails closed when its declared
asset, provenance, cardinality, package, or runtime expectations are violated.
If both variants are intentionally supported, verify each independently.

### Phase 3 Gate

The Phase 3 outcome gate closes when:
- [x] All user-facing messages are in plain English (PR #64 merged)
- [x] Icon changes color based on page risk (PR #65 merged)
- [x] Smart defaults suggest allowlist additions (PR #62 merged: 24h cooldown, 25 unit tests)
- [x] Onboarding flow exists and works on first install (PR #73 merged)
- [ ] CWS listing is installable (draft copy exists; release/name/assets/submission remain)
- [x] Release workflow is scripted (PR #67 merged: CHANGELOG, version bump script, CI release job)
- [x] Issue templates exist (PR #50 merged)
- [x] Adaptive scoring adjusts per-domain thresholds (PR #66 merged)
- [x] SW state survives service worker restarts (PR #63 merged)
- [ ] External security review completed and findings resolved (scope only exists today)

---

## Phase 4: Differentiate

These tasks are a frozen option portfolio. They depend on a shipped, retained,
validated product; none is authorized by this table. Current priority is the
release/evidence sequence in `Product_Strategy.md`.

### Task Table

| ID | Title | Effort | Status | Depends On |
|---|---|---|---|---|
| P4-01 | Visual similarity detection | XL | **remove before beta** | #424 / RI-02 | Placeholder path never matches and can process the wrong active tab; a future opt-in design starts fresh only after evidence |
| P4-02 | JavaScript behavior analysis | XL | **beta-off pending measurement** | #127 | Broad global wrappers require compatibility and runtime-overhead evidence |
| P4-03 | Cross-browser port (Firefox MV3) | XL | **frozen** | Desktop-Chrome retention evidence |
| P4-04 | Community threat intelligence | XL | **frozen** | User scale, privacy, governance, and infrastructure evidence |
| P4-05 | CSP / permissions analysis | L | **done** | P2 gate | PR #71 |
| P4-06 | Sub-resource integrity awareness | M | **done** | P2 gate | PR #68 |
| P4-07 | Per-domain behavioral profiling | L | **done** | P1-08 | PR #69 |
| P4-08 | Navigation pattern anomaly detection | L | **done** | P4-07 | `feat/nav-anomaly` (PR #78) |

### Task Details

#### P4-01: Visual similarity detection

**Current decision (D-2026-07-03-F, reinforced 2026-07-10): excise this path
before beta.** It ships placeholder templates that cannot match, consumes scarce
package/chunk budget, and can process the visible pixels of a different active
tab when a background password page requests analysis. #424/RI-02 removes it.
Any future visual analysis is a new opt-in, disclosed, measured design—not a
continuation of this plumbing.

**Historical implementation below is retained for removal scope, not as an
active plan.** #245/#246 should be closed, deduplicated, or moved to a clearly
post-beta hypothesis milestone.

**Sub-slices:**
- **W3 (merged):** capture pipeline (`visual_sim_capture.ts`), hashing (`visual_sim_hash.ts`),
  template DB + loader, brand-canonical-domain map. NRS integration via #172
  (cross-origin brand match feeds `visualSimilarityScore`, capped at +30).
- **P4-01b (merged):** gym fixtures (`gym/visual-sim-01-brand-login.html`,
  `gym/visual-sim-02-delayed-password.html`) + E2E (`tests/e2e/visual-sim.spec.ts`)
  proving the capture→SW pipeline fires end-to-end (immediate and delayed-password
  paths) with no error or false positive on benign login pages.
- **P4-01c (historical, cancelled):** the true-positive fixture was never built
  and `scripts/build-brand-templates.mjs` emits placeholders. D-2026-07-10-J
  chooses removal, not a logo-embedding continuation; #245/#246 are post-beta
  hypotheses.

#### P4-02: JavaScript behavior analysis

Monitor for suspicious JavaScript patterns: form submit handlers that POST to unexpected
endpoints, clipboard access, credential field value reads, beacon/fetch to third parties
during form submission.

**Key decisions (deferred)**:
- Interception scope: which APIs to patch in main world
- Performance budget: overhead of monitoring fetch/beacon
- False positive management: many legitimate sites read form values

#### P4-03: Cross-browser port (Firefox MV3)

Port the extension to Firefox MV3. The architecture is already mostly portable
(TypeScript, Vite). Main differences: WebExtension API naming, popup behavior,
content-script injection timing, background model, and `world:"MAIN"` support.

**Decisions (made 2026-05-29):**
- **Single codebase** (no fork) — shared source, per-target manifest + build config.
- **Firefox 128+** minimum (`strict_min_version`), `background.page` (HTML + ES module) model.
- Ship without the `world:"MAIN"` navigation guard initially (documented gap, later slice).

**Slice breakdown (stacked PRs):**
- **FF-01** — `browser.*` compat shim (`extension/src/shared/browser.ts`) + `manifest.firefox.json` + tests. Purely additive; no Chrome change. (PR #173)
- **FF-02** — Firefox Vite build config + `src/sw/background.html` entry (the `background.page` target referenced by `manifest.firefox.json`) + dual build scripts.
- **FF-03** — `session_state` compatibility (Chrome `storage.session` → namespaced `storage.local` fallback via `storageSessionShim`) + restart-clear semantics for ephemerality.
- **FF-04** — `world:"MAIN"` guard parity once Firefox baseline supports it; redirect/transition detection gaps (`transitionQualifiers` absent on Firefox).

Note: `manifest.firefox.json` references `src/sw/background.html`, which is created in FF-02 (a tracked forward reference, not a broken ref — FF-01 is not wired into a build yet).

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

Extension bundle size budget (12 budgets enforced by `npm run check:perf-budget`):

| Component | Budget | Notes |
|---|---|---|
| capture_isolated (content script) | < 63KB | Main navigation detection logic |
| main_guard (MAIN world) | < 20KB | Pushstate/clickfix interception in page context |
| credential_guard (content script) | < 30KB | Credential protection logic |
| service worker | < 25KB | Background orchestration |
| Storage module (includes PSL trie) | < 200KB | PSL data (~157KB) is inlined into this JS chunk at build time |
| popup JS | < 10KB | Popup entry point bundle |
| options JS | < 15KB | Options page entry point bundle |
| oauth_monitor (shared) | < 8KB | OAuth flow monitoring shared chunk |
| domain_profile (shared) | < 6KB | Domain profiling shared chunk |
| ui_toast (shared) | < 5KB | Toast notification shared chunk |
| Bloom filter (reputation_data.bin) | < 150KB legacy CI ceiling | Current artifact is a test fixture, not a threat-feed product or approved allocation. Interaction-only omits it; a real-filter profile requires a new AI-9/RI-04 data + aggregate budget. |
| Total dist (all files) | < 500KB | Aggregate cap on entire dist/ directory |

See `scripts/check-perf-budget.mjs` for current per-chunk enforcement. These are
CI guardrails, not authorization to fill each ceiling or proof that the invalid
150KB/100K-domain reputation plan fits a release profile.

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

- [Strategic Outlook](Strategic_Outlook.md) -- 2026-07-02 review: strengths, trajectory, and
  the effective path (next-ten-slices order); companion to the Course Correction
- [Course Correction](Course_Correction.md) -- 2026-07-02 review: hard truths, strategy and
  execution failures, corrective principles, and the phased sort-out plan (issues #415-#427)
- [Product Thesis Review](Product_Thesis_Review.md) -- Critical assessment of security
  value, usability, competitive positioning, and expansion strategy
- [Comprehensive Project Analysis](Comprehensive_Project_Analysis.md) -- Full repo
  inventory, gap analysis, architecture deep dive, and recommended next steps
- [Intent Model and Scoring](Intent_Model_and_Scoring.md) -- CDS and NRS specifications
- [Real-World Adversarial Program](Real_World_Adversarial_Program.md) -- Scenario backlog
- [Testing Expansion Strategy](Testing_Expansion_Strategy.md) -- Test lane strategy
- [Architecture and Data Flow](Architecture_and_Data_Flow.md) -- Runtime layer documentation
