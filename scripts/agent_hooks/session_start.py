#!/usr/bin/env python3
"""Claude Code and Codex SessionStart hook for compact NavSentinel orientation."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ACTION_ITEM_RE = re.compile(
    r"^\*\*[^\n]*?\b(OPEN|BLOCKED):\s*(AI-\d+)\b",
    re.MULTILINE,
)
GUIDED_CURSOR_RE = re.compile(r"Guided resolution cursor:\*\*\s*`?(AI-\d+)")


def action_items_path() -> Path:
    override = os.environ.get("NAVSENTINEL_ACTION_ITEMS")
    return Path(override) if override else ROOT / "ACTION_ITEMS.md"


def read_action_items(path: Path | None = None) -> str:
    try:
        return (path or action_items_path()).read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise ValueError(
            f"cannot read ACTION_ITEMS.md ({type(exc).__name__})"
        ) from exc


def current_actions(path: Path | None = None) -> list[tuple[str, str]]:
    text = read_action_items(path)

    actions: list[tuple[str, str]] = []
    seen: dict[str, str] = {}
    for status, action_id in ACTION_ITEM_RE.findall(text):
        if action_id in seen:
            raise ValueError(
                f"duplicate {action_id} entries ({seen[action_id]} and {status})"
            )
        seen[action_id] = status
        actions.append((status, action_id))
    return actions


def current_cursor(path: Path | None = None) -> str | None:
    text = read_action_items(path)
    matches = GUIDED_CURSOR_RE.findall(text)
    if len(matches) > 1:
        raise ValueError("multiple guided resolution cursors")
    return matches[0] if matches else None


def validate_cursor(
    cursor: str | None, actions: list[tuple[str, str]]
) -> str | None:
    if cursor is None:
        if any(status == "OPEN" for status, _ in actions):
            raise ValueError("guided resolution cursor is missing for current OPEN actions")
        return None
    status_by_id = {action_id: status for status, action_id in actions}
    status = status_by_id.get(cursor)
    if status is None:
        raise ValueError(f"guided resolution cursor {cursor} is not a current action")
    if status != "OPEN":
        raise ValueError(f"guided resolution cursor {cursor} is {status}, not OPEN")
    return cursor


def format_action_queue(actions: list[tuple[str, str]]) -> str:
    if not actions:
        return "Human action queue: read ACTION_ITEMS.md before continuing."
    open_ids = [action_id for status, action_id in actions if status == "OPEN"]
    blocked_ids = [action_id for status, action_id in actions if status == "BLOCKED"]
    parts: list[str] = []
    if open_ids:
        parts.append("OPEN " + ", ".join(open_ids))
    if blocked_ids:
        parts.append("BLOCKED " + ", ".join(blocked_ids))
    return "Human action queue: " + "; ".join(parts) + "."


def main() -> int:
    try:
        json.load(sys.stdin)
    except json.JSONDecodeError:
        pass

    try:
        actions = current_actions()
        queue = format_action_queue(actions)
        cursor = validate_cursor(current_cursor(), actions)
    except ValueError as exc:
        queue = f"Human action queue INVALID: {exc}."
        cursor = None
    resume = f" Resume at {cursor}." if cursor else ""
    print(
        "NavSentinel agent context: read ACTION_ITEMS.md, AGENTS.md, CLAUDE.md, "
        "docs/Project_Roadmap.md, and autodoc/AGENT_INDEX.md "
        "before editing. "
        f"{queue}{resume} When Chris asks to work through cumulative actions, use "
        "ns-human-action-guide and resume by stable AI-N ID. "
        "For agentic tooling changes, run npm run agent:hooks:smoke and "
        "npm run agent:skills:validate before handoff."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
