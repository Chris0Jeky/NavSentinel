# Optional domain skill registry

NavSentinel keeps a small set of lazy-loaded workflow notes under
`.claude/skills/` and `.agents/skills/`. They are optional aids, not a harness,
gate, or runtime-parity contract. Load only a skill that directly helps the
current task; product behavior and executable checks remain authoritative.

| Skill | Useful for |
| --- | --- |
| `ns-repo-onramp` / `ns-repo-map` | Finding the current product seam without reading generated or archived trees. |
| `ns-ext-dev` | MV3 content-script, service-worker, storage, and build behavior. |
| `ns-test-harness` | Selecting focused Vitest, Playwright, Gym, corpus, rollback, or stress proof. |
| `ns-threat-validation` | Detection and false-positive evidence. |
| `ns-security-review` | Permissions, bridges, credentials, storage, privacy, and release posture. |
| `ns-ui-ux` | Popup, options, onboarding, prompts, and accessibility. |
| `ns-human-action-guide` | Walking the human-owned queue by stable `AI-N` identifier. |
| `ns-interface-map` | Maintaining code-seam orientation after a real structural change. |
| Other `ns-*` notes | Optional planning, scoping, question, issue, or handoff help. |

No script enforces matching names or content across runtimes. Update only the
workflow actually used, and delete a note when it becomes more ceremony than
help.
