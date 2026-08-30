# Agent Index - NavSentinel

Last reviewed: 2026-08-30.

This is a fast orientation layer for coding agents. It should point to interfaces and seams, not duplicate implementation details.

## Start Here

0. Verify live Git/GitHub state for the issue or PR in scope. The optional short
   snapshot is `docs/agentic/HANDOFF.md`; `ORCHESTRATOR.md` is history.
1. `CLAUDE.md` - product invariants and focused checks.
2. `AGENTS.md` - compact Codex-specific facts.
3. `docs/Project_Roadmap.md` - product execution and release gates.
4. `docs/development-architecture/README.md` - milestone routing and trust-boundary contracts; it is not a second roadmap.
5. `docs/security-program/README.md` for adversarial scenario, capability, and evidence work; it is subordinate to the roadmap.
6. `CONTRIBUTING.md` - change-surface guidance and style expectations.
7. This file - code-grounded seam map.
8. `ACTION_ITEMS.md` only when the task involves a human decision/manual check.
9. An optional runtime skill only when it materially helps the current task.

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
| Opt-in overlay cleanup (#555) | `storage.ts` (`nav.autoDismissOverlays`), Options + popup UI, `overlay_cleanup.ts` | `mutation_monitor.ts` classification plus bounded page-settle scan, `extension_owned_overlay.ts`, and `capture_isolated.ts` top/child-frame lifecycle | `tests/overlay-cleanup.test.ts`, mutation-monitor/storage/toggle/toast/popup-a11y tests, suite-ui + mutation-01 Phase-2 + evasion and `overlay-cleanup-nesting.spec.ts` E2E; settled/injected/click-time and cross-origin child-frame cleanup, reversible suppression, no click replay, benign/Off preservation; Gate-3 for shipped page/UI behavior. |
| Credential guard | `credential_guard.ts`, `credential_guard_model.ts` | `credential_modal.ts`, `domain.ts`, `allowlist.ts` | credential/domain/allowlist tests, credential-guard E2E. |
| Service worker state and rollback | `sw.ts`, `session_state.ts`, `pending_decision.ts` | `pending_decision_handlers.ts`, `pending_decision_store.ts`, `redirect_chain.ts`, `icon_manager.ts` | pending-decision handler/SW lifecycle tests, emitted static-worker import inspection, sw-rollback, session-state, redirect-chain tests, build/perf, rollback/stress E2E. |
| JS behavior analysis (capability OFF, RI-07) | `js_behavior_monitor.ts` (enabled variant), `js_behavior_monitor.disabled.ts` (what every committed profile builds) | Selected by `capabilities.jsBehaviorInstrumentation` in `release-profiles.json` via the `@navsentinel/js-behavior-monitor` alias; `main_guard.ts` (gated init), `capture_isolated.ts` (bridge + state), `nrs.ts` (scoring), `js_behavior_state.ts` (shared state), options read-only disclosure | js-behavior-capability-off, js-behavior-monitor, js-behavior-state, js-behavior-integration, release-profile tests; `npm run build` + `npm run check:release-profile`; js-behavior E2E asserts the globals stay native. Design: `docs/design/js_behavior_analysis.md`. |
| RI-02 visual-sim excision (#424) | `capture_isolated.ts`, `nrs.ts`, `sw.ts`, `session_state.ts` | manifests, `release-profile.mjs`, `check-release-profile.mjs`, release-profile/manifest/SW/session/NRS tests | Retired visual-sim modules, asset, viewport-capture message, NRS factor, and session state must remain absent. Artifact checks reject their asset and bundle tokens; Gate-3 is still required before merge. |
| Reputation research and content analysis | `reputation.ts`, `reputation_runtime.enabled.ts`, `reputation_runtime.disabled.ts`, `content_analyzer.ts`, `domain_profile.ts` | `release-profiles.json`, `check-release-profile.mjs`, `sri_checker.ts`, `csp_analyzer.ts`, `build-bloom-filter.mjs` | release-profile/reputation/domain-profile/sri/csp tests; both profile builds; corpus E2E. |
| Popup/options UI | `popup.ts`, `popup_model.ts`, `options.ts` | popup/options CSS/HTML, `design_tokens.css`, `icons.ts`, `event_tone.ts`, `explanations.ts`, `smart_defaults.ts` | popup-model/popup-a11y/toggle-a11y/icons unit tests, suite-ui E2E. UI uses segmented controls (`#navModeSeg`/`#credModeSeg` with `.seg-btn[data-value]` + `aria-pressed`), toggle buttons (`role="switch"` + `aria-checked`), and sidebar nav (`data-section`). Accessibility (merged #132-#135): radiogroup pattern + shared `seg_control.ts`, `aria-labelledby`/`aria-describedby`, popup ARIA landmarks/live regions, decorative SVG `aria-hidden`. |
| Onboarding | `onboarding/onboarding.ts` | onboarding HTML/CSS, imports `icons.ts` | `tests/onboarding.test.ts`, `npm run build`. |
| Prompt decision authority (RI-01) | `pending_decision.ts`, `pending_decision_handlers.ts`, `pending_decision_store.ts`, `ui_toast.ts`, `credential_modal.ts` | `sw.ts`, `credential_guard.ts`, `capture_isolated.ts`, popup/pending-action state, `tests/e2e/extension_test_utils.ts` | #466's create/list/consume broker is dormant and URL-minimized; consume uses an opaque worker-owned destination capability, and list/consume require positive current-frame enumeration. It has no producer/UI/executor. Page-injected UI still must become warn/cancel only, while proceed/allow/trust/resume moves to tab/destination-bound extension-origin UI with TTL. Test synthetic input, trusted-click redressing, host tamper/removal, removed child frames, tab/document switch, stale state, and broker lifecycle; Gate-3 required. |
| Gym and E2E harness | `gym/index.html`, `tests/e2e/extension_test_utils.ts` | Gym HTML fixtures and E2E specs under `tests/e2e/` | Playwright spec, `npm run gym:serve`; verify volatile counts live. |
| Adversarial security programme | `docs/security-program/README.md`, registries under `docs/security-program/registry/` | mappings, methodology, operational ledgers, `scripts/security-program/`, typed sink in `tests/e2e/proving_ground_fake_sink.ts` | `npm run security:check`; after build, `npm run test:e2e:proving-ground`; receipts stay ignored; never edit `extension/dist`. |
| Build/release | `package.json`, `vite.config.ts`, `extension/manifest.json`, `config/release-profiles.json` | `scripts/build-extension.mjs`, `scripts/check-release-profile.mjs`, `scripts/package.mjs`, `scripts/release.mjs`, `scripts/check_versions.mjs`, `scripts/check-perf-budget.mjs` | `npm run verify:versions`, both profile builds, `npm run check:release-profile -- --release`, `npm run package:ext`. |
| Data pipeline | `scripts/build-bloom-filter.mjs`, `scripts/fetch-phishing-corpus.mjs` | `scripts/build-test-bloom-filter.mjs`, `scripts/measure-fp.mjs`, `scripts/check-bloom-size.mjs`, `scripts/update-psl.mjs` | `npm run build:bloom`, `npm run check:bloom-size`. |
| Contributor guidance | `CLAUDE.md`, `AGENTS.md`, `autodoc/AGENT_INDEX.md` | Optional `.claude/skills/*` and `.agents/skills/*` | No repo-local harness; use the product check for the changed seam. |

All paths above are relative to repo root. Content scripts live under `extension/src/content/`, shared modules under `extension/src/shared/`, SW under `extension/src/sw/`.

## Current Agent-Readiness Observations

- NavSentinel v0.4.0 is pre-alpha with no established adoption: engineering
  implementation is substantial, but release integrity, validation,
  distribution, and market evidence are open. Do not repeat the old "Phases
  0-3 complete" framing.
- **UI redesign complete** (2026-05-16): brass/jade design system, design tokens, 26-icon SVG system, segmented controls replacing selects, sidebar nav options page, ShieldArc popup gauge. See `docs/REDESIGN_ORCHESTRATION.md`.
- `docs/Product_Strategy.md` owns product direction;
  `docs/Project_Roadmap.md` owns execution; GitHub issues own implementation;
  `docs/development-architecture/` owns milestone routing and architecture
  contracts; `ACTION_ITEMS.md` owns human-only work.
- `docs/Comprehensive_Project_Analysis.md` is a historical snapshot from 2026-04-09 — do not treat it as current.
- Runtime skill files are optional aids with no parity contract or validation gate.
- Build output and generated data are easy context traps. Agents should edit source under `extension/src/` and avoid `extension/dist/`.
- The highest-risk seams are main-world patching, bridge messages, service-worker lifecycle state, and credential/data privacy behavior.
- Only M0 Proving Ground and M1 unlisted-beta release integrity are active.
  Current release boundaries include #601 extension-origin decision authority,
  #175/#186/#523 bridge identity/recovery/starvation policy, #176 session-URL
  minimization, #474's owner-selected behavioral reset boundary, #455
  pre-collection disclosure/activation, and AI-19 product-name clearance.
  Reputation and broad JS instrumentation are intentionally absent from the
  release-eligible interaction-only profile. Do not select planned, passive, or
  frozen work except #417's documented test-methodology exception.
- **`PromptOutcomeEntry` (`storage.ts`) is replay-grade enriched (P5-C1 / #238):** beyond `{domain, destDomain?, type, score, outcome, reasons?}` it now carries optional `cds`, `nrsFactors`, `navAnomalyScore`, `adaptiveAdj`, `thresholdUsed`, and a serialized `elementContext` (`ClickContext`). Populated at every `appendPromptOutcome` site — nav (`capture_isolated.ts`, snapshotted from local decision scope, not `lastDebug`) and cred (`credential_guard.ts`, now also sets `destDomain`); sanitized/bounded in `appendPromptOutcome`. All fields optional (back-compat). Foundation for the advisor journal (P5-B) and tuning corpus (P5-C5).
- Historical merge context: the D-series discovery program merged 2026-06-05: #180 (D-PROF domain_profile reader serialization), #182 (D-STORE prompt-outcome SW-delegated writes), #183 (D-FOCUS credential-modal focus trap), #185 (D-BRIDGE outbound buffer + handshake timeout; also fixed the form-submit patch-order bug), #187 (D-SWRATE capture rate-limit persistence), #189 (D-ANOM sync-lag), #190 (D-IFRAME injected data:/blob:/srcdoc iframes), #191 (D-ONCREATE pre-hydration child-window tracking), #193 (D-REDOS content-analyzer regex bounding), #194 (D-OPTRACE options Save reentrancy guard), #195 (D-SRIHIDE inline-hidden password skip). #114-#174 merged across Cycles 6-7 (2026-05-29): toolchain migration (vite 8 / vitest 4), ESLint flat-config + CI lint gate, perf-budget CI, test-coverage + property tests, accessibility (#132-#135), prototype-pollution guards, P4-01a/b visual-sim (#172/#174), FF-01 Firefox `browser.*` shim (#173).
- All icon SVGs from `icon()` and `logoSentinel()` include `aria-hidden="true"` (#135 merged).
- JS behavior issue #127 is frozen post-beta research, not a beta-completion
  task. Current action ownership belongs in `docs/Project_Roadmap.md`, milestone
  routing lives in `docs/development-architecture/`, and issue/PR truth comes
  from live GitHub. `HANDOFF.md` is a short next-slice summary;
  `ORCHESTRATOR.md` is historical cycle context, not a parallel task register.

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
