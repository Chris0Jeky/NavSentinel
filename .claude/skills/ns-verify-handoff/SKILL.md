---
name: ns-verify-handoff
description: Close a NavSentinel task properly: verify the changed seam, state what remains unverified, and call out build or reload implications.
user-invocable: true
---

# NavSentinel Verify Handoff

Use this after meaningful work or before ending a session.

## Verify first

1. Re-read the requested outcome.
2. Verify the changed seam directly.
3. State what was not verified.

## Call out operational fallout when relevant

Mention these explicitly when they apply:

- manifest or permission changes
- new content-script injection points or world changes
- storage schema or migration concerns
- service-worker lifecycle or alarm changes
- Gym fixture additions that need linking from `gym/index.html`
- docs that should be updated to reflect the change

## Guardrails

- do not claim verification you did not run
- do not bury reload or build requirements under a long changelog
- if the task only changed local workflow files, verify that tracked shared files stayed untouched