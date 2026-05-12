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

When the work includes a review of a PR:

1. Read existing PR comments and address any unresolved feedback before adding new findings.
2. Post a structured comment on the PR with all findings using `gh pr comment` (unless the user says otherwise).
3. Fix every finding — both from your review and from existing unaddressed PR comments. "Non-blocking" means "fix it now."
4. If a finding is genuinely out of scope, seed a follow-up: GitHub issue, roadmap entry, or failure ledger entry with a concrete fix path.
5. Do not close the review until every finding is resolved or has a seeded follow-up.

Handoff must include `Review findings: <all addressed | N seeded as issues>`.
