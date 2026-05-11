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

## First 5 Minutes

1. Read `AGENTS.md`.
2. Read `docs/Project_Roadmap.md`.
3. Read `autodoc/AGENT_INDEX.md`.
4. Read `CONTRIBUTING.md` or the relevant docs named by the index.
5. Select one primary skill and, at most, one support skill.
6. Identify the smallest safe, reviewable change.
7. State blockers, assumptions, verification target, and docs-sync target before editing.

Do not bulk-read archives, generated build output, large dumps, `node_modules`, or previous artifacts unless the task explicitly requires them.

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

For recurring or instructive failures, append to `docs/agentic/failure_ledger.jsonl` or update `docs/agentic/FAILURE_LEDGER.md`, then promote confirmed lessons through `docs/agentic/GUIDE_UPDATE_PROTOCOL.md`.

## Verification Protocol

Before final response:

1. Re-read the requested outcome.
2. Verify the exact changed seam.
3. State commands run and results.
4. State what was not verified and why.
5. Update roadmap/status/ledger docs only if their truth changed.

Do not claim tests passed unless they actually ran in the current environment.

## Project Hot Spots

- Navigation capture and scoring: `extension/src/content/capture_isolated.ts`, `extension/src/shared/scoring.ts`, `extension/src/shared/nrs.ts`.
- Main-world guard and bridge: `extension/src/content/main_guard.ts`, `extension/src/content/pushstate_guard.ts`, `extension/src/content/dblclick_guard.ts`.
- Credential guard: `extension/src/content/credential_guard.ts`, `extension/src/content/credential_modal.ts`, `extension/src/shared/domain.ts`.
- Service worker state and rollback: `extension/src/sw/sw.ts`, `extension/src/shared/session_state.ts`.
- Reputation and content analysis: `extension/src/shared/reputation.ts`, `extension/src/content/content_analyzer.ts`, `scripts/build-bloom-filter.mjs`.
- Popup/options UI: `extension/src/popup/*`, `extension/src/options/*`.
- Test surfaces: `tests/*.test.ts`, `tests/e2e/*.spec.ts`, `gym/*`.

## Local Settings

Use committed `.claude/settings.json` for shared guardrails. Use `.claude/settings.local.json` only for machine-specific prompts or overrides. Permission bypass mode belongs only in disposable containers or VMs.
