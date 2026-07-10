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

**Standing direction (2026-07-03):** ship/measure, not hardening. Follow the Priority Ladder and posture in `docs/agentic/DECISIONS.md` — discovery is milestone-gated (LOW residue -> `docs/agentic/ICEBOX.md`), human-gated PRs are capped at 3, and browser-surface is defined by runtime blast radius (MAIN-world / submit path / service-worker nav / MutationObserver / visible UI), not file type.

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

Do not rely on Claude-only `.claude/settings.json` for Codex safety. Codex loads
the project-local `.codex/hooks.json` only after the repository is trusted and
the exact hooks are reviewed through `/hooks`; also apply this file,
`.agents/skills`, and explicit command discipline.

## Default Work Style

- Prefer narrow diffs over rewrites.
- Keep extension logic local-first: no runtime network calls, telemetry, credential exfiltration, or password-value storage.
- Preserve existing behavior unless the task explicitly asks for a behavior change.
- Do not mix navigation-guard, credential-guard, service-worker, and UI work in one slice unless the seam requires it.
- Do not silently ignore failures. Classify them as blocker, non-blocking risk, pre-existing noise, or invalid signal.
- Record any workaround and its future fix path.
- Keep generated summaries short and factual.

## First 5 Minutes

1. Read `ACTION_ITEMS.md` (human-owned tasks + current-state snapshot — see Human Action Items below).
2. Read this `AGENTS.md` if it was not provided in the prompt.
3. Read `docs/Project_Roadmap.md`.
4. Read `autodoc/AGENT_INDEX.md`.
5. Read `CONTRIBUTING.md` or the relevant docs named by the index.
6. When resuming the autonomous loop, read `docs/agentic/HANDOFF.md` and `docs/agentic/ORCHESTRATOR.md`.
7. Select one primary `.agents/skills/*` workflow and at most one support workflow unless the user explicitly asks for broader workflow use.
8. Identify the smallest safe, reviewable change.
9. State blockers, assumptions, verification target, and docs-sync target before editing.

Do not bulk-read `node_modules`, build output, generated data, archive docs, or research dumps unless the task explicitly requires them.

## Human Action Items

`ACTION_ITEMS.md` (repo root) is the running list of tasks only the user (Chris) can do — manual browser testing, merge go/no-go, product decisions — plus a verified current-state snapshot. It exists because some gates (e.g. Gate 3 manual Chrome testing) cannot be cleared from the agent sandbox.

1. Read it at session start (step 1 above).
2. Flag every OPEN / BLOCKED item near the top of any summary, status report, or handoff. Never let an open item go unmentioned.
3. Clear an item only on explicit user confirmation; move it to the Completed log with date + one-line result. Never self-clear.
4. Keep the current-state snapshot accurate when verified truth changes. While `main`'s status docs are stale/conflicted by open PRs, this file plus session memory are the source of truth.
5. When you find a new human-only task, add it as a new `AI-N` item with a step-by-step guide and tell the user.

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
- `.mcp.json` contains credential-free, project-scoped Claude MCP defaults. Verify live MCP status in the active runtime before relying on any server.

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
- `npm run agent:hooks:smoke`: parse and exercise shared Claude hook/MCP guardrails.
- `npm run agent:skills:validate`: validate Claude/Codex local skill metadata and parity.

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

## Review Protocol

When a review is performed on a PR (unless the user explicitly says otherwise):

1. Read existing PR comments (`gh api repos/{owner}/{repo}/pulls/{number}/comments` and `gh pr view {number} --comments`) and address any unresolved feedback before adding new findings.
2. Post a structured comment on the PR with all findings using `gh pr comment`.
3. Act on every finding — both from your review and from existing unaddressed PR comments. Fix all issues regardless of severity tier.
4. Do not skip or defer findings labeled "non-blocking", "minor", or "informational". Every finding must be resolved in the current work or explicitly documented with a seeded follow-up.
5. If a finding drifts genuinely out of scope (different extension layer, unrelated seam, pre-existing tech debt), document it and seed a fix: open a GitHub issue, add a roadmap entry, or append to `docs/agentic/FAILURE_LEDGER.md` with a concrete future-fix path.
6. Tech debt accrual from reviews is not acceptable. "Non-blocking" means "fix it now, not later."

## PR Merge Protocol

Every PR must pass these gates before merge unless the user explicitly changes the gate posture for that PR or batch:

