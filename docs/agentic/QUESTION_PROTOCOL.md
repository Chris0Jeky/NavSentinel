# Agent Question Protocol

Purpose: reduce unnecessary back-and-forth while still blocking unsafe or irreversible work.

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

## Required Question Shape

When a question is needed, ask all blockers at once:

```text
I can proceed after these blockers are resolved:
1. <blocker> - affects <risk/decision>. My default would be <default>.
2. <blocker> - affects <risk/decision>. My default would be <default>.
```

Avoid single-question drip feeds. Each extra message in a long session increases context pressure.

## Assumption Template

When proceeding without asking:

```text
Assumption: <specific assumption>. Reason: <source or convention>. Reversible by changing <file/setting>.
```

Record important assumptions in the final handoff or the relevant status note.
