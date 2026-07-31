# NavSentinel Codex notes

Read `CLAUDE.md` for the product invariants, code map, focused checks, and the
browser-surface release boundary. This file contains only Codex-specific facts.

## No repository-local harness

Owner decision #499 (2026-07-31) removed `.codex/hooks.json`, the tier
declaration, vendored floor, lifecycle scripts, agent validation, and Harness
CI. A fresh NavSentinel Codex session therefore has no project `PreToolUse`
floor or lifecycle hooks. Do not install, trust, pin, or recreate one without a
new explicit owner request. A session started before the removal may retain its
already-loaded hook definition until restart; that is not fresh-session proof.

## Working map

1. The current user request.
2. `CLAUDE.md` for repository product facts.
3. `autodoc/AGENT_INDEX.md` for code seams and focused checks.
4. `docs/Project_Roadmap.md` and live GitHub state for current work.
5. An optional `.agents/skills/*/SKILL.md` only when it materially helps.

Use `rg`/`rg --files` for discovery, `apply_patch` for edits, and the narrowest
product command that exercises the changed seam. Preserve unrelated worktrees
and generated or user-owned outputs.

`ACTION_ITEMS.md` is the durable queue for human decisions and manual browser
checks. Resume guided queue work by stable `AI-N` identifier; the current cursor
is AI-16. `.mcp.json` is optional credential-free tooling—claim a server only
when it is actually exposed and verified in the current runtime.
