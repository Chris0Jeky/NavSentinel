#!/usr/bin/env python3
"""Claude Code SessionStart hook for compact NavSentinel orientation."""
from __future__ import annotations

import json
import sys


def main() -> int:
    try:
        json.load(sys.stdin)
    except json.JSONDecodeError:
        pass

    print(
        "NavSentinel agent context: read AGENTS.md, CLAUDE.md, "
        "docs/Project_Roadmap.md, and autodoc/AGENT_INDEX.md before editing. "
        "For agentic tooling changes, run npm run agent:hooks:smoke and "
        "npm run agent:skills:validate before handoff."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
