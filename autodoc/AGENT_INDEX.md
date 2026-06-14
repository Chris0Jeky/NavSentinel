# Agent Index - NavSentinel

Last reviewed: 2026-06-14.

This is a fast orientation layer for coding agents. It should point to interfaces and seams, not duplicate implementation details.

## Start Here

0. **Resuming the autonomous work loop?** Read `ACTION_ITEMS.md` (human-owned tasks + current-state snapshot), `docs/agentic/HANDOFF.md` (latest session handoff), and `docs/agentic/ORCHESTRATOR.md` (living backlog/cycle log) first. As of the 2026-06-14 checkpoint: `main` @ `db63192`; the active PR gate set was #249 (human Gate-3), #254 (docs/status if still open), #256 (green/clean aging), and #257 (green/clean aging). Do not start duplicate work for #233/#234/#235/#236/#238; after PR gates settle, likely next candidates are #232 or #237.
1. `AGENTS.md` - repo operating rules.
2. `CLAUDE.md` - Claude-specific compact contract.
3. `docs/Project_Roadmap.md` - active phase status, gates, decisions, and next tasks.
4. `CONTRIBUTING.md` - change-surface guidance and style expectations.
5. `docs/README.md` - documentation map.
6. This file - code-grounded agent map.
7. Relevant runtime skill under `.claude/skills/*/SKILL.md` or `.agents/skills/*/SKILL.md`.

## Do Not Read By Default

- `node_modules/`
- `extension/dist/`
- `dist/`
- `test-results/`
- `playwright-report/`
- `artifacts/` unless the user asks about generated artifacts.
- `RESOURCES/` unless importing original research inputs.
- `HistoryDump.txt`
- `NavSentinel_ Enhancing Navigation Intent Filtering.pdf`
- `extension/public/reputation_data.bin`
- `extension/src/shared/psl_data.json` unless updating PSL behavior.
- archived docs under `docs/archive/` unless provenance is required.

## Product Seams

