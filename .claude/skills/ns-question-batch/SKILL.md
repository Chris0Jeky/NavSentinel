---
name: ns-question-batch
description: Decide whether a NavSentinel task needs user questions or can proceed with explicit assumptions, minimizing context-window churn.
allowed-tools: Read, Grep, Glob, LS
user-invocable: true
---

# NavSentinel Question Batch

Use when a task is ambiguous, broad, or missing information.

## Workflow

1. Read `docs/agentic/QUESTION_PROTOCOL.md`.
2. Classify each uncertainty:
   - blocker
   - safe assumption
   - reversible preference
   - environment gap
3. Search the repo before asking if the answer is likely in code/docs.
4. Ask at most one compact batch of blocker questions.
5. For non-blockers, proceed with explicit assumptions and record them in the handoff.

## Output

```text
Questions needed: yes/no
Blockers: <only true blockers>
Assumptions: <specific, source-backed assumptions>
Next action: <smallest safe step>
```
