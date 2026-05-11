---
name: ns-verify-handoff
description: Close a NavSentinel task properly by verifying the changed seam, stating residual risk, and syncing docs only when truth changed.
user-invocable: true
---

# NavSentinel Verify Handoff

Use this after meaningful work or before ending a session.

## Verify First

1. Re-read the requested outcome.
2. Verify the exact changed seam directly.
3. State commands run and results.
4. State what was not verified and why.

## Sync When Required

Update these only when the work actually changes their truth:

- `docs/Project_Roadmap.md` for task status, phase gates, or decisions
- `docs/Testing_and_Gym.md` for new/changed test lanes or Gym fixtures
- `docs/Architecture_and_Data_Flow.md` for runtime architecture changes
- `docs/Intent_Model_and_Scoring.md` for scoring or model changes
- `autodoc/AGENT_INDEX.md` for new or moved seams
- `docs/agentic/FAILURE_LEDGER.md` or JSONL for recurring failures

## Call Out Operational Fallout

Mention these explicitly when they apply:

- manifest or permission changes
- new content-script injection points or world changes
- storage schema or migration concerns
- service-worker lifecycle or alarm changes
- Gym fixture additions that need linking from `gym/index.html`
- extension reload, build, or Chrome Web Store release implications

## Handoff Shape

```text
Changed: <files/seams>
Verified: <commands/results>
Not verified: <reason>
Failures/workarounds: <classification + future fix>
Docs/status sync: <updated or not needed>
Next safe slice: <one concrete action>
```

Do not claim verification that did not run.
