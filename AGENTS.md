# Codex Operating Contract — NavSentinel

Tier: daily driver (T2) — authority: push free / merge gated.
*(Derived from `.claude/tier.json`; do not hand-edit the tier line.)*

Compact Codex contract for `NavSentinel/`. The global source of truth is
`~/.claude/CLAUDE.md`; its essential laws are mirrored below because Codex does
not load that file. Keep the two in sync. Repeatable procedures belong in
`.agents/skills/*/SKILL.md`, `docs/agentic/*`, and `autodoc/*`.

## Global Laws (Codex mirror)

1. Never merge a PR with failing CI. Investigate every failure; never dismiss it as flaky.
2. Reviews are zero-skip: inspect and post findings, fix every severity, address all existing
   comments including bots, and map each fix to evidence. Seed genuinely out-of-scope findings.
3. Never claim done or verified without the proving command/check. State what was not verified
   and close with changed / verified / not verified / residual risk.
4. Check GitHub issue links after PR-body edits: a close keyword fires even when quoted or
   negated. Never delete a stacked base branch; merge stacks oldest-first.
5. Surface the declared human-action file in every summary. Only Chris clears its items. For a
   cumulative queue, use `ns-human-action-guide` and stable `AI-N` IDs.
6. Batch true blockers into one question. Otherwise proceed with a named, reversible assumption.
7. Make the worktree guard preamble the first repository action. Use project-directory paths;
   create worktrees with `--detach origin/main`, never branch refs; leave `main` clean after waves.
8. Add structure only after the second recurrence. Promote recurring lessons to the cheapest
   effective layer (memory → contract → skill/doc → hook → CI → structure), then remove the old copy.
9. Before unfamiliar-repo work, check `~/.claude/ESTATE.md` and `.claude/tier.json`; authority is
   declared, not negotiated.
10. If not the top routed model, do not merge, edit canonical docs, the deny floor, or gates.

Commit small, logical increments as work proceeds. Start inline; use a small number of agents
only when the prompt or an applicable skill requests delegation, the work is disjoint, or an
independent lens materially helps. Do not add `Co-Authored-By` or generated-by trailers.

## Authority Order

1. User prompt for the current turn.
2. This file — Codex-specific operating rules and repo protocols.
3. `docs/Project_Roadmap.md` — active phase status, priorities, and gates.
4. `autodoc/AGENT_INDEX.md` — code seams, invariants, and verification.
5. Relevant `.agents/skills/*/SKILL.md` workflow.
6. Deeper docs, archives, generated artifacts, and historical material only when needed.

When sources conflict, follow the higher source and report the conflict.

**Standing direction (2026-07-03):** ship/measure, not hardening. Follow the
Priority Ladder and posture in `docs/agentic/DECISIONS.md`: discovery is
milestone-gated (LOW residue → `docs/agentic/ICEBOX.md`), human-gated PRs are
capped at 3, and browser surface is defined by runtime blast radius rather than
file type.

## First 5 Minutes

1. Read `ACTION_ITEMS.md`; surface every current OPEN or BLOCKED item in summaries. Clear an
   item only after Chris explicitly confirms it.
2. Read this file, `CLAUDE.md`, `docs/Project_Roadmap.md`, and `autodoc/AGENT_INDEX.md`.
3. For autonomous-loop resumption, also read `docs/agentic/HANDOFF.md` and
   `docs/agentic/ORCHESTRATOR.md`.
4. Select one primary skill and at most one support skill.
5. Identify the smallest safe, reviewable change and state blockers, assumptions, verification,
   and docs-sync targets before editing.

Do not bulk-read `node_modules`, generated output, archives, research dumps, or prior artifacts
unless the task requires them.

## Codex Tooling And Settings

- Search with `rg` / `rg --files`; parallelize independent reads or searches when the active
  Codex surface exposes a safe native facility.
- Use `update_plan` for multi-step work, `apply_patch` for manual edits, and shell commands for
  concrete verification. Use browser tooling for browser-only behavior when available.
- Use the active docs integration or official sources for unstable framework, API, or product
  facts. Do not claim an MCP or connector is live unless it was verified in this runtime.
- Project-local hooks live in `.codex/hooks.json`. They load only after the project is trusted;
  inspect and trust each exact definition with `/hooks`. A changed definition must be trusted
  again. The hooks run the shared irreversible-command floor, session orientation, agentic-change
  reminder, and sanitized failure capture; they do not inherit Claude's settings or permissions.
- `.mcp.json` is credential-free project configuration. Use only tools actually exposed in the
  active Codex session.
- After changing agentic tooling, run `npm run agent:hooks:smoke` and
  `npm run agent:skills:validate` before handoff.

## Default Work Style And Security

- Prefer narrow diffs; preserve behavior unless the request changes it.
- Keep extension behavior local-first: no runtime network calls, telemetry, credential
  exfiltration, or password-value storage.
- Do not mix navigation-guard, credential-guard, service-worker, and UI work in one slice unless
  the seam requires it. Do not edit `extension/dist/`.
- For MV3 work, persist short-lived critical state in `chrome.storage.session` where appropriate;
  make MAIN-world patches narrow and bridge-validated; run content scripts in all required frames.
- Classify every failure as blocker, non-blocking risk, pre-existing noise, or invalid signal.
  Record unresolved workarounds and their fix path; never silently skip a failure or finding.

## Human Action Queue

