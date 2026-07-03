# Claude Operating Contract - NavSentinel

This is the compact session contract for Claude Code in `NavSentinel/`. Keep it short. Put repeatable procedures in `.claude/skills/*/SKILL.md`, `docs/agentic/*`, or `autodoc/*`.

## Authority Order

1. User prompt for the current turn.
2. `AGENTS.md` for repo-wide operating rules.
3. `docs/Project_Roadmap.md` for active phase status, priorities, and gates.
4. `autodoc/AGENT_INDEX.md` for fast code-seam orientation.
5. Relevant skill under `.claude/skills/*/SKILL.md`.
6. Deeper docs, archives, generated artifacts, and historical material only when the task needs them.

When sources conflict, follow the higher source and report the conflict.

**Standing direction (2026-07-03):** ship/measure, not hardening. Follow the Priority Ladder and posture in `docs/agentic/DECISIONS.md` — discovery is milestone-gated (LOW residue -> `docs/agentic/ICEBOX.md`), human-gated PRs are capped at 3, and browser-surface is defined by runtime blast radius (MAIN-world / submit path / service-worker nav / MutationObserver / visible UI), not file type.

## First 5 Minutes

1. Read `ACTION_ITEMS.md` (human-owned tasks + current-state snapshot — see Human Action Items below).
2. Read `AGENTS.md`.
3. Read `docs/Project_Roadmap.md`.
4. Read `autodoc/AGENT_INDEX.md`.
5. Read `CONTRIBUTING.md` or the relevant docs named by the index.
6. Select one primary skill and, at most, one support skill.
7. Identify the smallest safe, reviewable change.
8. State blockers, assumptions, verification target, and docs-sync target before editing.

Do not bulk-read archives, generated build output, large dumps, `node_modules`, or previous artifacts unless the task explicitly requires them.

## Human Action Items

`ACTION_ITEMS.md` (repo root) is the running list of tasks only the user (Chris) can do — manual browser testing, merge go/no-go, product decisions — plus a verified current-state snapshot for session continuity. It exists because some gates (e.g. Gate 3 manual Chrome testing) cannot be cleared from the agent sandbox.

Rules:

1. **Read it at session start** (it is step 1 of First 5 Minutes).
2. **Flag every OPEN / BLOCKED item** near the top of any summary, status report, handoff, or "where do things stand" answer you give the user. Never let an open item go unmentioned — the user is relying on you so they never forget.
3. **Clear an item only on explicit user confirmation** (e.g. "AI-1 is done"). Move it to the Completed log with the date and a one-line result. Never self-clear or assume completion.
4. **Keep the current-state snapshot accurate** when verified truth changes. While the status docs on `main` are stale/conflicted by open PRs, this file plus persistent memory are the source of truth.
5. When you discover a new human-only task, add it as a new `AI-N` item with a step-by-step guide and tell the user.

## Git Workflow

See `docs/agentic/GIT_WORKFLOW.md` for full details, plain-language explanations, and recovery procedures.

### Branch safety tiers

The pre-tool-use hook enforces branch-aware rules:

- **Protected branches** (`main`, `master`, `develop`, `release`): No rebase, force-push, hard reset, or history rewriting. Always blocked.
- **Other branches** (including agent worktree branches): These operations are allowed but go through the user permission prompt. You must explain what you are doing and the risks before attempting.

### Default workflow

- **Update branch from main:** `git merge main` (not rebase).
- **Reconcile local/remote divergence:** `git merge origin/<branch>`.
- **Do not `git commit --amend` after pushing.** Create a new commit instead.
- **Recovery:** `git rebase --abort`, `git merge --abort`, and `git stash` are always allowed.

### Explain-before-acting rule

Before any git command that rewrites history or discards work (rebase, force-push, reset, clean, checkout --, restore), you MUST:

1. Tell the user what you want to do in plain language — not just the command.
2. Explain what could go wrong and what data could be lost.
3. State whether this is reversible and how.
4. Wait for the user to approve via the permission prompt.

### When you get tangled

If you end up with diverged branches, unresolvable conflicts, or detached HEAD:

1. **Stop.** Do not attempt destructive recovery without explaining the situation.
2. Tell the user: what happened, what state you are in, what options exist (safest first).
3. Let the user choose. Never silently discard work to get unstuck.

