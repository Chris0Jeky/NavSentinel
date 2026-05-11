#!/usr/bin/env python3
"""Record sanitized Claude Code tool failures for later review.

This records enough context to prevent recurring silent failures while
minimizing secret and transcript leakage.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path


ROOT = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")).resolve()
LEDGER = ROOT / "docs" / "agentic" / "failure_ledger.jsonl"
SECRET_RE = re.compile(
    r"(?i)(authorization\s*[:=]\s*bearer)\s+\S+|"
    r"\b(bearer)\s+\S+|"
    r"(token|secret|password|api[_-]?key|authorization)\s*[:=]\s*\S+"
)


def redact_secret(match: re.Match[str]) -> str:
    prefix = next(group for group in match.groups() if group)
    if "bearer" in prefix.lower():
        return f"{prefix} <redacted>"
    return f"{prefix}=<redacted>"


def scrub(text: object, limit: int = 800) -> str:
    value = str(text or "")
    value = SECRET_RE.sub(redact_secret, value)
    value = value.replace(str(ROOT), ".")
    if len(value) > limit:
        digest = hashlib.sha256(value.encode("utf-8", "ignore")).hexdigest()[:12]
        value = value[:limit] + f"... <truncated sha256:{digest}>"
    return value


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    tool_name = payload.get("tool_name", "unknown")
    tool_input = payload.get("tool_input", {}) or {}
    entry = {
        "ts": dt.datetime.now(dt.timezone.utc).isoformat(),
        "class": "unclassified",
        "surface": scrub(tool_name, 80),
        "command_or_target": scrub(
            tool_input.get("command") or tool_input.get("file_path") or tool_input,
            500,
        ),
        "failure": scrub(
            payload.get("error") or payload.get("stderr") or payload.get("message") or payload,
            1000,
        ),
        "workaround": "",
        "future_fix": "classify and promote if recurring",
        "status": "open",
    }

    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
