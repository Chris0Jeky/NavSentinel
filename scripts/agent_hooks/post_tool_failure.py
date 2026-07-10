#!/usr/bin/env python3
"""Record sanitized Claude Code and Codex tool failures to a raw autolog.

Raw machine-captured failures are appended to ``docs/agentic/failure_autolog.jsonl``
(gitignored) so routine diagnostic-command failures never pollute the curated,
git-tracked ledger (``docs/agentic/failure_ledger.jsonl``). Promote genuinely
recurring or instructive entries from the autolog into the curated ledger
*deliberately*, per ``docs/agentic/GUIDE_UPDATE_PROTOCOL.md``. The sink path is
overridable via the ``NAVSENTINEL_FAILURE_LEDGER`` env var (used by the smoke test).

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


def find_repo_root(start: str | Path) -> Path:
    """Find the enclosing checkout even when a session starts in a subdirectory."""
    path = Path(start).resolve()
    for candidate in (path, *path.parents):
        if (candidate / ".git").exists():
            return candidate
    return path


ROOT = find_repo_root(os.environ.get("CLAUDE_PROJECT_DIR", "."))
LEDGER = Path(
    os.environ.get(
        "NAVSENTINEL_FAILURE_LEDGER",
        # Raw auto-capture sink (gitignored). NOT the curated failure_ledger.jsonl —
        # promote real recurring failures into the curated ledger deliberately.
        str(ROOT / "docs" / "agentic" / "failure_autolog.jsonl"),
    )
).resolve()
SECRET_RE = re.compile(
    r"(?i)(authorization\s*[:=]\s*bearer)\s+\S+|"
    r"\b(bearer)\s+\S+|"
    r"(token|secret|password|api[_-]?key|authorization)\s*[:=]\s*\S+|"
    r"(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|X-Api-Key)\s*[:=]\s*\S+|"
    r"(cookie|set-cookie)\s*[:=]\s*\S+|"
    r"(-----BEGIN\s[A-Z ]*PRIVATE\sKEY-----)"
)
SECRET_KEY_RE = re.compile(
    r"(?i)(token|secret|password|api[_-]?key|authorization|credential|"
    r"private[_-]?key|cookie)"
)


def redact_secret(match: re.Match[str]) -> str:
    prefix = next(group for group in match.groups() if group)
    if "PRIVATE KEY" in prefix:
        return "<redacted-pem-key>"
    if "bearer" in prefix.lower():
        return f"{prefix} <redacted>"
    return f"{prefix}=<redacted>"


def sanitize_structure(value: object) -> object:
    """Recursively redact structured tool results before string conversion."""
    if isinstance(value, dict):
        return {
            str(key): "<redacted>" if SECRET_KEY_RE.search(str(key)) else sanitize_structure(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [sanitize_structure(item) for item in value]
    if isinstance(value, str):
        return SECRET_RE.sub(redact_secret, value)
    return value


def scrub(text: object, limit: int = 800) -> str:
    sanitized = sanitize_structure(text)
    if isinstance(sanitized, (dict, list)):
        value = json.dumps(sanitized, ensure_ascii=True, sort_keys=True)
    else:
        value = str(sanitized or "")
    value = SECRET_RE.sub(redact_secret, value)
    value = value.replace(str(ROOT), ".")
    if len(value) > limit:
        digest = hashlib.sha256(value.encode("utf-8", "ignore")).hexdigest()[:12]
        value = value[:limit] + f"... <truncated sha256:{digest}>"
    return value


def response_failed(response: object) -> bool:
    """Recognize Codex transport-envelope failures, not nested application data."""
    if not isinstance(response, dict):
        return False
    if response.get("success") is True:
        return False
    if (
        response.get("success") is False
        or response.get("is_error") is True
        or response.get("isError") is True
    ):
        return True
    for key in ("exit_code", "exitCode", "returncode"):
        value = response.get(key)
        if isinstance(value, int) and value != 0:
            return True
    status = response.get("status")
    if isinstance(status, str) and status.lower() in {"error", "failed", "failure"}:
        return True
    if response.get("error"):
        return True
    metadata = response.get("metadata")
    if isinstance(metadata, dict):
        return response_failed(metadata)
    return False


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    event = payload.get("hook_event_name")
    if event == "PostToolUse" and not response_failed(payload.get("tool_response")):
        return 0
    if event not in {"PostToolUse", "PostToolUseFailure"}:
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
            payload.get("error")
            or payload.get("stderr")
            or payload.get("message")
            or payload.get("tool_response")
            or payload,
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
