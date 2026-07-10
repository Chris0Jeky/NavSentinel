#!/usr/bin/env python3
"""Claude Code and Codex PostToolUse hook for agentic-tooling reminders."""
from __future__ import annotations

import json
import sys
from pathlib import Path


AGENTIC_PREFIXES = (
    ".agents/",
    ".claude/",
    ".codex/",
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
    path = parts[-1]
    while path.startswith("./"):
        path = path[2:]
    return path.lstrip("/")


def is_agentic_path(path: str) -> bool:
    if path in AGENTIC_FILES:
        return True
    return any(path.startswith(prefix) for prefix in AGENTIC_PREFIXES)


def changed_paths(tool_input: dict) -> list[str]:
    """Extract direct edit paths and Codex apply_patch header paths."""
    direct = tool_input.get("file_path") or tool_input.get("path")
    paths = [normalize_path(direct)] if direct else []
    command = tool_input.get("command")
    if isinstance(command, str):
        for line in command.splitlines():
            for marker in ("*** Add File: ", "*** Update File: ", "*** Delete File: "):
                if line.startswith(marker):
                    paths.append(normalize_path(line.removeprefix(marker)))
    return [path for path in paths if path]


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    if payload.get("hook_event_name") != "PostToolUse":
        return 0

    tool_input = payload.get("tool_input", {}) or {}
    if not any(is_agentic_path(path) for path in changed_paths(tool_input)):
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
