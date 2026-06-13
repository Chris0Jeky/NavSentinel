#!/usr/bin/env python3
"""Render docs/agentic/failure_ledger.jsonl into FAILURE_LEDGER.md."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
JSONL = ROOT / "docs" / "agentic" / "failure_ledger.jsonl"
MD = ROOT / "docs" / "agentic" / "FAILURE_LEDGER.md"

HEADER = """# Agent Failure Ledger

This file is the human-readable view of recurring agent, tool, and workflow failures. The curated source is `docs/agentic/failure_ledger.jsonl` (git-tracked; deliberately-promoted entries only). Raw machine-captured failures go to the gitignored `docs/agentic/failure_autolog.jsonl` — promote genuinely recurring ones into the curated ledger per `GUIDE_UPDATE_PROTOCOL.md`. Render with:

```bash
python scripts/agent_hooks/render_failure_ledger.py
```

## Entries

| Date | Class | Surface | Failure | Workaround | Future fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
"""

FOOTER = """

## Classification

- `blocker`: work cannot safely continue.
- `non_blocking_risk`: work can continue, but confidence or coverage is reduced.
- `pre_existing_noise`: unrelated existing failure that should still be visible.
- `invalid_signal`: false alarm, stale check, or non-applicable warning.

## Promotion Rule

A ledger entry should become a guide or skill update only when it is reproducible, project-specific, and likely to recur. Use `GUIDE_UPDATE_PROTOCOL.md`; do not mutate root instructions after a single ambiguous failure.
"""


def cell(value: object, limit: int = 160) -> str:
    text = str(value or "").replace("\n", " ").replace("|", "\\|")
    return text[:limit] + ("..." if len(text) > limit else "")


def main() -> int:
    rows: list[str] = []
    if JSONL.exists():
        for line in JSONL.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            date = str(entry.get("ts", ""))[:10] or "unknown"
            rows.append(
                f"| {cell(date, 20)} | {cell(entry.get('class'), 40)} | "
                f"{cell(entry.get('surface'), 80)} | {cell(entry.get('failure'))} | "
                f"{cell(entry.get('workaround'))} | {cell(entry.get('future_fix'))} | "
                f"{cell(entry.get('status'), 40)} |"
            )

    if not rows:
        rows.append(
            "| 2026-05-11 | seed | agentic-pack | Ledger created | n/a | "
            "Start recording recurring failures and promote confirmed lessons | open |"
        )

    MD.parent.mkdir(parents=True, exist_ok=True)
    MD.write_text(HEADER + "\n".join(rows) + FOOTER, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
