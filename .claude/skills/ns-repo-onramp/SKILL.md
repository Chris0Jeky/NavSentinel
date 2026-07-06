---
name: ns-repo-onramp
description: Orient to the NavSentinel repo before editing. Use at session start, when scope is vague, or when entering an unfamiliar extension layer.
user-invocable: true
---

# NavSentinel Repo Onramp

Establish current truth before touching code or docs.

## Read First

1. `autodoc/AGENT_INDEX.md` — the seam map (entry points, invariants, verification, and the
   Do-Not-Read-By-Default index).
2. `docs/agentic/HANDOFF.md` — the latest session handoff (the "now" doc).

`CLAUDE.md` and `AGENTS.md` are auto-loaded every session — do not re-read them. Then, only as
the task needs it (not a mandate): `docs/Project_Roadmap.md` for phase status, or the single
domain doc the seam map names for your change surface (architecture/scoring/testing/threat).

## Produce A Working Summary

Extract only what the task needs:

- likely change surface: content script, shared logic, service worker, popup/options UI, Gym, tests, or docs
- active roadmap phase/task if relevant
- constraints that must not be broken
- narrow verification target
- whether a docs, roadmap, or agent-index sync is needed

## Guardrails

- Trust `docs/Project_Roadmap.md` over archived trackers.
- Do not bulk-read generated output, archives, dumps, or `node_modules`.
- Keep the first implementation slice small and measurable.
- If the task is workflow-only, confirm no extension behavior changed.
