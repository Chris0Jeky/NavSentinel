# Agent Failure Ledger

This file is the human-readable view of recurring agent, tool, and workflow failures. Machine-appended raw entries live in `docs/agentic/failure_ledger.jsonl` and can be rendered with:

```bash
python scripts/agent_hooks/render_failure_ledger.py
```

## Entries

| Date | Class | Surface | Failure | Workaround | Future fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-11 | seed | agentic-pack | Ledger created | n/a | Start recording recurring failures and promote confirmed lessons | open |

## Classification

- `blocker`: work cannot safely continue.
- `non_blocking_risk`: work can continue, but confidence or coverage is reduced.
- `pre_existing_noise`: unrelated existing failure that should still be visible.
- `invalid_signal`: false alarm, stale check, or non-applicable warning.

## Promotion Rule

A ledger entry should become a guide or skill update only when it is reproducible, project-specific, and likely to recur. Use `GUIDE_UPDATE_PROTOCOL.md`; do not mutate root instructions after a single ambiguous failure.
