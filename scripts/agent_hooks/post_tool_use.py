#!/usr/bin/env python3
"""Claude Code PostToolUse hook for targeted agentic-tooling reminders."""
from __future__ import annotations

import json
import sys
from pathlib import Path


AGENTIC_PREFIXES = (
    ".agents/",
    ".claude/",
    "autodoc/",
    "docs/agentic/",
    "scripts/agent_hooks/",
)
AGENTIC_FILES = {"AGENTS.md", "CLAUDE.md", ".mcp.json", "package.json"}


def normalize_path(value: object) -> str:
    try:
        path = Path(str(value)).as_posix()
    except (TypeError, ValueError):
        return ""
    parts = path.split("NavSentinel/", 1)
    return parts[-1].lstrip("./")


def is_agentic_path(path: str) -> bool:
    if path in AGENTIC_FILES:
        return True
    return any(path.startswith(prefix) for prefix in AGENTIC_PREFIXES)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    if payload.get("hook_event_name") != "PostToolUse":
        return 0

    tool_input = payload.get("tool_input", {}) or {}
    path = normalize_path(tool_input.get("file_path") or tool_input.get("path") or "")
    if not is_agentic_path(path):
        return 0

    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": (
                        "Agentic tooling changed. Before handoff, run "
                        "`npm run agent:hooks:smoke`, `npm run agent:skills:validate`, "
                        "and the relevant JSON/compile checks. Do not claim live MCP "
                        "availability unless it was verified in the active runtime."
                    ),
                }
            },
            ensure_ascii=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
