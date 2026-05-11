---
name: ns-roadmap-sync
description: Update NavSentinel roadmap and status docs only when implementation changes their truth.
user-invocable: true
---

# NavSentinel Roadmap Sync

Use when a task changes status, phase gates, decisions, verification evidence, or active planning truth.

## Inputs

- `docs/Project_Roadmap.md`
- `docs/README.md`
- relevant domain doc under `docs/`
- changed files and verification results

## Steps

1. Identify exactly which roadmap row, phase gate, decision, or doc pointer changed.
2. Update the smallest section that became stale.
3. Keep dates and test results concrete.
4. Do not mark a task done without verification evidence.
5. If work only changed local workflow docs, avoid touching product roadmap status.

## Guardrails

- `docs/Project_Roadmap.md` is the active planning doc.
- `docs/archive/*` is historical; do not resurrect it as current state.
- Prefer factual status updates over narrative progress logs.
