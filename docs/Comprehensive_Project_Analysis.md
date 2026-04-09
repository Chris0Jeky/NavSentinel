# NavSentinel: Comprehensive Project Analysis

*Generated 2026-04-09 from the current `main` branch state after PR #15 merge.*

---

## 1. Executive Summary

NavSentinel is a **local-first Chrome MV3 browser extension** that protects users from two high-risk browser abuse surfaces:

1. **Deceptive navigation** -- clickjacking, hidden overlays, popunders, malicious redirects, synthetic popup attempts
2. **Risky credential submissions** -- HTTP password posts, cross-site form actions, lookalike domains, punycode/mixed-script phishing

Everything runs locally. No telemetry, no cloud lookups, no password storage, no remote reputation services. Decisions are explainable through reason codes and a bounded local event log.

### Key metrics at a glance

| Metric | Value |
|---|---|
| Total repo LOC (excl. node_modules/dist) | ~12,661 (active code); ~54,400 incl. RESOURCES archive |
| RESOURCES/ (historical SentinelSuite copies) | 338 files, 3.2 MB -- not part of active extension |
| Extension TypeScript source | 4,580 lines across 20 files |
| Gym HTML fixtures | 52 files, ~2,485 lines |
| Test code | 3,659 lines across 15 files |
| Documentation | ~2,100 lines across 18 docs |
| Total commits (main) | 240 |
| Total commits (all branches) | 254 |
| PRs merged | 16 (all merged, none open) |
| Open issues | 0 |
| Contributors | 1 primary (Chris0Jeky / Cristian Tcaci) |
| Project timeline | Jan 18, 2026 -- Apr 9, 2026 (~3 months) |
| Activity peak | January 2026 (165 commits) |

---

## 2. Architecture Deep Dive

### 2.1 Runtime Layers

NavSentinel operates across four MV3 runtime surfaces:

```
                    +--------------------------+
                    |     Service Worker       |
                    |  (sw.ts - 340 lines)     |
                    |  - rollback state        |
                    |  - DNR sync              |
                    |  - tab lifecycle         |
                    +--------+-+---------------+
                             | |
              chrome.runtime | | messages
                             | |
        +--------------------+ +--------------------+
        |                                            |
+-------v-----------+    MessageChannel    +---------v---------+
| Isolated World    |<------------------->| Main World        |
| capture_isolated  |    (bridge)         | main_guard        |
| (767 lines)       |                     | (682 lines)       |
| - CDS scoring     |                     | - window.open     |
| - click capture   |                     | - location.assign |
| - toast UI        |                     | - location.replace|
| - allowlist mgmt  |                     | - form.submit     |
+-------------------+                     +-------------------+
        |
        |  (also isolated world)
+-------v-----------+
| Credential Guard  |
| (240 lines)       |
| - form intercept  |
| - paste warning   |
| - risk scoring    |
+-------------------+
```

### 2.2 Source File Map

#### Content Scripts (`extension/src/content/`)

| File | Lines | Purpose |
|---|---|---|
| `capture_isolated.ts` | 767 | **Core navigation controller**. Captures pointer/keyboard clicks, computes CDS, decides block/allow/prompt, shows toasts, coordinates rollback with service worker |
| `main_guard.ts` | 682 | **Main-world patcher**. Patches `window.open`, `location.assign/replace`, `form.submit/requestSubmit` in page context. Captures blocked navigations for replay |
| `credential_guard.ts` | 240 | **Credential interceptor**. Listens for password-form submit and paste events, computes risk, delegates to modal |
| `credential_guard_model.ts` | 58 | Pure model for credential guard decision logic |
| `credential_modal.ts` | 231 | Block-and-prompt modal UI for risky credential submissions |
| `dom_builder.ts` | 195 | Builds element hints from DOM for CDS input |
| `debug_overlay.ts` | 108 | Optional visual debug overlay showing CDS/scores |
| `ui_toast.ts` | 109 | Toast notification UI for blocked/prompted navigation |

