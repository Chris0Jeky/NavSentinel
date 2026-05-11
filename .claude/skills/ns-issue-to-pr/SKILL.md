---
name: ns-issue-to-pr
description: Take one NavSentinel roadmap issue or backlog slice from understanding to branch, implementation, verification, and PR-ready handoff.
user-invocable: true
---

# NavSentinel Issue To PR

Use when taking a concrete issue, roadmap task, or requested slice through a reviewable change.

## Workflow

### 1. Orient

- Read `CLAUDE.md`, `AGENTS.md`, `autodoc/AGENT_INDEX.md`, and the relevant roadmap section.
- Select one primary skill and one support skill at most.
- Identify the smallest coherent seam.

### 2. Branch

Use the repo convention from `docs/Project_Roadmap.md` when a branch is needed:

```text
fix/<slug>
feat/<slug>
test/<slug>
infra/<slug>
docs/<slug>
```

Do not create a branch if the user requested a tiny local docs/workflow patch and current branch policy does not require it.

### 3. Implement

- Keep the diff within one coherent seam.
- Add or update tests for behavior changes.
- Keep UI, service-worker, credential, and navigation changes separated unless the task spans them.

### 4. Verify

- Run the narrowest meaningful checks first.
- Broaden to build/E2E when browser behavior changed.
- Record failures through `ns-failure-capture`.

### 5. Sync

Only update roadmap, docs, or agent index when their truth changed.

### 6. Handoff

```text
Summary
Changed
Verified
Not verified
Failures/workarounds
Docs/status sync
Next safe slice
```