| Domain | Interface files | Meaty files | Verification hints |
| --- | --- | --- | --- |
| Navigation capture and CDS/NRS | `capture_isolated.ts`, `scoring.ts`, `nrs.ts`, `nav_anomaly.ts`, `adaptive_scoring.ts` | `dom_builder.ts`, `debug_overlay.ts`, `domain_groups.ts` | scoring/NRS/nav-anomaly/adaptive tests, Gym E2E. |
| Main-world guard and bridge | `main_guard.ts`, `pushstate_guard.ts`, `dblclick_guard.ts` | `clickfix_detector.ts`, `mutation_monitor.ts`, `oauth_monitor.ts` | `npm run build`, phase2-detections E2E, pushstate/dblclick/clickfix unit tests. |
| Credential guard | `credential_guard.ts`, `credential_guard_model.ts` | `credential_modal.ts`, `domain.ts`, `allowlist.ts` | credential/domain/allowlist tests, credential-guard E2E. |
| Service worker state and rollback | `sw.ts`, `session_state.ts` | `redirect_chain.ts`, `icon_manager.ts` | sw-rollback, session-state, redirect-chain tests, rollback/stress E2E. |
| JS behavior analysis | `js_behavior_monitor.ts` | Integrated: `main_guard.ts` (init), `capture_isolated.ts` (bridge + state), `nrs.ts` (scoring), `js_behavior_state.ts` (shared state) | js-behavior-monitor tests, js-behavior-state tests, js-behavior-integration tests, gym fixtures (01-07). Design: `docs/design/js_behavior_analysis.md`. |
| Visual similarity (P4-01) | `visual_sim_capture.ts`, `visual_sim_templates.ts`, `visual_sim_brand_domains.ts` | `visual_sim_hash.ts`, `visual_sim_loader.ts`, `visual_sim_types.ts`; integrated via `capture_isolated.ts` (scheduler ~L716-880) and `nrs.ts` (`visualSimilarityScore`, cap +30) | visual-sim-* unit + property tests, `tests/e2e/visual-sim.spec.ts`, gym `visual-sim-0{1,2}-*.html`. **Brand templates are PLACEHOLDER hashes** (`scripts/build-brand-templates.mjs`) — pipeline is wired but spoof detection is not live until real templates exist (P4-01c). |
| Reputation and content analysis | `reputation.ts`, `content_analyzer.ts`, `domain_profile.ts` | `sri_checker.ts`, `csp_analyzer.ts`, `build-bloom-filter.mjs` | reputation/domain-profile/sri/csp tests, corpus E2E. |
| Popup/options UI | `popup.ts`, `popup_model.ts`, `options.ts` | popup/options CSS/HTML, `design_tokens.css`, `icons.ts`, `event_tone.ts`, `explanations.ts`, `smart_defaults.ts` | popup-model/popup-a11y/toggle-a11y/icons unit tests, suite-ui E2E. UI uses segmented controls (`#navModeSeg`/`#credModeSeg` with `.seg-btn[data-value]` + `aria-pressed`), toggle buttons (`role="switch"` + `aria-checked`), and sidebar nav (`data-section`). Accessibility (merged #132-#135): radiogroup pattern + shared `seg_control.ts`, `aria-labelledby`/`aria-describedby`, popup ARIA landmarks/live regions, decorative SVG `aria-hidden`. |
| Onboarding | `onboarding/onboarding.ts` | onboarding HTML/CSS, imports `icons.ts` | `tests/onboarding.test.ts`, `npm run build`. |
| Toast and state display | `ui_toast.ts` | `stateMachine.ts`, `types.ts`, `popup_test.ts` | statemachine-timing tests, `npm run build`. Toast uses Shadow DOM with self-contained brass-palette styles. |
| Gym and E2E harness | `gym/index.html`, `tests/e2e/extension_test_utils.ts` | 121 gym HTML fixtures, 12 E2E specs under `tests/e2e/` | Playwright spec, `npm run gym:serve`. |
| Build/release | `package.json`, `vite.config.ts`, `extension/manifest.json` | `scripts/package.mjs`, `scripts/release.mjs`, `scripts/check_versions.mjs`, `scripts/check-perf-budget.mjs` | `npm run verify:versions`, `npm run build`, `npm run package:ext`. |
| Data pipeline | `scripts/build-bloom-filter.mjs`, `scripts/fetch-phishing-corpus.mjs` | `scripts/build-test-bloom-filter.mjs`, `scripts/measure-fp.mjs`, `scripts/check-bloom-size.mjs`, `scripts/update-psl.mjs` | `npm run build:bloom`, `npm run check:bloom-size`. |
| Agentic workflow | `CLAUDE.md`, `AGENTS.md`, `docs/agentic/*`, `autodoc/AGENT_INDEX.md` | `.claude/skills/*`, `.agents/skills/*`, `scripts/agent_hooks/*` | `npm run agent:hooks:smoke`, `npm run agent:skills:validate`. |

All paths above are relative to repo root. Content scripts live under `extension/src/content/`, shared modules under `extension/src/shared/`, SW under `extension/src/sw/`.

## Current Agent-Readiness Observations

- NavSentinel v0.4.0, Phases 0-3 complete + Phase 4 partial (4/8 fully done; P4-01 visual-sim and P4-02 JS-behavior wired-but-not-complete). Test counts move with active PRs; use `npm run test`, targeted E2E lanes, and the current handoff for verified counts.
- **UI redesign complete** (2026-05-16): brass/jade design system, design tokens, 26-icon SVG system, segmented controls replacing selects, sidebar nav options page, ShieldArc popup gauge. See `docs/REDESIGN_ORCHESTRATION.md`.
- The active planning source is `docs/Project_Roadmap.md`; archived execution trackers are historical only.
- `docs/Comprehensive_Project_Analysis.md` is a historical snapshot from 2026-04-09 — do not treat it as current.
- Codex has a matching `.agents/skills` layer and should use `AGENTS.md`, Codex-native planning, parallel reads, patching, and verification tools.
- Build output and generated data are easy context traps. Agents should edit source under `extension/src/` and avoid `extension/dist/`.
- The highest-risk seams are main-world patching, bridge messages, service-worker lifecycle state, and credential/data privacy behavior.
- **`PromptOutcomeEntry` (`storage.ts`) is replay-grade enriched (P5-C1 / #238):** beyond `{domain, destDomain?, type, score, outcome, reasons?}` it now carries optional `cds`, `nrsFactors`, `navAnomalyScore`, `adaptiveAdj`, `thresholdUsed`, and a serialized `elementContext` (`ClickContext`). Populated at every `appendPromptOutcome` site — nav (`capture_isolated.ts`, snapshotted from local decision scope, not `lastDebug`) and cred (`credential_guard.ts`, now also sets `destDomain`); sanitized/bounded in `appendPromptOutcome`. All fields optional (back-compat). Foundation for the advisor journal (P5-B) and tuning corpus (P5-C5).
- Historical merge context: the D-series discovery program merged 2026-06-05: #180 (D-PROF domain_profile reader serialization), #182 (D-STORE prompt-outcome SW-delegated writes), #183 (D-FOCUS credential-modal focus trap), #185 (D-BRIDGE outbound buffer + handshake timeout; also fixed the form-submit patch-order bug), #187 (D-SWRATE capture rate-limit persistence), #189 (D-ANOM sync-lag), #190 (D-IFRAME injected data:/blob:/srcdoc iframes), #191 (D-ONCREATE pre-hydration child-window tracking), #193 (D-REDOS content-analyzer regex bounding), #194 (D-OPTRACE options Save reentrancy guard), #195 (D-SRIHIDE inline-hidden password skip). #114-#174 merged across Cycles 6-7 (2026-05-29): toolchain migration (vite 8 / vitest 4), ESLint flat-config + CI lint gate, perf-budget CI, test-coverage + property tests, accessibility (#132-#135), prototype-pollution guards, P4-01a/b visual-sim (#172/#174), FF-01 Firefox `browser.*` shim (#173).
- All icon SVGs from `icon()` and `logoSentinel()` include `aria-hidden="true"` (#135 merged).
- Older JS behavior issue #127 remains relevant, but current issue/PR inventory belongs in `docs/Project_Roadmap.md`, `docs/agentic/HANDOFF.md`, `docs/agentic/ORCHESTRATOR.md`, and live GitHub state.

## Interface-On-Top Convention

For any new or refactored domain:

1. Add or update this file, `autodoc/interfaces/<domain>.md`, or a local `README.agent.md`.
2. List entry points, invariants, edit seams, and verification commands.
3. Keep cross-domain imports pointed at stable helpers or facade modules where they exist.
4. Do not duplicate source code or long implementation summaries.
5. Add a short "agent entry" comment near complex seams only when the code structure is not self-evident.

## Minimum Handoff Format

```text
Changed: <files/seams>
Verified: <commands/results>
Not verified: <reason>
Failures/workarounds: <classification + future fix>
Docs/status sync: <updated or not needed>
Next safe slice: <one concrete action>
```
