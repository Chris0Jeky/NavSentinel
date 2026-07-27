# NavSentinel — Codex contract (delta over CLAUDE.md)

**Read `CLAUDE.md` first.** It is this repo's shared canon: what NavSentinel is, the first
actions, the proving-check table per change class, the CI job order, the repo pitfalls, the
Gate-3 rule, the skill list, and the settings/hook layout. None of that is repeated here — this
file carries only what differs for Codex, because duplicating it is what grew this file to 177
lines and let it drift.

Tier: **T2 daily driver** — push free / merge free (`.agent-harness/tier.json`; do not hand-edit
the tier line).

## Global laws (one home)

The twelve global laws live in `~/.claude/CLAUDE.md`, and the tier ladder in the sibling
agent-harness checkout's `BLUEPRINT.md` §1. Both are plain Markdown on disk. Claude receives them
automatically; **Codex does not** — open both at session start. They are not mirrored here
(agent-harness #101 deleted the mirror that had drifted).

## Authority order

1. User prompt for the current turn.
2. `CLAUDE.md` (shared repo canon), then this file for Codex-specific rules.
3. `docs/Project_Roadmap.md` — active phase, priorities, gates.
4. `autodoc/AGENT_INDEX.md` — code seams, invariants, verification.
5. The relevant `.agents/skills/*/SKILL.md`.
6. Deeper docs, archives, and generated artifacts only when the task needs them.

On conflict, follow the higher source and report the conflict. For autonomous-loop resumption
also read `docs/agentic/HANDOFF.md` and `docs/agentic/ORCHESTRATOR.md`.

## Codex tooling

- Search with `rg` / `rg --files`; parallelize independent reads or searches when the active
  surface exposes a safe native facility.
- `update_plan` for multi-step work, `apply_patch` for edits, shell commands for verification,
  browser tooling for browser-only behavior when available.
- Project hooks are `.codex/hooks.json`. They load only after the project is trusted — inspect
  and trust each exact definition with `/hooks`, and re-trust after any change (trust is
  definition-hash based). The sole `PreToolUse` adapter pins the global
  `~/.claude/hooks/dispatch.py` with `--runtime codex`; Codex inherits none of Claude's settings
  or permissions. Do not edit the floor, its pins, or `.claude/hooks/*`.
- `.mcp.json` is credential-free project config. Use only the tools actually exposed in this
  session; never claim a connector or MCP server is live unless it was verified in this runtime.
## Skills (`.agents/skills/`)

The same `ns-*` set as Claude, minus `ns-claude-tooling` and plus `ns-codex-tooling`. Keep
matching workflow names aligned but implement each in its runtime's native tools —
`scripts/agent_hooks/validate_skills.py` (`npm run agent:skills:validate`) fails on name drift, so
add or rename in both trees. Policy: `docs/agentic/TOOLING_PARITY.md`.

## Human action queue

`ACTION_ITEMS.md` is the only durable queue for Chris-owned decisions, manual browser testing, and
merge go/no-go, plus its verified current-state snapshot.

- Add a new `AI-N` item with a complete human guide whenever a new human-only action appears.
- Never self-clear an item; keep `docs/agentic/HANDOFF.md` consistent when verified status changes.
- When Chris asks to work the queue, use `ns-human-action-guide`: finish the safe agent
  prerequisites, show the queue compactly, present exactly one ready `q-N [AI-N]` action, and
  resume by the stable `AI-N`, never a transient q-number.

## Handoff shape

Verify the exact seam, then state the commands, their results, and what was NOT verified. Do not
claim a test passed unless it ran here. Update `docs/Project_Roadmap.md`,
`autodoc/AGENT_INDEX.md`, `docs/agentic/ORCHESTRATOR.md`, `docs/agentic/HANDOFF.md`, or the
failure ledger only when the implementation changed their truth.

```text
Changed: <files/seams>
Verified: <commands/results>
Not verified: <reason>
Failures/workarounds: <classification + fix path>
Docs/status sync: <updated or not needed>
Next safe slice: <one concrete action>
```

Protocols: `docs/agentic/QUESTION_PROTOCOL.md`, `FAILURE_LEDGER.md`, `GUIDE_UPDATE_PROTOCOL.md`,
`GIT_WORKFLOW.md`.
