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
    (re.compile(r"\brm\s+-rf\b", re.I), "Recursive removal requires explicit human approval."),
    (re.compile(r"\bRemove-Item\b.*\b-Recurse\b.*\b-Force\b", re.I), "Recursive forced removal requires explicit human approval."),
    (re.compile(r"\b(?:rd|rmdir)\s+/s\b", re.I), "Recursive directory removal requires explicit human approval."),
    (re.compile(r"\bgit\s+reset\s+--hard\b", re.I), "Hard reset would discard work; inspect state and ask first."),
    (re.compile(r"\bgit\s+clean\s+-f[dDxX]*\b", re.I), "Git clean can delete untracked work; ask first."),
    (re.compile(r"\bgit\s+checkout\s+--\b", re.I), "Path checkout can overwrite user changes; ask first."),
    (re.compile(r"\bgit\s+restore\s+(?:\.|--worktree|--staged)\b", re.I), "Git restore can overwrite work; ask first."),
    (re.compile(r"\bgit\s+push\s+--force(?:-with-lease)?\b", re.I), "Force-push is blocked by project policy."),
    (re.compile(r"\bgit\s+filter-branch\b", re.I), "History rewriting requires explicit approval."),
    (re.compile(r"\bsudo\b", re.I), "sudo is outside normal repo workflow."),
    (re.compile(r"\bchmod\s+-R\s+777\b", re.I), "Recursive world-writable permissions are blocked."),
    (re.compile(r"\b(?:curl|wget)\b.+\|\s*(?:sh|bash|pwsh|powershell)\b", re.I), "Piping remote scripts into a shell is blocked."),
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

    if SECRET_TOUCH.search(compact) and not READ_ONLY.search(compact):
        deny("Command appears to modify or expose secret-bearing data. Ask for explicit approval.")
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
