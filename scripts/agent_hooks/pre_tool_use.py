#!/usr/bin/env python3
"""Claude Code PreToolUse hook for risky shell commands.

Reads hook JSON on stdin and denies commands that are destructive,
credential-risky, release-risky, or inconsistent with the repo's small-diff
workflow.
"""
from __future__ import annotations

import json
import re
import sys


DENY_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(
            r"\brm\s+(?=[^|&;]*(?:-[a-z]*r|--recursive\b))"
            r"(?=[^|&;]*(?:-[a-z]*f|--force\b))",
            re.I,
        ),
        "Recursive forced removal requires explicit human approval.",
    ),
    (re.compile(r"\bRemove-Item\b(?=.*(?:^|\s)-Recurse\b)(?=.*(?:^|\s)-Force\b)", re.I), "Recursive forced removal requires explicit human approval."),
    (re.compile(r"\b(?:rd|rmdir)\s+/s\b", re.I), "Recursive directory removal requires explicit human approval."),
    (re.compile(r"\bgit\s+reset\s+--hard\b", re.I), "Hard reset would discard work; inspect state and ask first."),
    (re.compile(r"\bgit\s+reset\s+--(?:soft|mixed)\b", re.I), "Soft/mixed reset discards commit history; ask first."),
    (re.compile(r"\bgit\s+clean\b(?=[^|&;]*(?:-\S*f\S*|--force\b))", re.I), "Git clean can delete untracked work; ask first."),
    (re.compile(r"\bgit\s+checkout\s+--(?:\s|$)", re.I), "Path checkout can overwrite user changes; ask first."),
    (re.compile(r"\bgit\s+restore\s+(?:\.|--worktree|--staged)\b", re.I), "Git restore can overwrite work; ask first."),
    (re.compile(r"\bgit\s+push\b(?=[^|&;]*(?:--force(?:-with-lease)?|-f)\b)", re.I), "Force-push is blocked by project policy."),
    (re.compile(r"\bgit\s+filter-branch\b", re.I), "History rewriting requires explicit approval."),
    (re.compile(r"\bgit\s+rebase\b(?=[^|&;]*(?:-i\b|--interactive\b))", re.I), "Interactive rebase rewrites history; ask first."),
    (re.compile(r"\bsudo\b", re.I), "sudo is outside normal repo workflow."),
    (re.compile(r"\bchmod\s+-R\s+777\b", re.I), "Recursive world-writable permissions are blocked."),
    (
        re.compile(
            r"\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b.+\|\s*"
            r"(?:sh|bash|pwsh|powershell|iex|Invoke-Expression)\b",
            re.I,
        ),
        "Piping remote scripts into an interpreter is blocked.",
    ),
    (
        re.compile(
            r"\b(?:psql|mysql|sqlite3|mongosh|mongo|redis-cli)\b.+\b"
            r"(?:drop\s+database|drop\s+table|truncate\s+table|delete\s+from)\b",
            re.I,
        ),
        "Destructive database commands require explicit approval.",
    ),
    (re.compile(r"\bnpm\s+publish\b", re.I), "Publishing requires explicit release approval."),
    (re.compile(r"\bchrome-webstore-upload\b|\bweb-ext\s+sign\b", re.I), "Store signing/upload requires explicit release approval."),
]

SECRET_TOUCH = re.compile(
    r"(^|[\s/\\])\.env(?:\.|\s|$)|secrets?\.(json|ya?ml|toml)$|"
    r"(?:token|secret|password|api[_-]?key)",
    re.I,
)
READ_ONLY = re.compile(r"\b(?:rg|grep|cat|type|Get-Content|Select-String|git\s+diff|git\s+status)\b", re.I)


def deny(reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )


SEGMENT_DENY_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"\brm\s+(?:-[a-z]*r|--recursive\b)", re.I),
        "Recursive removal requires explicit human approval.",
    ),
    (
        re.compile(r"\bgit\s+clean\b", re.I),
        "Git clean can delete untracked work; ask first.",
    ),
]


def split_segments(command: str) -> list[str]:
    return re.split(r"\s*[;&|]+\s*", command)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    tool_name = payload.get("tool_name")
    if tool_name != "Bash":
        return 0

    command = str(payload.get("tool_input", {}).get("command", ""))
    compact = " ".join(command.split())

    for pattern, reason in DENY_PATTERNS:
        if pattern.search(compact):
            deny(reason)
            return 0

    for segment in split_segments(compact):
        for pattern, reason in SEGMENT_DENY_PATTERNS:
            if pattern.search(segment):
                deny(reason)
                return 0

    if SECRET_TOUCH.search(compact) and not READ_ONLY.search(compact):
        deny("Command appears to modify or expose secret-bearing data. Ask for explicit approval.")
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
