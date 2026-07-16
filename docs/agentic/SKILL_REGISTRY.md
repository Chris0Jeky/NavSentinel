# Skill Registry

Use one primary skill per task and at most one support skill. Skills are for targeted workflows, not a reason to load the whole repo.

## Runtime Parity

NavSentinel keeps Claude and Codex equally capable through parallel, runtime-native layers:

| Runtime | Root contract | Workflow skills | Runtime guardrails |
| --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` | `.claude/skills/*/SKILL.md` | `.claude/settings.json`, hooks in `scripts/agent_hooks/` |
| Codex | `AGENTS.md` | `.agents/skills/*/SKILL.md` | `.codex/hooks.json`, `AGENTS.md`, Codex tool discipline, shared protocols in `docs/agentic/` |

The workflows should stay aligned in purpose and trigger, but not identical in implementation. Claude should use Claude-native skills/settings/hooks. Codex should use `AGENTS.md`, `update_plan`, parallel native reads/searches when exposed, `apply_patch`, shell verification, Playwright/browser tooling, `tool_search`, and web verification when those tools are available and appropriate.

## Shared Skill Names

| Skill | Trigger | Notes |
| --- | --- | --- |
| `ns-repo-onramp` | Broad or ambiguous repo work | Fast orientation; avoids archive and generated-output over-reading. |
| `ns-repo-map` | Need exact code seam | Use before edits when the target layer is unclear. |
| `ns-safe-slice` | Small implementation or docs change | Keeps scope reviewable. |
| `ns-ext-dev` | MV3 extension runtime behavior | Covers content scripts, service worker, build/reload, and storage lifecycle. |
| `ns-test-harness` | Need proof strategy or tests | Chooses narrow tests before broad E2E. |
| `ns-threat-validation` | Detection efficacy, FP/TP, corpus, Gym, adversarial coverage | Keeps security claims tied to evidence. |
| `ns-security-review` | Bridge, permissions, storage, credentials, network calls, CWS/security posture | Always adversarial. |
| `ns-ui-ux` | Popup, options, onboarding, copy, accessibility | Keeps extension UI compact and task-focused. |
| `ns-verify-handoff` | Before ending meaningful work | Verifies changed seam and states residual risk. |
| `ns-question-batch` | Ambiguous task | Avoids context-expensive question loops. |
| `ns-human-action-guide` | Multiple human-owned actions or an explicit "guide me through the outstanding tasks" request | Uses `ACTION_ITEMS.md` as the only queue and walks one ready `q-N [AI-N]` action at a time. |
| `ns-failure-capture` | Tool, test, dependency, docs, or workaround failure | Records unresolved friction. |
| `ns-interface-map` | Add/split/refactor domain seams | Keeps agent-facing maps current. |
| `ns-roadmap-sync` | Status, roadmap, phase gates, decision log | Updates `docs/Project_Roadmap.md` only when truth changes. |
| `ns-issue-to-pr` | Taking a roadmap issue through implementation | Branch, change, verify, handoff. |
| `ns-program-board` | Next work is unclear | Selects the next unblocked roadmap slice. |
| `ns-claude-tooling` | Claude-specific tool selection | Exists under `.claude/skills`; maps work to Claude Code-native tools. |
| `ns-codex-tooling` | Codex-specific tool selection | Exists under `.agents/skills`; maps work to Codex-native tools. |

## Maintenance

When a skill becomes noisy, split long references into `references/*.md` and scripts into `scripts/*`. Keep `SKILL.md` as the trigger plus workflow skeleton.

When a source-of-truth path changes, update this registry, `CLAUDE.md`, and `autodoc/AGENT_INDEX.md` in the same slice.

When a workflow changes, update both `.claude/skills/<name>/SKILL.md` and `.agents/skills/<name>/SKILL.md` unless the behavior is intentionally runtime-specific. Record intentional differences in `TOOLING_PARITY.md`.