## Default Work Style

- Prefer narrow diffs over rewrites.
- Keep extension logic local-first: no runtime network calls, telemetry, credential exfiltration, or password-value storage.
- Preserve existing behavior unless the task explicitly asks for a behavior change.
- Do not mix navigation-guard, credential-guard, service-worker, and UI work in the same slice unless the seam requires it.
- Do not silently ignore failures. Classify them as blocker, non-blocking risk, pre-existing noise, or invalid signal.
- When using a workaround, record the workaround and the future fix path.
- Keep generated summaries short and factual.

## Skill Routing

Use these Claude skills when relevant:

- `ns-repo-onramp`: broad or ambiguous repo work.
- `ns-repo-map`: find exact code seams before editing.
- `ns-safe-slice`: implement a small reviewable change.
- `ns-ext-dev`: extension runtime behavior, MV3 wiring, build/reload implications.
- `ns-test-harness`: choose or add unit, E2E, corpus, stress, or Gym verification.
- `ns-threat-validation`: detection, false-positive, true-positive, corpus, and adversarial coverage.
- `ns-security-review`: bridge, permissions, storage, credentials, data isolation, and remote-call risk.
- `ns-ui-ux`: popup, options, onboarding, risk-copy, and accessibility work.
- `ns-question-batch`: decide whether to ask, assume, or proceed.
- `ns-failure-capture`: classify failures and record recurring lessons.
- `ns-interface-map`: update `autodoc/AGENT_INDEX.md` or domain agent interfaces.
- `ns-roadmap-sync`: update roadmap/status docs when their truth changes.
- `ns-issue-to-pr`: take a roadmap issue through branch, implementation, verification, and handoff.
- `ns-program-board`: pick the next unblocked roadmap slice when the next task is unclear.
- `ns-claude-tooling`: Claude-specific tool selection and safety.
- `ns-verify-handoff`: final verification and handoff discipline.

Codex has a matching workflow layer under `.agents/skills/*/SKILL.md`. Keep workflow intent aligned across both runtimes, but let each runtime use its native tools and guardrails. See `docs/agentic/TOOLING_PARITY.md`.

## Question Protocol

Do not ask questions just because something is uncertain.

Ask only when the uncertainty is a true blocker: irreversible product decision, missing credential, destructive action, security boundary, public contract conflict, or ambiguous acceptance criterion that cannot be inferred from code/docs.

Otherwise proceed with a stated assumption and record it in the handoff. Batch blocker questions into one compact message. See `docs/agentic/QUESTION_PROTOCOL.md`.

## Failure Protocol

Every failed command, missing dependency, tool denial, flaky test, docs-control warning, or workaround must appear in the final handoff if unresolved.

No finding or failure may be skipped because it is "non-blocking" or "minor." Every finding must be either fixed in the current work or seeded as a concrete follow-up (GitHub issue, roadmap entry, or failure ledger entry with a fix path). Tech debt accrual from skipped findings is not acceptable.

For recurring or instructive failures, append to `docs/agentic/failure_ledger.jsonl` or update `docs/agentic/FAILURE_LEDGER.md`, then promote confirmed lessons through `docs/agentic/GUIDE_UPDATE_PROTOCOL.md`.

## Review Protocol

When a review is performed on a PR (unless the user explicitly says otherwise):

1. Read existing PR comments (`gh api repos/{owner}/{repo}/pulls/{number}/comments` and `gh pr view {number} --comments`) and address any unresolved feedback before adding new findings.
2. Post a structured comment on the PR with all findings using `gh pr comment`.
3. Act on every finding — both from your review and from existing unaddressed PR comments. Fix all issues regardless of severity tier.
4. Do not skip or defer findings labeled "non-blocking", "minor", or "informational". Every finding must be resolved in the current work or explicitly documented with a seeded follow-up.
5. If a finding drifts genuinely out of scope (different extension layer, unrelated seam, pre-existing tech debt), document it and seed a fix: open a GitHub issue, add a roadmap entry, or append to `docs/agentic/FAILURE_LEDGER.md` with a concrete future-fix path.
6. Tech debt accrual from reviews is not acceptable. "Non-blocking" means "fix it now, not later."

