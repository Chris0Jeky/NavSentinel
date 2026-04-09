# NavSentinel Personal Claude Workflow

This file is local-only. It gives Claude a stable repo-specific entrypoint without modifying the shared repository workflow.

## Working model

- Treat `AGENTS.md` as the primary repo contract.
- Treat this repo as a Chrome MV3 browser extension built with TypeScript and Vite.
- Treat `docs/Project_Roadmap.md` as the active planning document (phases, tasks, decisions).
- Keep diffs small and reviewable.
- For meaningful implementation work, create a branch scoped to the change before editing.

## Read order

1. `AGENTS.md`
2. `CONTRIBUTING.md` for change-surface guidance and style expectations
3. `docs/Project_Roadmap.md` for the active work plan (41 tasks, 5 phases)
4. `docs/README.md` when deeper orientation into docs is needed

Read when relevant:

- `docs/Architecture_and_Data_Flow.md` for runtime layers and bridge design
- `docs/Intent_Model_and_Scoring.md` for CDS and credential-risk heuristics
- `docs/Testing_and_Gym.md` for test surfaces and Gym coverage
- `docs/Real_World_Adversarial_Program.md` for adversarial scenario backlog
- `docs/Demo_Showcase_Plan.md` for demo lane work

## Preferred skills

General skills from `~/.claude/skills`:

- `safe-shell`
- `small-safe-slice`
- `verification-closeout`

Repo-specific local skills in this checkout:

- `ns-repo-onramp`
- `ns-safe-slice`
- `ns-verify-handoff`
- `ns-ext-dev`

## Repo truths

- The active work plan is tracked in `docs/Project_Roadmap.md`, not in a separate control plane.
- The extension is local-first: no remote telemetry, no reputation lookups, no password-value storage.
- Source lives under `extension/src/`; build output goes to `extension/dist/`. Edit source, not output.
- Gym fixtures under `gym/` are the primary verification surface for heuristic changes.
- MV3 service worker is ephemeral; persist settings in `chrome.storage.local`.
- Content scripts run in isolated world by default; main-world patching is through `main_guard.ts`.

## Guardrails

- Do not rely on tracked `.gitignore` changes to privatize local workflow files.
- Keep `CLAUDE.md`, `.claude/`, and `.codex/` local-only in this repo.
- Never commit secrets, tokens, machine-specific `.env` values, or sensitive dumps.
- Do not mix navigation-guard and credential-guard logic changes in the same slice.
- Prefer concrete verification over broad explanation.