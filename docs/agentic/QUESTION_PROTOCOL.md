# Agent Question Protocol

Purpose: reduce unnecessary back-and-forth while still blocking unsafe or irreversible work.

## Clarification Mode

Use this mode when the agent needs missing information to execute the current
task. Batch all true blockers once; do not drip-feed clarification questions.

## Decision Table

| Uncertainty type | Ask user? | Default action |
| --- | --- | --- |
| Irreversible product choice | Yes | Batch into one concise question. |
| Destructive filesystem, git, package, or release action | Yes | Stop until explicit approval. |
| Missing credential, browser profile, or private token | Yes | Ask for the credential or an alternate verification path; do not invent. |
| Security or privacy boundary ambiguity | Yes | Ask or choose the safer, more restrictive behavior and report the assumption. |
| Extension permission or manifest contract conflict | Usually yes | Check code/docs first; ask only if conflicting. |
| Runtime network behavior | Usually yes | Prefer local-first behavior; ask before adding runtime calls. |
| Reversible UI copy or layout preference | No | Choose the existing UI convention and mark the assumption. |
| Missing local dependency | No, unless blocking | Report environment gap and run a narrower/static check if possible. |
| Broad task scope | No initial ask | Pick a small first slice and proceed unless user requested planning only. |
| Test selection ambiguity | No | Run the narrowest relevant check, then state the coverage gap. |

### Required Question Shape

When a question is needed, ask all blockers at once:

```text
I can proceed after these blockers are resolved:
1. <blocker> - affects <risk/decision>. My default would be <default>.
2. <blocker> - affects <risk/decision>. My default would be <default>.
```

Avoid single-question drip feeds in clarification mode. Each extra message in a
long session increases context pressure.

### Assumption Template

When proceeding without asking:

```text
Assumption: <specific assumption>. Reason: <source or convention>. Reversible by changing <file/setting>.
```

Record important assumptions in the final handoff or the relevant status note.

## Guided Outstanding-Action Mode

Use this mode only when the maintainer explicitly asks to be guided through a
known cumulative queue, or when multiple human-owned `ACTION_ITEMS.md` entries
must be resolved together. This is not clarification drip-feeding: the complete
queue is already known and is being deliberately executed in sequence.

1. Read `ACTION_ITEMS.md` and `docs/agentic/HANDOFF.md`, then refresh live facts.
2. Inventory every current `OPEN` and `BLOCKED` `AI-N` entry and classify its
   owner and prerequisites.
3. Complete safe agent-owned prerequisites first. Do not ask the maintainer to
   test stale branches or perform work that belongs to an agent.
4. Show a compact full-queue summary, but present exactly one ready human action
   as `q-N [AI-N]`.
5. Include context, recommendation, why it is human-only, complete steps,
   expected evidence, safety/rollback, fallback, and an exact reply phrase.
6. Keep `AI-N` as the stable durable identifier. Start at `q-1` for a new
   guided conversation, increment for each subsequent active action in that
   conversation, and reset only when a new guided conversation begins.
7. Clear an item only after explicit maintainer confirmation. Re-verify the
   result, update `ACTION_ITEMS.md`, and continue to the next ready action.
8. Record `Resume at: AI-N` in `ACTION_ITEMS.md` before pausing. Never create a
   parallel task ledger.

Blocked items remain visible in the queue summary but are not active questions
until their agent preflight makes them actionable.