`ACTION_ITEMS.md` is the only durable queue for Chris-owned decisions, manual browser testing,
merge go/no-go, and its verified current-state snapshot.

- Add a new `AI-N` item with a complete human guide when a new human-only action appears.
- Never self-clear an item. Keep `docs/agentic/HANDOFF.md` consistent when verified status changes.
- When Chris asks to work through cumulative actions, use `ns-human-action-guide`: complete
  safe agent prerequisites, show the whole queue compactly, and present exactly one ready
  `q-N [AI-N]` action. Resume by the stable `AI-N`, not a transient q-number.

Current queue: OPEN AI-19, AI-16, AI-17, AI-9, AI-20, AI-13, AI-21, AI-22, AI-23;
HELD AI-18 (blocked on PR #457's final head — trust is definition-hash-based);
BLOCKED AI-15, AI-8, AI-14. Resume at AI-16.
AI-13/AI-21/AI-22 are conditional Gate-3 lanes, run oldest-PR-first
(#356 -> #464 -> #466); their guides are in `docs/agentic/GATE3_GUIDES.md`.

## Project Map And Commands

- `extension/src/content/`, `extension/src/shared/`, `extension/src/sw/`, `extension/src/popup/`,
  and `extension/src/options/` contain the MV3 source. `gym/` and `tests/e2e/` cover browser
  behavior. `docs/` contains plans and protocols. `extension/dist/` is generated output.
- Core commands: `npm run typecheck`, `npm run build`, `npm run test`, `npm run test:e2e`,
  `npm run test:e2e:smoke`, `npm run test:e2e:regression`, `npm run test:e2e:rollback`,
  `npm run test:e2e:stress`, `npm run test:e2e:corpus`, `npm run gym:serve`,
  `npm run verify:versions`, and `npm run package:ext`.
- Use `autodoc/AGENT_INDEX.md` for exact entry points and seam-specific checks. Highest-risk
  seams are MAIN-world patching, bridge messages, service-worker lifecycle state, and
  credential/privacy behavior.

## Skill Routing

Orient with `ns-repo-onramp`, `ns-repo-map`, or `ns-program-board`. Implement with
`ns-safe-slice`, `ns-ext-dev`, or `ns-issue-to-pr`. Verify with `ns-test-harness`,
`ns-threat-validation`, `ns-security-review`, or `ns-verify-handoff`. Use `ns-ui-ux` for
interface work. Meta workflows are `ns-question-batch`, `ns-human-action-guide`,
`ns-failure-capture`, `ns-interface-map`, `ns-roadmap-sync`, and `ns-codex-tooling`.

Keep matching Claude and Codex workflow names aligned, but use each runtime's native tools.
See `docs/agentic/TOOLING_PARITY.md`.

## Reviews, Merge Gates, And Handoff

For a PR review, first inspect all existing PR comments and unresolved threads. Post structured
findings, fix every finding regardless of severity, and seed a concrete GitHub issue, roadmap
entry, or failure-ledger record only when a finding is genuinely out of scope. For local-only
work, record each independent review round, its lens, findings, and resolutions in a handoff or
small review artifact.

Do not merge unless the exact reviewed head has:

1. Two independent adversarial review rounds, with all findings fixed between and after them.
2. Green relevant CI and tests: typecheck, lint, build, unit, E2E, and seam-specific checks.
3. Human Gate-3 manual Chrome verification for browser-surface work when the sandbox cannot do it;
   track that need in `ACTION_ITEMS.md`.
4. No untracked tech debt, skipped tests, or undocumented workaround.
5. Docs/status synchronization only where truth changed.

Use `docs/agentic/QUESTION_PROTOCOL.md`, `FAILURE_LEDGER.md`, and
`GUIDE_UPDATE_PROTOCOL.md` for their respective workflows. Before handoff, re-read the requested
outcome, verify the exact seam, state commands/results and what was not verified, and update
status docs only when truth changed. Do not claim a test passed unless it ran here.

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

## Git Discipline

See `docs/agentic/GIT_WORKFLOW.md` for recovery details. The shared irreversible-command floor
lives at `~/.claude/hooks/dispatch.py` (tier from `.claude/tier.json`): Claude receives it
globally, and Codex's sole project `PreToolUse` adapter in `.codex/hooks.json` pins the same
dispatcher with `--runtime codex`. Repo-local `.claude/hooks/*` files are exact CI/audit
fixtures, not a second active hook. The floor blocks only irreversible operations: force-push,
`rm -rf` outside the project, pipe-to-shell, `sudo`, and secret-file mutation. At T2, work-loss
commands remain recoverable from origin but require the discipline below.

- Update from `main` with `git merge main`; reconcile with `git merge origin/<branch>`.
- Do not amend pushed commits; create a new commit. Never force-push `main`, `master`, `develop`,
  or `release`; server-side protection remains AI-17.
- Before a history-rewriting or work-discarding command, explain what it does, what could be
  lost, and how it is reversible, then wait for approval. If branches are tangled, stop and give
  safest-first options; never discard work silently.

## Documentation Ownership

Update `docs/Project_Roadmap.md`, `autodoc/AGENT_INDEX.md`,
`docs/agentic/ORCHESTRATOR.md`, `docs/agentic/HANDOFF.md`, or the failure ledger only when the
implementation changes their truth. `ACTION_ITEMS.md` remains human-owned; agents may add or
refresh items but never mark them complete without Chris's explicit confirmation.
