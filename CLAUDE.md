# Claude Operating Contract — NavSentinel

Tier: daily driver (T2) — authority: push free / merge free.
*(Derived from `.claude/tier.json`; do not hand-edit the tier line.)*

Compact session contract for Claude Code in `NavSentinel/`. The global laws in
`~/.claude/CLAUDE.md` apply and are **not** restated here. Repeatable procedures live in
`.claude/skills/*/SKILL.md`, `docs/agentic/*`, and `autodoc/*`.

## Authority Order

1. User prompt for the current turn.
2. `AGENTS.md` — the repo-wide rulebook (review, PR-merge gates, question / failure /
   verification protocols, git workflow). One home; this file links there, never restates.
3. `docs/Project_Roadmap.md` — active phase status, priorities, and gates.
4. `autodoc/AGENT_INDEX.md` — the code-seam map (entry points, invariants, verification).
5. Relevant skill under `.claude/skills/*/SKILL.md`.
6. Deeper docs, archives, and generated artifacts only when the task needs them.

When sources conflict, follow the higher source and report the conflict.

**Standing direction (2026-07-03):** ship/measure, not hardening. Follow the Priority Ladder
and posture in `docs/agentic/DECISIONS.md` — discovery is milestone-gated (LOW residue →
`docs/agentic/ICEBOX.md`), human-gated PRs are capped at 3, and browser-surface is defined by
runtime blast radius (MAIN-world / submit path / service-worker nav / MutationObserver /
visible UI), not file type.

## First 5 Minutes

1. `ACTION_ITEMS.md` — human-owned tasks + current-state snapshot. Surface every OPEN/BLOCKED
   item near the top of every summary or handoff (global law 5); clear items only on Chris's
   explicit confirmation.
2. `AGENTS.md`, `docs/Project_Roadmap.md`, `autodoc/AGENT_INDEX.md`.
3. Select one primary skill and at most one support skill.
4. Identify the smallest safe, reviewable change; state blockers, assumptions, verification
   target, and docs-sync target before editing.

Do not bulk-read archives, generated build output, `node_modules`, or prior artifacts unless
the task requires them.

## Default Work Style

- Prefer narrow diffs over rewrites; preserve existing behavior unless the task asks otherwise.
- Keep extension logic local-first: no runtime network calls, telemetry, credential
  exfiltration, or password-value storage.
- Do not mix navigation-guard, credential-guard, service-worker, and UI work in one slice
  unless the seam requires it.
- Classify every failure (blocker / non-blocking risk / pre-existing noise / invalid signal)
  and record any workaround plus its fix path. No silent skips. See `docs/agentic/FAILURE_LEDGER.md`.

## Git Workflow

Full details, the floor/fixture architecture, dangerous-command explanations, and recovery:
`docs/agentic/GIT_WORKFLOW.md`. The deny floor blocks only the **irreversible**: force-push in
all spellings, `rm -rf` outside the project, pipe-to-shell, `sudo`, secret-file mutation.
Work-loss ops (`reset --hard`, `rebase`, `checkout -- .`) are **allowed at T2**. Convention,
not a gate:

- Update from main with `git merge main` (not rebase); reconcile with `git merge origin/<branch>`.
- Never `git commit --amend` after pushing (make a new commit); never force-push
  `main`/`develop`/`release` — server-side branch protection is the real wall (tracked in
  `ACTION_ITEMS.md` until enabled).
- Before any history-rewriting or work-discarding command, explain plainly what it does and
  whether it is reversible, then wait for approval. When tangled, stop and surface options —
  never silently discard work.

## Skill Routing (Claude)

Orient: `ns-repo-onramp` (vague scope), `ns-repo-map` (find seams), `ns-program-board` (next
slice). Implement: `ns-safe-slice`, `ns-ext-dev` (MV3 runtime), `ns-issue-to-pr`. Verify:
`ns-test-harness`, `ns-threat-validation`, `ns-security-review`, `ns-verify-handoff`. UI:
`ns-ui-ux`. Meta: `ns-question-batch`, `ns-failure-capture`, `ns-interface-map`,
`ns-roadmap-sync`, `ns-human-action-guide`, `ns-claude-tooling`. Codex parity layer: `.agents/skills/*` (see
`docs/agentic/TOOLING_PARITY.md`).

## Project Hot Spots

The seam map (entry points, invariants, verification commands) is `autodoc/AGENT_INDEX.md`.
Highest-risk seams: main-world patching, bridge messages, service-worker lifecycle state, and
credential/data-privacy behavior.

## Shared Protocols (one home)

Review, merge-gate, question, failure, and verification protocols are **not** restated here —
`AGENTS.md` is their home (it carries NavSentinel's T2 tier row), over the global laws in
`~/.claude/CLAUDE.md` (laws 2 and 11) and the agent-harness `BLUEPRINT.md` §1 tier table,
executed by the `review-and-ship` skill. Repo-specific gate: **Gate-3 manual Chrome testing**
is human-owned and tracked in `ACTION_ITEMS.md` (the agent sandbox cannot drive a real
browser) — it holds browser-surface PRs only.

## Local Settings

Committed `.claude/settings.json` holds shared guardrails (acceptEdits + stack allowlist +
deny tripwires + hooks). `.claude/settings.local.json` (gitignored) is machine-specific only;
`bypassPermissions` belongs only in a disposable VM. `.mcp.json` holds credential-free project
MCP defaults — check `/mcp` before claiming a server is connected. After any agentic-tooling
change, run `npm run agent:hooks:smoke` and `npm run agent:skills:validate` before handoff.
