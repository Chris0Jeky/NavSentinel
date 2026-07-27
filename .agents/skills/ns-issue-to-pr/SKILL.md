---
name: ns-issue-to-pr
description: Take one NavSentinel roadmap issue or backlog slice from understanding to branch, implementation, verification, and handoff.
user-invocable: true
---

# NavSentinel Issue To PR

Orient with `AGENTS.md`, `autodoc/AGENT_INDEX.md`, and the relevant roadmap section. Pick one seam. Create a branch only when appropriate using `fix/`, `feat/`, `test/`, `infra/`, or `docs/`.

Implement one reviewable slice, verify narrowly, broaden when browser behavior changed, sync docs only when truth changed.

Review follow-through is not restated here: it lives in global law 2 (`~/.claude/CLAUDE.md`) and `AGENTS.md`. NavSentinel is T2 — merge on green proving checks at the reviewed head plus one triage pass over every comment.

Hand off summary, changed files, verification, residual risk, failures, review findings (blockers fixed, the rest tracked or declined), docs sync, and next slice.
