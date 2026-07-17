---
name: ns-claude-tooling
description: Choose Claude Code-native tools for NavSentinel work: skills, permissions, hooks, safe Bash, MCP access, verification, and failure capture.
user-invocable: true
---

# NavSentinel Claude Tooling

Use this when the task needs Claude Code-specific tool choice or guardrail discipline.

## Preferred Tool Use

- Use this repo's `.claude/skills/*/SKILL.md` workflows as lazy-loaded procedures.
- Use `.claude/settings.json` permissions and hooks as the shared safety baseline.
- Search with Grep/Glob/LS/Read first, then Bash `rg` when useful.
- Use safe Bash commands for concrete verification.
- Use hook-backed failure capture for failed Bash/Edit/Write/MCP operations.
- Use MCP tools only when they are configured, scoped, and relevant to the task.
- Keep local overrides in `.claude/settings.local.json`, not in the shared settings file.

## Safety

- Do not rely on Codex-only `.agents` workflow files for Claude behavior.
- Let the shared `.claude/hooks/dispatch.py` deny floor block irreversible commands.
- Treat hook denials as signal, not friction to bypass.
- Record unresolved failures in the handoff and ledger when recurring or instructive.

## Output

State the Claude-specific workflow used, verification run, and any hook/tool limits.