#### Shared Modules (`extension/src/shared/`)

| File | Lines | Purpose |
|---|---|---|
| `storage.ts` | 356 | **Persistence backbone**. Settings, trusted domains, event log, import/export, migrations |
| `domain.ts` | 382 | **Credential risk engine**. Registrable domain extraction, risk scoring, lookalike detection, HTTPS/cross-site checks |
| `scoring.ts` | 145 | **CDS calculator**. Click Deception Score from element hints, viewport, input source |
| `allowlist.ts` | 98 | Navigation allowlist management (per-site per-destination) |
| `types.ts` | 47 | Shared TypeScript type definitions |
| `stateMachine.ts` | 40 | Gesture token state machine |
| `popup_test.ts` | 31 | Popup test hook helpers |
| `event_tone.ts` | 10 | Event tone/severity classification |
| `popup_model.ts` | 51 | Popup state model |

#### Service Worker (`extension/src/sw/`)

| File | Lines | Purpose |
|---|---|---|
| `sw.ts` | 340 | Tab lifecycle, rollback state, DNR rule sync, message routing, worker restart resilience |

#### UI (`extension/src/popup/` and `extension/src/options/`)

| File | Lines | Purpose |
|---|---|---|
| `popup.ts` | 315 | Popup UI: domain display, trust toggle, mode switching, event display, demo test hooks |
| `options.ts` | 375 | Options page: full config, allowlist management, trusted domains, import/export, event log |

### 2.3 Key Security Mechanisms

#### Click Deception Score (CDS)

The CDS is a weighted score computed from click context:

| Feature | Weight | Signal |
|---|---|---|
| Interactive element with no accessible name | +15 | Empty click targets = overlays |
| Element covers >35% viewport and is interactive | +30 | Fullscreen interactive layers |
| More intentful element underneath | +35 | Intent mismatch (highest signal) |
| pointerdown/click top element differs | +20 | Retargeting |
| Fixed/absolute position with z-index >= 9999 | +15 | Extreme stacking |
| Cursor pointer but no visible affordance | +10 | Weak overlay signal |
| Non-visible but receives pointer events | +25 | Strong overlay indicator |
| Keyboard activation (Enter/Space) | -10 | User intent signal |
| Known legit modal backdrop | -20 | False positive reduction |

**Thresholds**: Smart mode blocks at CDS >= 70, Strict mode at >= 50.

#### Credential Risk Scoring

Risk factors include:
- Non-HTTPS page or form action
- URL userinfo (`user@host`) patterns
- IP-address hostnames
- Punycode/mixed-script hostnames
- Deep subdomain depth
- Cross-site form action
- Lookalike similarity to trusted domains
- Absence from trusted-domain list

#### Main/Isolated World Bridge

- Uses `MessageChannel`/`MessagePort` (not `window.postMessage`)
- Per-document session IDs
- Protocol version matching
- Narrow message-type allowlist
- Source marker validation

#### Rollback System

The service worker maintains rollback state for suspicious same-tab redirects. When a redirect looks suspicious but has already committed (the URL changed), the extension can roll it back to the prior page and offer an explicit "Proceed" action.

---

## 3. Test Infrastructure

### 3.1 Test Layers

| Layer | Command | Files | Test Count |
|---|---|---|---|
| **Unit tests** (Vitest) | `npm test` | 5 files | ~25 tests |
| **E2E smoke** | `npm run test:e2e:smoke` | navsentinel.spec.ts | tagged `@smoke` |
| **E2E regression** | `npm run test:e2e:regression` | navsentinel.spec.ts | tagged `@regression` |
| **E2E rollback** | `npm run test:e2e:rollback` | navsentinel.spec.ts | tagged `@rollback` |
| **E2E live** | `npm run test:e2e:live` | navsentinel.spec.ts | tagged `@live` |
| **Credential E2E** | `npm run test:e2e` | credential-guard.spec.ts | 4 tests |
| **Suite UI E2E** | `npm run test:e2e` | suite-ui.spec.ts | UI tests |
| **Demo showcase** | `npm run demo:showcase` | demo-showcase.core.spec.ts | guided demo |
| **Demo operator** | `npm run demo:showcase:operator` | demo-showcase.operator.spec.ts | popup demo |
| **Demo recovery** | `npm run demo:showcase:recovery` | demo-showcase.recovery.spec.ts | recovery demo |

