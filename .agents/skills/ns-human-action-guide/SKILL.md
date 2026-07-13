---
name: ns-human-action-guide
description: Guide a maintainer through multiple NavSentinel human-owned actions, decisions, blockers, manual checks, or requests such as "guide me through the outstanding tasks". Use ACTION_ITEMS.md as the only durable queue, complete agent-owned prerequisites first, and present one ready q-N action at a time with comprehensive steps.
---

# NavSentinel Human Action Guide

Read `ACTION_ITEMS.md`, `docs/agentic/HANDOFF.md`, and
`docs/agentic/QUESTION_PROTOCOL.md`. Refresh live git, GitHub, browser, store,
security-tool, and legal-source facts when they can drift.

## Workflow

1. Inventory every anchored `OPEN` and `BLOCKED` `AI-N` entry.
2. Classify each entry as agent-resolvable, human decision, human execution,
   blocked on agent preflight, or obsolete but awaiting explicit human closure.
3. Complete safe agent-owned prerequisites without asking the maintainer to do
   them. Keep blocked items visible, but do not make them active questions.
4. Order the ready human actions by dependency and risk. Use stable `AI-N` IDs
   for durable state. Start at `q-1` for a new guided conversation, increment
   `q-N` for each subsequent active action in that conversation, and reset only
   when a new guided conversation begins.
5. Show the whole queue compactly, then present exactly one active
   `q-N [AI-N]` with:
   - context and dependency;
   - a clear recommended action;
   - why human input or execution is required;
   - exact UI paths or commands;
   - expected result and verification;
   - safety, rollback, or fallback notes; and
   - the exact reply phrase that records completion or choice.
6. After the reply, verify the result and re-evaluate dependencies. Never clear
   an item without explicit maintainer confirmation. Move a confirmed item to
   the Completed log, update the cursor in `ACTION_ITEMS.md`, and continue with
   the next ready action.
7. Before pausing, record `Resume at: AI-N` in `ACTION_ITEMS.md`. Do not create a
   second queue, checklist, or state file.

If an external mutation is safe but still needs authority, ask for that
authority and offer to perform and verify it after approval. If the maintainer
chooses not to perform a human-only step, record the fallback and its effect on
the dependent work.

## Output

```text
Queue: READY <AI-N...> | AGENT PREREQUISITE <AI-N...> | BLOCKED <AI-N...>
Resume at: AI-N

q-N [AI-N] - <decision or action>
Context: <why now and what it unlocks>
Recommended: <one clear recommendation>
Human-only because: <authority, UI, credential, legal, or real-browser boundary>
Steps: <complete numbered guide>
Done when: <observable evidence>
Safety/fallback: <risk, rollback, or alternate path>
Reply: <exact confirmation or choice>
```
