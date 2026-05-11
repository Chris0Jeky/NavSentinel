# Agent Index - NavSentinel

Last reviewed: 2026-05-11.

This is a fast orientation layer for coding agents. It should point to interfaces and seams, not duplicate implementation details.

## Start Here

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
| Navigation capture and CDS/NRS | `extension/src/content/capture_isolated.ts`, `extension/src/shared/scoring.ts`, `extension/src/shared/nrs.ts` | `extension/src/content/dom_builder.ts`, `extension/src/content/debug_overlay.ts` | `npm run test`, targeted scoring/NRS tests, relevant Gym E2E. |
| Main-world guard and bridge | `extension/src/content/main_guard.ts` | `extension/src/content/pushstate_guard.ts`, `extension/src/content/dblclick_guard.ts` | `npm run build`, `tests/e2e/phase2-detections.spec.ts`, pushState/doubleclick unit tests. |
| Credential guard | `extension/src/content/credential_guard.ts`, `extension/src/content/credential_guard_model.ts` | `extension/src/content/credential_modal.ts`, `extension/src/shared/domain.ts` | credential/domain Vitest tests and `tests/e2e/credential-guard.spec.ts`. |
| Service worker state and rollback | `extension/src/sw/sw.ts`, `extension/src/shared/session_state.ts` | rollback, allow-once, OAuth, DNR, redirect-chain state inside `sw.ts` | `tests/sw-rollback.test.ts`, `tests/session-state.test.ts`, rollback/stress E2E lanes. |
| Reputation and content analysis | `extension/src/shared/reputation.ts`, `extension/src/content/content_analyzer.ts` | `scripts/build-bloom-filter.mjs`, `scripts/fetch-phishing-corpus.mjs` | reputation/content analyzer tests, corpus lane when data exists. |
| Popup/options UI | `extension/src/popup/popup.ts`, `extension/src/options/options.ts` | popup/options CSS and HTML in same directories | popup/options unit tests, `npm run build`, UI E2E smoke. |
| Gym and E2E harness | `gym/index.html`, `tests/e2e/extension_test_utils.ts` | scenario pages under `gym/`, specs under `tests/e2e/` | targeted Playwright spec, `npm run gym:serve` for manual checks. |
| Build/release | `package.json`, `vite.config.ts`, `extension/manifest.json` | `scripts/package.mjs`, version check script | `npm run verify:versions`, `npm run build`, `npm run package:ext`. |
| Agentic workflow | `CLAUDE.md`, `AGENTS.md`, `docs/agentic/*`, `autodoc/AGENT_INDEX.md` | `.claude/skills/*`, `.agents/skills/*`, `scripts/agent_hooks/*` | path checks, hook script py_compile, render failure ledger. |

## Current Agent-Readiness Observations

- NavSentinel already has focused repo docs, strong test surfaces, and local Claude skills.
- The active planning source is `docs/Project_Roadmap.md`; archived execution trackers are historical only.
- Existing Claude skills were refreshed to use the active roadmap instead of archived trackers.
- Codex has a matching `.agents/skills` layer and should use `AGENTS.md`, Codex-native planning, parallel reads, patching, and verification tools.
- Build output and generated data are easy context traps. Agents should edit source under `extension/src/` and avoid `extension/dist/`.
- The highest-risk seams are main-world patching, bridge messages, service-worker lifecycle state, and credential/data privacy behavior.

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
