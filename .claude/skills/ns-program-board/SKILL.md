---
name: ns-program-board
description: Pick the next unblocked NavSentinel roadmap slice and keep the diff aligned to a small reviewable task.
user-invocable: true
---

# NavSentinel Program Board

Use when the next task is unclear or the user asks what to do next.

## Workflow

1. Read the status snapshot and current phase in `docs/Project_Roadmap.md`.
2. Prefer tasks that unblock the current phase gate before future-phase work.
3. Cross-check active operational docs:
   - `docs/Real_World_Adversarial_Program.md`
   - `docs/Testing_Expansion_Strategy.md`
   - `docs/Demo_Showcase_Plan.md`
4. Pick one small unblocked slice.
5. State why it is next, what files are likely involved, and what verification will prove it.

## Guardrails

- Do not mark roadmap status changed without implementation and verification evidence.
- Do not create a parallel task tracker.
- Keep product claims tied to tests and measurement.