### 3.2 Unit Test Files

| File | Coverage |
|---|---|
| `tests/credential-domain.test.ts` | Registrable domain extraction, normalization |
| `tests/credential-guard-model.test.ts` | Credential risk model behavior |
| `tests/popup-model.test.ts` | Popup event formatting, limits |
| `tests/storage-suite.test.ts` | Storage import/export, settings migration |
| `tests/sw-rollback.test.ts` | Rollback, gesture window, target allowance, worker restart, tab churn |

### 3.3 E2E Coverage (navsentinel.spec.ts)

22 test cases covering:
- **Levels 1-12**: Basic opacity, moving target, instant injection, visual mimicry, popunder, programmatic click, legit modal, legit OAuth, legit overlay, redirects/forms, credential guard, slow same-tab
- **Real-world Wave 1**: RW-01 (search overlay swap), RW-03 (delayed redirect), RW-04 (open-redirect laundering), RW-06 (legit auth + blocked second popup)
- **Rollback**: Level 10 redirect rollback
- **Live**: Google first-result sanity check
- **Keyboard variants**: Space/Enter triggered popups
- **Edge cases**: Delayed button-triggered popup blocking, plain button new tab allow

### 3.4 Credential Guard E2E (credential-guard.spec.ts)

4 tests: Level 11 credential prompt, RW-07 fake re-auth, RW-13 courier tracking lure, paste warning + trust persistence

### 3.5 Demo System

Three named demo variants, all using a shared runner (`scripts/run_demo.mjs`):
- **`core`**: 10-chapter guided walkthrough covering blocked navigation, legitimate allowance, credential interruption, trust persistence, options evidence
- **`operator`**: Popup/options-heavy walkthrough with real browser-action popup automation
- **`recovery`**: Redirect intervention and rollback recovery chapters

Delivery modes: `live` (readable pacing), `fast` (dry runs), `record` (deterministic video/trace capture)

---

## 4. Gym Fixture Map

### 4.1 Primitive Levels (12 levels)

| Level | Scenario | Type |
|---|---|---|
| 1 | Basic opacity overlay | Block |
| 2 | Moving-target overlay | Block |
| 3 | Instant injection trap | Block |
| 4 | Visual mimicry disguised link | Block |
| 5 | window.open popunder | Block |
| 6 | Programmatic click | Block |
| 7 | Legitimate modal backdrop | Allow |
| 8 | Legitimate OAuth popup | Allow |
| 9 | Legitimate video overlay controls | Allow |
| 10 | Delayed redirects and form submits | Prompt/Rollback |
| 11 | Risky credential submission | Prompt |
| 12 | Slow same-tab navigation | Allow |

### 4.2 Real-World Scenarios (RW-01 through RW-20)

| Wave | IDs | Theme | Gym Fixtures | E2E Tests on Main |
|---|---|---|---|---|
| Wave 1 | RW-01, 03, 04 | Search/landing deception | Yes | Yes |
| Wave 1 | RW-06 | Legit auth + blocked second | Yes | Yes |
| Wave 2 | RW-07, 08, 09, 10 | Auth/identity laundering | Yes | **RW-07, RW-13 only (in credential spec)** |
| Wave 3 | RW-11, 12, 13, 14, 15 | Commerce/finance/wallet | Yes | **Missing from main** |
| Wave 4 | RW-16, 17, 18, 19, 20 | Doc/media/support scams | Yes | **Missing from main** |
| Wave 5 | RW-21, 22, 23, 24, 25 | Worker-state/tab-churn | **No fixtures on main** | **Not started** |