## PR Merge Protocol

Every PR must pass the following gates before merge. No exceptions.

### Gate 1: Two Adversarial Review Rounds

Each PR receives **two independent adversarial review rounds**:

1. **Round 1** — Initial structured review covering: correctness, security, performance, style, test coverage, accessibility, and design adherence. All findings must be fixed before Round 2.
2. **Round 2** — Fresh adversarial review of the updated PR. Reviewers actively try to break the implementation: edge cases, race conditions, state corruption, visual regressions, and interaction failures. All findings must be fixed.

Between rounds, all bot comments (CI bots, linters, type-checkers) must be checked and addressed.

### Gate 2: CI and Tests

- All CI checks green (typecheck, lint, build).
- All unit tests passing (`npm run test`).
- All E2E tests passing (`npm run test:e2e`).
- No new test failures introduced.
- New code has corresponding test coverage.

### Gate 3: Manual Testing

- Feature tested manually in a real Chrome browser with the extension loaded.
- Golden path verified (primary user flow works end-to-end).
- Edge cases tested (empty states, overflow, rapid interactions, error states).
- No regressions in adjacent features.
- Visual output matches design spec (for UI PRs).

### Gate 4: Zero Tech Debt

- No TODO comments without a linked GitHub issue.
- No workarounds without documented fix paths.
- No skipped tests or disabled checks.
- No "we'll fix this later" deferrals — fix now or seed a concrete follow-up.
- Every finding from reviews is either resolved or has a seeded GitHub issue with a fix path.

### Gate 5: Documentation Sync

- Roadmap updated if phase status changed.
- AGENT_INDEX.md updated if public interfaces changed.
- Failure ledger updated if new recurring issues discovered.
- Design docs updated if implementation diverged from spec.

## Verification Protocol

Before final response:

1. Re-read the requested outcome.
2. Verify the exact changed seam.
3. State commands run and results.
4. State what was not verified and why.
5. Update roadmap/status/ledger docs only if their truth changed.

Do not claim tests passed unless they actually ran in the current environment.

## Project Hot Spots

- Navigation capture and scoring: `extension/src/content/capture_isolated.ts`, `extension/src/shared/scoring.ts`, `extension/src/shared/nrs.ts`, `extension/src/shared/nav_anomaly.ts`, `extension/src/shared/adaptive_scoring.ts`.
- Main-world guard and bridge: `extension/src/content/main_guard.ts`, `extension/src/content/pushstate_guard.ts`, `extension/src/content/dblclick_guard.ts`, `extension/src/content/clickfix_detector.ts`, `extension/src/content/mutation_monitor.ts`.
- Credential guard: `extension/src/content/credential_guard.ts`, `extension/src/content/credential_modal.ts`, `extension/src/shared/domain.ts`, `extension/src/shared/allowlist.ts`.
- Service worker state and rollback: `extension/src/sw/sw.ts`, `extension/src/shared/session_state.ts`, `extension/src/sw/icon_manager.ts`.
- Reputation and content analysis: `extension/src/shared/reputation.ts`, `extension/src/content/content_analyzer.ts`, `extension/src/shared/domain_profile.ts`, `extension/src/content/sri_checker.ts`, `extension/src/content/csp_analyzer.ts`.
- Popup/options UI: `extension/src/popup/*`, `extension/src/options/*`, `extension/src/onboarding/*`.
- Shared helpers: `extension/src/shared/explanations.ts`, `extension/src/shared/event_tone.ts`, `extension/src/shared/smart_defaults.ts`, `extension/src/shared/domain_groups.ts`.
- Test surfaces: `tests/*.test.ts` (92 files), `tests/e2e/*.spec.ts` (14 files), `gym/*` (123 files: 122 fixtures + `index.html` launcher).

## Local Settings

Use committed `.claude/settings.json` for shared guardrails. Use `.claude/settings.local.json` only for machine-specific prompts or overrides. Permission bypass mode belongs only in disposable containers or VMs.

Project-scoped MCP defaults live in `.mcp.json` and are credential-free. Check `/mcp` in the active Claude runtime before claiming a server is connected or using remote/authenticated MCP capabilities.
