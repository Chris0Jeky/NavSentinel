---
name: ns-repo-onramp
description: Orient to the NavSentinel repo before editing. Use at session start, when scope is vague, or when entering an unfamiliar extension layer.
user-invocable: true
---

# NavSentinel Repo Onramp

Establish current truth before touching code or docs.

## Read First

1. `CLAUDE.md`
2. `AGENTS.md`
3. `autodoc/AGENT_INDEX.md`
4. `docs/Project_Roadmap.md`
5. `CONTRIBUTING.md`
6. `docs/README.md` when deeper orientation is needed

Read when relevant:

- `docs/Architecture_and_Data_Flow.md` for runtime layers, bridge, or service worker work
- `docs/Intent_Model_and_Scoring.md` for CDS, NRS, or credential-risk heuristics
- `docs/Testing_and_Gym.md` for test surfaces, Gym coverage, and local/CI lanes
- `docs/Real_World_Adversarial_Program.md` for adversarial scenario design
- `docs/Threat_Model_and_Cases.md` for threat-model changes
- `docs/agentic/QUESTION_PROTOCOL.md` when scope or acceptance criteria are ambiguous

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
