---
name: ns-verify-handoff
description: Close a NavSentinel task by verifying the changed seam, stating residual risk, and syncing docs only when truth changed.
user-invocable: true
---

# NavSentinel Verify Handoff

Re-read the requested outcome, verify the exact changed seam, state commands and results, and state what was not verified.

Sync roadmap, testing docs, architecture docs, scoring docs, agent index, or failure ledger only when truth changed.

Call out manifest/permission changes, injection/world changes, storage migrations, service-worker lifecycle changes, Gym linking, and build/reload implications.

## PR Review Follow-Through

Not restated here — the pipeline lives in global law 2 (`~/.claude/CLAUDE.md`) and `AGENTS.md`. This skill closes out verification and handoff only.

Handoff must include `Review findings: <triage outcome>`.