1. **Two independent adversarial review rounds.** Round 1 finds correctness, security, performance, style, test, accessibility, and design issues. Fix everything before Round 2. Round 2 is a fresh attempt to break the updated PR. Fix everything again.
2. **CI and tests green.** Typecheck, lint, build, unit tests, E2E tests, and any seam-specific checks must pass. New code needs corresponding coverage.
3. **Manual behavior check where applicable.** Browser-extension behavior, UI, and real Chrome checks remain human-gated when the sandbox cannot run them. Track these in `ACTION_ITEMS.md`.
4. **Zero tech debt.** No TODO without a linked issue, skipped tests, undocumented workaround, or deferred review finding.
5. **Docs/status sync.** Update `docs/Project_Roadmap.md`, `autodoc/AGENT_INDEX.md`, `docs/agentic/ORCHESTRATOR.md`, `docs/agentic/HANDOFF.md`, or `docs/agentic/failure_ledger.jsonl` only when their truth changed.

## Question, Failure, And Handoff Protocols

- Use `docs/agentic/QUESTION_PROTOCOL.md` before asking for clarification.
- Use `docs/agentic/FAILURE_LEDGER.md` and `scripts/agent_hooks/render_failure_ledger.py` for recurring or instructive failures.
- Use `docs/agentic/GUIDE_UPDATE_PROTOCOL.md` before promoting lessons into root instructions.

Ask only for true blockers: irreversible product decisions, destructive filesystem/git/package/release actions, missing credentials or private tokens, security/privacy boundary ambiguity, extension permission conflicts that cannot be resolved from code/docs, runtime network behavior, or ambiguous acceptance criteria that cannot be inferred. Otherwise proceed with a stated assumption and record it in the handoff.

No finding or failure may be skipped because it is "non-blocking" or "minor." Every finding must be either fixed in the current work or seeded as a concrete follow-up (GitHub issue, roadmap entry, or failure ledger entry with a fix path). Tech debt accrual from skipped findings is not acceptable.

Before final response:

1. Re-read the requested outcome.
2. Verify the exact changed seam.
3. State commands run and results.
4. State what was not verified and why.
5. Update roadmap/status/ledger docs only if their truth changed.

Do not claim tests passed unless they actually ran in the current environment.

Minimum handoff:

```text
Changed: <files/seams>
Verified: <commands/results>
Not verified: <reason>
Failures/workarounds: <classification + future fix>
Review findings: <all addressed | N seeded as issues>
Docs/status sync: <updated or not needed>
Next safe slice: <one concrete action>
```

## Git Workflow

See `docs/agentic/GIT_WORKFLOW.md` for full details and recovery procedures.

### Branch safety tiers

For Claude and Codex, the shared deny floor (`.claude/hooks/dispatch.py`, tier
from `.claude/tier.json`) blocks only the **irreversible**: force-push in all
spellings, `rm -rf` outside the project, pipe-to-shell, `sudo`, secret-file
mutation. Claude wires it through `.claude/settings.json`; Codex wires it
through `.codex/hooks.json`. This remains a tripwire rather than a complete
security boundary, so both runtimes must enforce the same intent by command
discipline. At this tier (T2), work-loss ops (`reset --hard`, `rebase`,
`checkout -- .`) are recoverable from origin and allowed — the rules below are
convention:

- **Never force-push `main`/`master`/`develop`/`release`.** Server-side branch protection is the real wall (tracked in `ACTION_ITEMS.md` until enabled).
- Any history-rewriting or work-discarding command: explain in plain language what it does and whether it is reversible, then wait for user approval before running it.

### Default workflow

- **Update branch from main:** `git merge main` (not rebase).
- **Reconcile divergence:** `git merge origin/<branch>`.
- **Do not amend pushed commits.** Create a new commit instead.
- **Recovery:** `git rebase --abort`, `git merge --abort`, `git stash` are always safe.

### Explain-before-acting rule

Before any command that rewrites history or discards work, you MUST tell the user in plain language: what you want to do, what could go wrong, and whether it is reversible. Wait for approval.

### When tangled

Stop. Explain the situation and options (safest first). Let the user choose. Never silently discard work.

## Commits And Pull Requests

- Commit messages are short, imperative, and sentence case.
- Keep commits scoped to one change set.
- PRs should include a brief summary, linked issues if any, and test results.
- Add screenshots for UI changes.

## Local Settings

`.claude/settings.json` is Claude-only. Codex uses `.codex/hooks.json`, this
file, `.agents/skills/*`, explicit command discipline, and the tools actually
exposed in the current runtime. After adding or changing Codex hooks, review and
trust their current definitions with `/hooks`; changed hook hashes are skipped
until trusted.

Project-scoped MCP defaults live in `.mcp.json` and are credential-free. Verify live MCP/tool availability before relying on any server or authenticated connector.
