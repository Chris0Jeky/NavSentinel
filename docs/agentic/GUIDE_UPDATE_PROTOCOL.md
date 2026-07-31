# Optional Guide Update Notes

This is advisory only. Owner decision #499 removed the repository-local agent
harness; documentation does not need a parallel process update unless product
truth or a repeatedly useful command actually changed.

## When To Update Instructions

Promote a lesson when at least one condition is true:

1. The same mistake happened more than once.
2. A review caught something the agent should have known from repo conventions.
3. A workaround was required and future agents would rediscover it.
4. A source-of-truth path changed.
5. A safety, privacy, permission, or release boundary changed.
6. A review finding was deferred as "non-blocking" and later caused rework or tech debt.

## Where To Write

| Lesson type | Destination |
| --- | --- |
| Short universal rule | `CLAUDE.md` or `AGENTS.md` |
| Repeatable workflow | `.claude/skills/<skill>/SKILL.md` |
| Fast code orientation | `autodoc/AGENT_INDEX.md` or `autodoc/interfaces/<domain>.md` |
| Product behavior detail | Existing docs under `docs/` |
| Temporary tool or environment issue | `docs/agentic/failure_ledger.jsonl` or `docs/agentic/FAILURE_LEDGER.md` |
| Roadmap or phase truth | `docs/Project_Roadmap.md` |

## Anti-Bloat Rules

- Keep `CLAUDE.md` under 200 lines.
- Do not duplicate long checklists already in skills.
- Replace obsolete guidance instead of appending around it.
- Prefer one precise rule over several vague warnings.
- Do not promote a single ambiguous failure into root instructions.

## Candidate Patch Format

```text
Observed: <what happened>
Root cause: <why the agent failed or tool misled it>
Repeat risk: <low|medium|high>
Proposed destination: <file>
Proposed wording: <one or two concise bullets>
Verification: <how we know the rule is correct>
```
