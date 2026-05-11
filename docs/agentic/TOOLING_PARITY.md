# Tooling Parity

Purpose: keep Claude and Codex equally strong while letting each use its own best tools.

## Shared Operating Layer

Both runtimes use:

- `docs/Project_Roadmap.md` as active planning truth.
- `autodoc/AGENT_INDEX.md` for fast code-seam orientation.
- `docs/agentic/QUESTION_PROTOCOL.md` to avoid unnecessary user questions.
- `docs/agentic/FAILURE_LEDGER.md` for unresolved or recurring failures.
- `docs/agentic/GUIDE_UPDATE_PROTOCOL.md` for promoting lessons into durable instructions.
- `scripts/agent_hooks/render_failure_ledger.py` to render the failure ledger.

## Claude Code

Claude should use:

- `CLAUDE.md` as the compact root contract.
- `.claude/skills/*/SKILL.md` for lazy-loaded workflows.
- `.claude/settings.json` for conservative permissions and hooks.
- `scripts/agent_hooks/pre_tool_use.py` to block destructive Bash commands.
- `scripts/agent_hooks/post_tool_failure.py` to capture sanitized tool failures.

Claude-specific strengths:

- skill auto-selection from `.claude/skills`
- settings and hook enforcement
- Claude Code tool permission model
- local MCPs only through configured Claude permissions

## Codex

Codex should use:

- `AGENTS.md` as the compact root contract.
- `.agents/skills/*/SKILL.md` for Codex-native workflows.
- `update_plan` for multi-step execution tracking.
- `multi_tool_use.parallel` for independent reads/searches.
- `apply_patch` for manual edits.
- shell verification through npm scripts and targeted commands.
- Playwright/browser tooling for browser-only extension behavior when available.
- `tool_search` for current library, SDK, framework, browser, and API docs when available.
- web verification for unstable current facts, official sources first.

Codex-specific strengths:

- efficient local search and patching
- explicit plan/status updates
- parallel tool calls for file exploration
- targeted shell verification and browser automation
- tool discovery for current docs and integrations

## Parity Rules

- Keep Claude and Codex workflow names aligned where the task class is the same.
- Let runtime-specific tooling differ when that is the stronger path.
- Do not make Claude depend on `.agents` files or Codex depend on `.claude/settings.json`.
- When adding a durable workflow, add or update both runtime skill trees unless the workflow is intentionally runtime-specific.
- When updating safety rules, update root contracts, shared protocols, and runtime-specific guardrails together.
- When a task changes only one runtime, state that explicitly in the handoff.

## Quick Check

Before closing agentic-infrastructure work, verify:

```bash
rg --files .claude/skills .agents/skills docs/agentic autodoc
python -m py_compile scripts/agent_hooks/pre_tool_use.py scripts/agent_hooks/post_tool_failure.py scripts/agent_hooks/render_failure_ledger.py
python scripts/agent_hooks/render_failure_ledger.py
```
