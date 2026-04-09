---
name: ns-repo-onramp
description: Orient to the NavSentinel repo before editing. Use at session start, when scope is vague, or when entering an unfamiliar extension layer.
user-invocable: true
---

# NavSentinel Repo Onramp

Establish current truth before touching code or docs.

## Read first

1. `CLAUDE.md`
2. `AGENTS.md`
3. `CONTRIBUTING.md` for change-surface guidance
4. `docs/Execution_Tracker.md` for the active batch plan and what is in progress

Read when relevant:

- `docs/Architecture_and_Data_Flow.md` when touching runtime layers, bridge, or service worker
- `docs/Intent_Model_and_Scoring.md` when touching CDS or credential-risk heuristics
- `docs/Testing_and_Gym.md` when adding tests or Gym fixtures
- `docs/Real_World_Adversarial_Program.md` when adding adversarial scenarios

## Produce a working summary

Extract only what the task needs:

- likely change surface (content scripts, shared logic, popup/options UI, service worker, Gym, tests)
- current constraints from `AGENTS.md`
- whether the Execution Tracker batch plan is relevant
- whether the change requires a build/reload cycle

## Guardrails

- trust `AGENTS.md` and `docs/Execution_Tracker.md` as the active planning docs
- do not create parallel planning files or control-plane trees
- keep the first implementation slice small and measurable