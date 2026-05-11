---
name: ns-failure-capture
description: Classify and record tool, test, dependency, docs, browser, and workaround failures without letting agents fail silently.
allowed-tools: Read, Grep, Glob, LS, Bash, Edit, Write
user-invocable: true
---

# NavSentinel Failure Capture

Use whenever a command, tool, check, dependency, browser run, or workaround fails.

## Workflow

1. Name the failure surface: command, tool, dependency, browser, docs, test, CI, permissions, or code.
2. Classify it:
   - `blocker`
   - `non_blocking_risk`
   - `pre_existing_noise`
   - `invalid_signal`
3. Decide whether work can continue and why.
4. If recurring or instructive, append a JSONL entry to `docs/agentic/failure_ledger.jsonl` or update `docs/agentic/FAILURE_LEDGER.md`.
5. If it should affect future behavior, propose a candidate guide update using `docs/agentic/GUIDE_UPDATE_PROTOCOL.md`.

## Required Final-Handoff Text

```text
Failure/workaround: <what failed>
Classification: <class>
Impact: <scope/confidence/verification impact>
Workaround: <what was done>
Future fix: <file/task/doc path>
```
