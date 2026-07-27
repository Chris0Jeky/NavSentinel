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

## MCP Baseline

The committed project MCP baseline is `.mcp.json`. It is intentionally credential-free and uses Windows-safe `cmd /c npx` stdio launches for local utility servers:

- `context7`: current library and framework docs.
- `playwright`: browser automation when a runtime exposes MCP tools.
- `ripgrep`: search helper for runtimes that use MCP search.

Do not commit authenticated GitHub, Docker Desktop gateway, OpenAI docs, or private remote MCP credentials. Keep those in user/runtime config and verify them in the active runtime before claiming availability. For Claude, use `/mcp`. For Codex, use the actually exposed tools, `tool_search`, or a direct tool call. Dependency checks that work in PowerShell:

```powershell
cmd /c npx --version
docker --version
gh --version
```

## Claude Code

Claude should use:

- `CLAUDE.md` as the compact root contract.
- `.claude/skills/*/SKILL.md` for lazy-loaded workflows.
- `.claude/settings.json` for conservative permissions and repo-specific
  lifecycle hooks; the irreversible floor arrives once from Claude's global hook.
- `~/.claude/hooks/dispatch.py` for the canonical shared deny floor.
- `scripts/agent_hooks/post_tool_failure.py` to capture sanitized tool failures to the gitignored raw autolog (`docs/agentic/failure_autolog.jsonl`), keeping the curated `failure_ledger.jsonl` clean.

Claude-specific strengths:

- skill auto-selection from `.claude/skills`
- settings and hook enforcement
- Claude Code tool permission model
- local MCPs only through configured Claude permissions

## Codex

Codex should use:

- `CLAUDE.md` as the shared repo canon, plus `AGENTS.md` as the Codex delta over it.
- `.agents/skills/*/SKILL.md` for Codex-native workflows.
- `update_plan` for multi-step execution tracking.
- parallel native reads/searches when the active Codex surface exposes them.
- `apply_patch` for manual edits.
- shell verification through npm scripts and targeted commands.
- Playwright/browser tooling for browser-only extension behavior when available.
- `tool_search` for current library, SDK, framework, browser, and API docs when available.
- web verification for unstable current facts, official sources first.
- `.codex/hooks.json` for project-local lifecycle wiring after reviewing and
  trusting the definitions with `/hooks`.
- one pinned adapter to the shared global irreversible-command floor, plus
  session orientation, agentic-change reminders, and sanitized failure capture.

Codex project-local configuration and hooks load only after the project is
trusted. Hook trust is definition-hash-based: review/trust the exact current
definitions through `/hooks` again after a hook change.

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
- The canonical irreversible-command floor lives at
  `~/.claude/hooks/dispatch.py`: Claude receives it globally, and Codex's sole
  project `PreToolUse` adapter pins the same bytes and passes `--runtime codex`.
  Repo-local `.claude/hooks/*` files are exact CI/audit fixtures, not runtime
  duplicates; Codex does not depend on Claude's settings or permission model.
- When adding a durable workflow, add or update both runtime skill trees unless the workflow is intentionally runtime-specific.
- When updating safety rules, update root contracts, shared protocols, and runtime-specific guardrails together.
- When a task changes only one runtime, state that explicitly in the handoff.

## Quick Check

Before closing agentic-infrastructure work, verify:

```bash
rg --files .claude/skills .agents/skills docs/agentic autodoc
python -m py_compile .claude/hooks/dispatch.py .claude/hooks/smoke_test.py scripts/agent_hooks/post_tool_use.py scripts/agent_hooks/post_tool_failure.py scripts/agent_hooks/session_start.py scripts/agent_hooks/render_failure_ledger.py scripts/agent_hooks/smoke_test.py scripts/agent_hooks/validate_skills.py
npm run agent:hooks:smoke
npm run agent:skills:validate
python scripts/agent_hooks/render_failure_ledger.py
```
