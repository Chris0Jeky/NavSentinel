---
name: ns-codex-tooling
description: "Choose Codex-native tools for NavSentinel work: search, parallel reads, patching, planning, verification, browser checks, docs lookup, and safe delegation."
user-invocable: true
---

# NavSentinel Codex Tooling

Use this when the task needs tool choice or workflow discipline.

## Preferred Tool Use

- Search with `rg` or `rg --files`.
- Read independent files with `multi_tool_use.parallel`.
- Track multi-step work with `update_plan`.
- Edit with `apply_patch`.
- Verify with shell commands and npm scripts.
- Use Playwright/browser tooling for browser-only behavior when available.
- Use `tool_search` for current library, SDK, framework, browser, and API docs when available.
- Use web verification for unstable current facts, with official sources first.
- Spawn subagents only when the user explicitly asks for delegation or parallel agent work.

## Safety

- Never use destructive git or filesystem commands without explicit approval.
- Do not rely on Claude settings or hooks to enforce Codex behavior.
- Prefer small patches and targeted verification over broad rewrites.
- Record unresolved failures in the handoff and ledger when recurring or instructive.

## Output

State the tools used, the verification run, and any tool limits or unavailable checks.
