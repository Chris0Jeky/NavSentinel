---
name: ns-question-batch
description: Decide whether a NavSentinel task needs user questions or can proceed with explicit assumptions.
user-invocable: true
---

# NavSentinel Question Batch

Read `docs/agentic/QUESTION_PROTOCOL.md`.

Classify uncertainty as blocker, safe assumption, reversible preference, or environment gap. Search repo docs before asking. Ask one compact batch only for true blockers. Proceed with explicit assumptions otherwise.

Output: questions needed yes/no, blockers, assumptions, and next action.