### 4.3 CRITICAL FINDING: Missing E2E Tests

**13 real-world scenario E2E tests (RW-08 through RW-20) were lost during the stacked merge process.**

- Gym fixtures for all Wave 2-4 scenarios exist on main
- E2E tests for these scenarios were added on the wave branches but didn't propagate through the stacked PR merges
- The tests exist on `codex/realworld-wave5-worker-stress` branch (which accumulated all wave work) but were never merged
- Wave 5 (RW-21 through RW-25) gym fixtures and stress tests were in-progress and saved as a backup patch

---

## 5. CI/CD and Build

### 5.1 CI Pipeline (`.github/workflows/ci.yml`)

Two-stage pipeline on push/PR to main:

**Stage 1: Build / Unit**
1. `npm ci`
2. `npm run verify:versions` (manifest/package.json version sync)
3. `npm run typecheck` (strict TypeScript)
4. `npm test` (Vitest unit tests)
5. `npm run build` (Vite bundle)
6. `npm run package:ext` (zip artifact)
7. Upload artifact

**Stage 2: E2E** (depends on Stage 1)
1. Build extension
2. Install Playwright + Chromium
3. `xvfb-run -a npm run test:e2e`

### 5.2 Build System

- **Bundler**: Vite 5.4 with `@crxjs/vite-plugin` for MV3
- **TypeScript**: 5.6, strict mode
- **Output**: `extension/dist/`
- **Packaging**: `scripts/package.mjs` creates distributable zip

### 5.3 npm Scripts

| Script | Purpose |
|---|---|
| `build` | Vite build to dist |
| `watch` | Rebuild on changes |
| `test` | Vitest unit tests |
| `test:e2e` | Full Playwright suite |
| `test:e2e:smoke` | Quick smoke tests |
| `test:e2e:regression` | Regression-only lane |
| `test:e2e:rollback` | Rollback behavior |
| `test:e2e:live` | Live web sanity |
| `demo:showcase` | Core demo |
| `demo:showcase:operator` | Operator demo |
| `demo:showcase:recovery` | Recovery demo |
| `demo:showcase:record` | Record mode |
| `typecheck` | TSC no-emit |
| `verify:versions` | Version sync check |
| `package:ext` | Zip for distribution |
| `gym:serve` | Local Vite dev server for gym |

---

## 6. Documentation Inventory

### 6.1 Root Files

| File | Status | Content |
|---|---|---|
| `README.md` | Current | Product overview, usage guide, repo layout, build/test commands |
| `CONTRIBUTING.md` | Current | Dev environment, workflows, where to change things, style guide |
| `AGENTS.md` | Current | Repository contract for AI-assisted development |
| `PRIVACY.md` | Current | Data handling, what's stored, what's not done |
| `SECURITY.md` | Current | Security posture, hardening measures, reporting |

### 6.2 Documentation Files

| File | Status | Content |
|---|---|---|
| `docs/README.md` | Current | Documentation index and navigation guide |
| `docs/Project_Overview.md` | Current | Product summary, capabilities, philosophy, entry points |
| `docs/Architecture_and_Data_Flow.md` | Current | Runtime layers, bridge design, storage, state flow |
| `docs/Intent_Model_and_Scoring.md` | Current | CDS factors/weights, credential risk model, thresholds |
| `docs/Testing_and_Gym.md` | Current | Test layers, commands, gym map, verification guide |
| `docs/Execution_Tracker.md` | Partially stale | Batch plan is good but status table needs update |
| `docs/Implementation_Roadmap.md` | Partially stale | Follow-up themes are valid but references PR #5 |
| `docs/Real_World_Adversarial_Program.md` | Current | Scenario backlog, wave plan, 25 scenarios defined |
| `docs/Testing_Expansion_Strategy.md` | Current | Test lane strategy, gap analysis, recommended shape |
| `docs/Demo_Showcase_Plan.md` | Current | Demo variant plan, delivery modes, chapter structure |
| `docs/Checklists.md` | Current | Day-to-day verification and release checklists |
| `docs/RELEASING.md` | Current | Version, packaging, CI, release artifact guidance |
| `docs/Threat_Model_and_Cases.md` | Current | Threat scenarios the extension handles |
| `docs/Snippets_By_Topic.md` | Current | Code entry points and common tasks |

