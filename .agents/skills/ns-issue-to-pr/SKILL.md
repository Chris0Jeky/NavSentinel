---
name: ns-issue-to-pr
description: Take one NavSentinel roadmap issue or backlog slice from understanding to branch, implementation, verification, and handoff.
user-invocable: true
---

# NavSentinel Issue To PR

Orient with `AGENTS.md`, `autodoc/AGENT_INDEX.md`, and the relevant roadmap section. Pick one seam. Create a branch only when appropriate using `fix/`, `feat/`, `test/`, `infra/`, or `docs/`.

Implement one reviewable slice, verify narrowly, broaden when browser behavior changed, sync docs only when truth changed.

Review follow-through: if the PR was reviewed, read existing PR comments and address any unresolved feedback first. Fix every finding — both from your review and from existing unaddressed PR comments. If genuinely out of scope, seed a follow-up (GitHub issue, roadmap entry, or failure ledger entry). Post all findings as a PR comment using `gh pr comment` (unless the user says otherwise). Do not merge or hand off with unaddressed findings.

Hand off summary, changed files, verification, residual risk, failures, review findings (all addressed or N seeded as issues), docs sync, and next slice.
