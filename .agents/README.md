# Codex Agent Workflows

This directory mirrors the Claude `.claude/skills` layer in Codex-native form.

Codex reads `AGENTS.md` as the compact root contract, then uses these workflow files as lazy-loaded procedures when a task needs more detail.

Project-local Codex lifecycle hooks live in `.codex/hooks.json`. Its sole
`PreToolUse` adapter pins and invokes the same global irreversible-command floor
Claude receives, with `--runtime codex`; the other handlers provide session
orientation, agentic-change reminders, and sanitized failure capture. Codex
requires the exact hook definitions to be reviewed and trusted through `/hooks`
before they run.

Shared cross-agent protocols live in:

- `docs/agentic/QUESTION_PROTOCOL.md`
- `docs/agentic/FAILURE_LEDGER.md`
- `docs/agentic/GUIDE_UPDATE_PROTOCOL.md`
- `docs/agentic/SKILL_REGISTRY.md`
- `docs/agentic/TOOLING_PARITY.md`
- `autodoc/AGENT_INDEX.md`

Keep `.agents/skills/*/SKILL.md` aligned with `.claude/skills/*/SKILL.md` at the workflow level, but let each runtime use its own best tools.