### 6.3 Archived Docs

| File | Content |
|---|---|
| `docs/archive/MasterPlan.md` | Original baseline proposal and scope |
| `docs/archive/Expansion_Tracker.md` | Merge-era tracker |
| `docs/archive/Resource_Map.md` | Merge-era resource map |
| `docs/archive/README.md` | Archive index |

---

## 7. PR History and Development Timeline

### 7.1 All 16 PRs (All Merged)

| PR | Title | Theme |
|---|---|---|
| #1 | Integrate SentinelSuite expansion | Original merge of nav + credential guards |
| #2 | Add suite UI coverage and trusted-domain normalization | UI test foundation |
| #3 | Extract popup model and add popup tests | Popup model extraction |
| #4 | Extract credential guard model and add edge coverage | Credential model extraction |
| #5 | Consolidate post-merge test hardening and coverage | Major test infrastructure |
| #6 | Split E2E lanes and formalize rollback checks | Test lane architecture |
| #7 | Add adversarial Gym coverage | Levels 2-6 automation |
| #8 | Cover legitimate Gym flows | Levels 7-9, 12 automation |
| #9 | Refresh operator surfaces and seed adversarial program | UI polish + scenario program |
| #10 | Add Wave 1 real-world adversarial scenarios | RW-01 through RW-05 |
| #11 | Add Wave 2 auth laundering scenarios | RW-06 through RW-10 |
| #12 | Add Wave 3 commerce abuse scenarios | RW-11 through RW-15 |
| #13 | Add Wave 4 document and support abuse scenarios | RW-16 through RW-20 |
| #14 | Add guided demo core and record mode | Demo system + core variant |
| #15 | Add operator demo variant | Popup-surface demo |
| #16 | Add recovery demo variant | Redirect recovery demo |

### 7.2 Activity Timeline

| Period | Commits | Focus |
|---|---|---|
| Jan 2026 | 165 | Foundation: extension merge, test infrastructure, E2E lanes, gym automation |
| Mar 2026 | 74 | Real-world waves 1-4, operator surfaces, demo system |
| Apr 2026 | 1 | PR #15 merge (conflict resolution) |

### 7.3 Branch Inventory

**Merged to main (safe to delete):**
- `codex/demo-showcase-core`
- `codex/demo-showcase-recovery`
- `codex/post-merge-e2e-lanes`
- `codex/post-merge-gym-adversarial`
- `codex/post-merge-gym-legit`
- `codex/post-merge-tracker-and-ci`
- `codex/pr13-review-fixes`
- `codex/realworld-wave2-auth-and-identity`
- `codex/realworld-wave3-commerce-and-wallets`
- `codex/resource-expansion`

**Not merged to main:**
- `codex/premium-ui-adversarial-program` -- content merged via PR #9 but branch tip diverges
- `codex/realworld-wave1-search-and-redirects` -- content merged via PR #10 but branch tip diverges
- `codex/realworld-wave4-doc-media-support` -- content merged via PR #13 but branch tip diverges
- `codex/realworld-wave5-worker-stress` -- **Contains accumulated Wave 2-4 E2E tests not on main**
- `codex/stacked-credential-edges` -- stale
- `codex/stacked-followups` -- stale
- `codex/stacked-popup-coverage` -- stale

---

## 8. What Was Being Worked On

### 8.1 Completed Work

