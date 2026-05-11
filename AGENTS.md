# Repository Guidelines

This is the Codex operating contract for NavSentinel. Keep this file compact; put detailed procedures in `.agents/skills/*/SKILL.md`, `docs/agentic/*`, and `autodoc/*`.

## Authority Order

1. User prompt for the current turn.
2. This `AGENTS.md` file for Codex-specific behavior.
3. `docs/Project_Roadmap.md` for active phase status, priorities, and gates.
4. `autodoc/AGENT_INDEX.md` for fast code-seam orientation.
5. Relevant Codex skill under `.agents/skills/*/SKILL.md`.
6. Deeper docs, archives, generated artifacts, and historical material only when needed.

When sources conflict, use the higher source and report the conflict.

## Codex Tooling

Use the best available Codex tools for the job:

- Use `rg` and `rg --files` first for code search.
- Use `multi_tool_use.parallel` for independent reads/searches.
- Use `update_plan` for multi-step work and update it as status changes.
- Use `apply_patch` for manual edits.
- Use shell commands for concrete verification, especially npm scripts and targeted tests.
- Use Playwright/browser tooling for browser-only extension behavior when available.
- Use `tool_search` for current library/framework/API docs and official docs integrations when available.
- Use web verification for unstable current facts, official sources first.
- Use subagents only when the user explicitly asks for delegation or parallel agents.

Do not rely on Claude-only `.claude/settings.json` hooks for Codex safety. Apply the same safety rules through this file, `.agents/skills`, and explicit command discipline.

## First 5 Minutes

1. Read `docs/Project_Roadmap.md`.
2. Read `autodoc/AGENT_INDEX.md`.
3. Select one primary `.agents/skills/*` workflow and at most one support workflow.
4. Identify the smallest safe, reviewable change.
5. State blockers, assumptions, verification target, and docs-sync target before editing.

Do not bulk-read `node_modules`, build output, generated data, archive docs, or research dumps unless the task explicitly requires them.

## Project Structure

- `extension/` holds the MV3 extension source and build output.
  - `extension/src/content/`: content scripts, isolated capture, main guard, UI toast, credential guard.
  - `extension/src/shared/`: shared types, storage, scoring, NRS, reputation, state, and domain helpers.
  - `extension/src/options/`: options page UI.
  - `extension/src/popup/`: popup UI.
  - `extension/src/sw/`: service worker.
  - `extension/dist/`: generated build output. Do not edit directly.
- `gym/` contains deterministic HTML test pages.
- `tests/e2e/` contains Playwright specs.
- `docs/` contains project documentation, plans, and agentic protocols.
- `.agents/skills/` contains Codex-oriented workflows.
- `.claude/skills/` and `.claude/settings.json` contain Claude-oriented workflows and guardrails.

## Build, Test, And Development Commands

- `npm install`: install dependencies.
- `npm run typecheck`: TypeScript check.
- `npm run build`: bundle the extension to `extension/dist/`.
- `npm run watch`: rebuild on changes.
- `npm run test`: run unit tests with Vitest.
- `npm run test:e2e`: run deterministic Playwright E2E tests.
- `npm run test:e2e:smoke`, `npm run test:e2e:regression`, `npm run test:e2e:rollback`, `npm run test:e2e:stress`, `npm run test:e2e:corpus`: targeted E2E lanes.
- `npm run gym:serve`: serve the Gym at port 5173.
- `npm run verify:versions`, `npm run package:ext`: release/package checks.

## Coding Style And Naming

- Indentation: 2 spaces.
- TypeScript is the default for extension code.
- Match existing lower_snake or lower-kebab filenames.
- TypeScript identifiers use camelCase or PascalCase.
- Keep modules small and focused.
- Keep UI dependency-light unless richer UI is explicitly planned.

## Testing Guidelines

- Unit tests: Vitest, `*.test.ts` naming under `extension/src` or `tests`.
- E2E tests: Playwright, `tests/e2e/*.spec.ts`.
- Focus on Gym coverage for browser behavior.
- Add tests that assert no unwanted tabs and correct allow/block behavior.
- For scoring threshold changes, verify in the Gym, not only unit tests.

## Security And Privacy Guardrails

- MV3 service worker is ephemeral; persist critical short-lived state in `chrome.storage.session` where appropriate.
- Avoid runtime network calls and content exfiltration; keep logic local.
- Never store password values.
- Ensure content scripts run in all frames where appropriate.
- Main-world patching must be narrow, defensible, and bridge-validated.
- Do not mix navigation-guard and credential-guard logic changes in one slice unless the request requires it.
- Do not edit generated `extension/dist/` output.

## Skill Routing

Use these Codex workflows when relevant:

- `ns-repo-onramp`: broad or ambiguous repo work.
- `ns-repo-map`: find exact code seams.
- `ns-safe-slice`: implement a small reviewable change.
- `ns-ext-dev`: MV3 runtime, build, reload, and extension behavior.
- `ns-test-harness`: choose or add tests.
- `ns-threat-validation`: detection efficacy, FP/TP, corpus, Gym, adversarial coverage.
- `ns-security-review`: bridge, permissions, storage, credentials, data isolation, and remote-call risk.
- `ns-ui-ux`: popup, options, onboarding, prompt copy, and accessibility.
- `ns-question-batch`: ask only blocker questions.
- `ns-failure-capture`: classify failed tools/tests/workarounds.
- `ns-interface-map`: update agent-facing maps.
- `ns-roadmap-sync`: update roadmap/status docs when truth changes.
- `ns-issue-to-pr`: take one issue through branch, implementation, verification, and handoff.
- `ns-program-board`: pick the next unblocked roadmap slice.
- `ns-verify-handoff`: final verification and handoff.
- `ns-codex-tooling`: Codex-specific tool selection and safety.

## Question, Failure, And Handoff Protocols

- Use `docs/agentic/QUESTION_PROTOCOL.md` before asking for clarification.
- Use `docs/agentic/FAILURE_LEDGER.md` and `scripts/agent_hooks/render_failure_ledger.py` for recurring or instructive failures.
- Use `docs/agentic/GUIDE_UPDATE_PROTOCOL.md` before promoting lessons into root instructions.

Minimum handoff:

```text
Changed: <files/seams>
Verified: <commands/results>
Not verified: <reason>
Failures/workarounds: <classification + future fix>
Docs/status sync: <updated or not needed>
Next safe slice: <one concrete action>
```

## Commits And Pull Requests

- Commit messages are short, imperative, and sentence case.
- Keep commits scoped to one change set.
- PRs should include a brief summary, linked issues if any, and test results.
- Add screenshots for UI changes.