1. **Foundation (PRs #1-#5)**: Full SentinelSuite integration, navigation firewall, credential guard, popup, options page, storage, CI pipeline, test infrastructure
2. **Test Coverage (PRs #6-#8)**: E2E lane split, adversarial + legitimate gym automation for all 12 levels
3. **Real-World Adversarial Program (PRs #9-#13)**: 20 real-world scenarios designed across 4 waves, gym fixtures built for all
4. **Demo System (PRs #14-#16)**: Three-variant guided demo with core, operator, and recovery chapters

### 8.2 In-Progress Work (Interrupted)

1. **Wave 5 worker-stress scenarios** (RW-21 through RW-25): Gym fixtures and stress tests were being developed but never merged. Backup patch saved.
2. **Missing E2E tests for Waves 2-4**: Tests for RW-08 through RW-20 exist on the wave branches but didn't make it through the stacked merge to main.

### 8.3 Planned but Not Started

1. **Release/repo hygiene** (Batch 7): Issue templates, changelog, README screenshots, manifest branding
2. **Stress lane in CI**: Not wired into scheduled CI or release gating
3. **Property/state tests**: Scoring, DOM hints, state machine coverage
4. **Operator ergonomics**: Event-log filtering, trust/allowlist clarity

---

## 9. Gaps and Issues

### 9.1 Critical: Missing Test Coverage

**13 E2E tests for RW-08 through RW-20 are missing from main.** These tests were written during waves 2-4 but lost during the stacked PR merge process. The gym fixtures exist, but no automated test exercises them on the current `main` branch.

Affected scenarios:
- RW-08: OAuth consent window reuse laundering
- RW-09: Empty/named target popup ambiguity
- RW-10: Keyboard-only auth launch (Space/Enter)
- RW-11: Fake invoice approval button
- RW-12: Wallet connect popup burst
- RW-14: Checkout express-pay overlay
- RW-15: Bank/security alert redirect
- RW-16: Fake document preview overlay
- RW-17: Media overlay hijack
- RW-18: Browser update/codec warning
- RW-19: Tech-support scare popup burst
- RW-20: Chat widget abuse

### 9.2 No Stress Lane on Main

Wave 5 introduced `playwright.stress.config.ts` and `navsentinel.stress.spec.ts` but these were never merged. The stress lane concept exists in the test expansion strategy but isn't implemented on main.

### 9.3 Wave 5 Gym Fixtures Missing

RW-21 through RW-24 gym fixtures (allow-once double-spend, multi-tab isolation, idle-resume) were in progress but not on main.

### 9.4 Documentation Staleness

- `docs/Execution_Tracker.md` status table says Batches 5-6 are "in progress" -- they should be updated to reflect merged PRs
- `docs/Implementation_Roadmap.md` still references PR #5 as the active follow-up
- Manifest still says "NavSentinel Suite (Dev)" -- needs branding decision

### 9.5 No NRS Implementation

The `Intent_Model_and_Scoring.md` doc describes a planned Navigation Risk Score (NRS) that layers additional factors on top of CDS. The doc itself notes "NRS is not implemented yet."

---

## 10. Where We Were Heading

Based on the Execution Tracker, Real-World Adversarial Program, and Testing Expansion Strategy:

1. **Complete Wave 5** (RW-21 through RW-25): Worker-state, tab-churn, and sequence abuse scenarios
2. **Stress lane infrastructure**: Dedicated stress lane with repeated bursts, worker restart, multi-tab sequences
3. **Release hygiene**: Issue templates, changelog, README screenshots, manifest branding
4. **Operator ergonomics**: Better event-log filtering, trust/allowlist UI clarity

---

## 11. Recommended Next Steps

### Immediate (unblock quality)

1. **Recover missing Wave 2-4 E2E tests**: Port the 13 missing RW-08 through RW-20 tests from the wave branches back to main. This is the highest-priority gap -- you have gym fixtures with no automated coverage.

2. **Land Wave 5**: Complete and merge the RW-21 through RW-25 gym fixtures and stress tests from the backup patch.

3. **Clean up stale branches**: Delete the 10+ merged branches and the 3 genuinely stale branches.

### Short-term (security posture hardening)

4. **Implement NRS**: Layer the Navigation Risk Score on top of CDS for richer navigation decisions. The spec already exists in docs.

5. **Wire stress lane into CI**: Add a scheduled/nightly CI job for the stress lane so timing-sensitive bugs get caught automatically.

6. **Property tests**: Add Vitest property tests for scoring, DOM hints, and state machine -- these are cheap to write and catch edge cases unit tests miss.

### Medium-term (product maturity)

7. **Update documentation**: Refresh Execution Tracker and Implementation Roadmap to reflect current state. Update Demo_Showcase_Plan status.

8. **Release hygiene**: Issue templates, changelog workflow, decide on manifest branding (drop "Dev"), README screenshots.

9. **Operator UX improvements**: Event-log filtering/search, clearer allowlist vs. trusted-domains separation in UI.

### Longer-term (capability expansion for enhanced security posture)

10. **Redirect chain analysis**: Correlate short redirect chains to a single gesture token for better detection of multi-hop laundering.

11. **History.pushState gating**: Detect suspicious same-tab URL manipulation within a short window after a gesture.

12. **CSP/permissions analysis**: Extend the extension to analyze page CSP headers and permission requests as additional risk signals.

13. **Cross-extension coordination**: Consider a messaging API that other security extensions could use to share threat intelligence locally.

14. **Behavioral profiling**: Track per-domain navigation patterns over time to detect sites that consistently trigger suspicious scores.

15. **Sub-resource integrity awareness**: Flag when scripts or resources loaded during navigation lack SRI hashes, increasing the risk of supply-chain attacks.

---

## 12. Repository Health Scorecard

| Category | Rating | Notes |
|---|---|---|
| Architecture | Strong | Clean separation between isolated/main world, well-defined modules |
| Code quality | Strong | Strict TypeScript, small focused modules, no external runtime deps |
| Test infrastructure | Good | Solid unit + E2E framework, but Wave 2-4 test gap is significant |
| Documentation | Very Good | Comprehensive docs, but some staleness in tracker/roadmap |
| CI/CD | Good | Two-stage pipeline, but stress lane not wired in |
| Security posture | Strong | Local-first, no telemetry, explainable decisions, bridge hardening |
| Release readiness | Needs Work | Still "(Dev)" branding, no changelog, no issue templates |
| Demo/presentation | Very Good | Three-variant demo system with presenter overlay |
| Adversarial coverage | Incomplete | 25 scenarios designed, 20 have fixtures, but only ~8 have E2E tests on main |

---

## 13. File System Map

```
NavSentinel/
├── extension/
│   ├── manifest.json              # MV3 manifest
│   ├── assets/                    # Icons (16/32/48/128)
│   ├── rules/                     # DNR static rules
│   ├── src/
│   │   ├── content/
│   │   │   ├── capture_isolated.ts    # 767 lines - Core nav controller
│   │   │   ├── main_guard.ts          # 682 lines - Main-world patcher
│   │   │   ├── credential_guard.ts    # 240 lines - Credential interceptor
│   │   │   ├── credential_guard_model.ts  # 58 lines
│   │   │   ├── credential_modal.ts    # 231 lines - Block/prompt modal
│   │   │   ├── dom_builder.ts         # 195 lines - Element hints
│   │   │   ├── debug_overlay.ts       # 108 lines - Debug CDS overlay
│   │   │   └── ui_toast.ts            # 109 lines - Toast notifications
│   │   ├── shared/
│   │   │   ├── storage.ts             # 356 lines - All persistence
│   │   │   ├── domain.ts              # 382 lines - Credential risk engine
│   │   │   ├── scoring.ts             # 145 lines - CDS calculator
│   │   │   ├── allowlist.ts           # 98 lines - Nav allowlist
│   │   │   ├── types.ts               # 47 lines
│   │   │   ├── stateMachine.ts        # 40 lines
│   │   │   ├── popup_model.ts         # 51 lines
│   │   │   ├── popup_test.ts          # 31 lines
│   │   │   └── event_tone.ts          # 10 lines
│   │   ├── popup/
│   │   │   ├── popup.ts               # 315 lines - Popup logic
│   │   │   └── popup.html
│   │   ├── options/
│   │   │   ├── options.ts             # 375 lines - Options page logic
│   │   │   └── options.html
│   │   └── sw/
│   │       └── sw.ts                  # 340 lines - Service worker
│   └── dist/                          # Build output (generated)
│
├── gym/                               # 52 HTML fixtures
│   ├── index.html                     # Gym index
│   ├── level1-12-*.html               # Primitive levels
│   └── rw01-rw20-*.html               # Real-world scenarios
│
├── tests/
│   ├── credential-domain.test.ts
│   ├── credential-guard-model.test.ts
│   ├── popup-model.test.ts
│   ├── storage-suite.test.ts
│   ├── sw-rollback.test.ts
│   └── e2e/
│       ├── navsentinel.spec.ts         # 22 E2E tests
│       ├── credential-guard.spec.ts    # 4 credential E2E tests
│       ├── suite-ui.spec.ts            # UI tests
│       ├── demo-showcase.core.spec.ts
│       ├── demo-showcase.operator.spec.ts
│       ├── demo-showcase.recovery.spec.ts
│       ├── demo-showcase-helpers.ts
│       ├── demo-showcase-popup.ts
│       ├── demo-showcase-session.ts
│       └── extension_test_utils.ts     # Shared E2E helpers
│
├── scripts/
│   ├── check_versions.mjs
│   ├── package.mjs
│   └── run_demo.mjs
│
├── docs/                              # 18 documentation files
│   ├── README.md
│   ├── Project_Overview.md
│   ├── Architecture_and_Data_Flow.md
│   ├── Intent_Model_and_Scoring.md
│   ├── Testing_and_Gym.md
│   ├── Execution_Tracker.md
│   ├── Implementation_Roadmap.md
│   ├── Real_World_Adversarial_Program.md
│   ├── Testing_Expansion_Strategy.md
│   ├── Demo_Showcase_Plan.md
│   ├── Threat_Model_and_Cases.md
│   ├── Checklists.md
│   ├── RELEASING.md
│   ├── Snippets_By_Topic.md
│   └── archive/
│
├── .github/workflows/ci.yml
├── package.json
├── tsconfig.json
├── vite.config.ts
├── playwright.config.ts
├── playwright.demo.config.ts
├── playwright.rollback.config.ts
├── playwright.live.config.ts
├── README.md
├── CONTRIBUTING.md
├── AGENTS.md
├── PRIVACY.md
└── SECURITY.md
```

---

## 14. Vision: Enhancing Web Navigation Security Posture

NavSentinel already has a strong foundation for becoming a comprehensive web navigation security tool. Here's a strategic vision for where it could go:

### Tier 1: Complete the Current Program
- Recover and merge all missing E2E tests
- Complete Wave 5 worker-stress scenarios
- Ship a v1.0 with clean branding and changelog

### Tier 2: Deepen Detection
- Implement NRS for richer navigation scoring
- Add redirect-chain correlation
- Add history.pushState gating
- Add form-action mutation detection (forms whose action changes after page load)
- Add timing-based anomaly detection (scripts that delay navigation to avoid detection)

### Tier 3: Broaden Coverage
- CSP header analysis as a page trust signal
- Sub-resource integrity awareness
- Mixed-content detection beyond forms
- iframe sandboxing analysis
- Service worker intercept detection (malicious service workers)

### Tier 4: User Intelligence
- Per-domain behavioral profiling (sites that consistently trigger high CDS)
- Navigation pattern anomaly detection over time
- Exportable threat reports for security-conscious users
- Integration with browser bookmarks/history for trust inference

### Tier 5: Ecosystem
- API for other extensions to query NavSentinel's trust signals
- Optional shared local intelligence (opt-in, no cloud)
- Browser-native integration proposals (Chromium APIs)
- Cross-browser port (Firefox MV3 when stable)
