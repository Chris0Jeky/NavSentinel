#!/usr/bin/env python3
"""Claude Code PreToolUse hook for risky shell commands.

Reads hook JSON on stdin and either denies or allows commands.

Two safety tiers:
  1. UNCONDITIONAL DENY — always blocked (rm -rf, sudo, bare force-push, etc.)
  2. BRANCH-AWARE — blocked on protected branches (main, master, develop,
     release) but allowed on other branches (goes to the normal Claude Code
     permission prompt so the user can approve or deny with context).

Recovery commands (rebase --abort, merge --abort, stash) are never blocked.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys


# ---------------------------------------------------------------------------
# Branch detection (only called when a branch-aware pattern matches)
# ---------------------------------------------------------------------------

PROTECTED_BRANCHES = frozenset({"main", "master", "develop", "release"})

_cached_branch: str | None = ...  # type: ignore[assignment]


def get_current_branch() -> str | None:
    global _cached_branch
    if _cached_branch is not ...:
        return _cached_branch
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True, text=True, timeout=5,
        )
        branch = result.stdout.strip()
        _cached_branch = branch if branch else None
    except Exception:
        _cached_branch = None
    return _cached_branch


def on_protected_branch() -> bool:
    branch = get_current_branch()
    if branch is None:
        return True
    return branch in PROTECTED_BRANCHES


# ---------------------------------------------------------------------------
# 1. Unconditional deny patterns (always blocked, no branch exception)
# ---------------------------------------------------------------------------

DENY_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # -- Destructive file operations --
    (
        re.compile(
            r"\brm\s+(?=[^|&;]*(?:-[a-z]*r|--recursive\b))"
            r"(?=[^|&;]*(?:-[a-z]*f|--force\b))",
            re.I,
        ),
        "Recursive forced removal requires explicit human approval.",
    ),
    (
        re.compile(
            r"\bRemove-Item\b(?=.*(?:^|\s)-Recurse\b)(?=.*(?:^|\s)-Force\b)", re.I,
        ),
        "Recursive forced removal requires explicit human approval.",
    ),
    (
        re.compile(r"\b(?:rd|rmdir)\s+/s\b", re.I),
        "Recursive directory removal requires explicit human approval.",
    ),

    # -- Privilege escalation --
    (re.compile(r"\bsudo\b", re.I), "sudo is outside normal repo workflow."),
    (
        re.compile(r"\bchmod\s+-R\s+777\b", re.I),
        "Recursive world-writable permissions are blocked.",
    ),

    # -- Remote script execution --
    (
        re.compile(
            r"\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b.+\|\s*"
            r"(?:sh|bash|pwsh|powershell|iex|Invoke-Expression)\b",
            re.I,
        ),
        "Piping remote scripts into an interpreter is blocked.",
    ),

    # -- Database destruction --
    (
        re.compile(
            r"\b(?:psql|mysql|sqlite3|mongosh|mongo|redis-cli)\b.+\b"
            r"(?:drop\s+database|drop\s+table|truncate\s+table|delete\s+from)\b",
            re.I,
        ),
        "Destructive database commands require explicit approval.",
    ),

    # -- Publishing --
    (re.compile(r"\bnpm\s+publish\b", re.I),
     "Publishing requires explicit release approval."),
    (re.compile(r"\bchrome-webstore-upload\b|\bweb-ext\s+sign\b", re.I),
     "Store signing/upload requires explicit release approval."),

    # -- Git: always-dangerous operations --
    (re.compile(r"\bgit\s+filter-branch\b", re.I),
     "filter-branch rewrites the entire repository history. This is almost "
     "never what you want."),
    (
        re.compile(r"\bgit\s+push\s+--force\b(?!-with-lease)", re.I),
        "Bare --force push overwrites the remote branch unconditionally — if "
        "anyone else pushed commits, they are lost with no recovery. Use "
        "--force-with-lease instead (it checks first).",
    ),
    (
        re.compile(r"\bgit\s+push\s+-f\b", re.I),
        "Bare -f push overwrites the remote branch unconditionally. Use "
        "--force-with-lease instead (it checks first).",
    ),
    (
        re.compile(
            r"\bgit\s+push\b(?=[^|&;]*--force-with-lease\b)"
            r"(?=[^|&;]*\b(?:main|master|develop|release)\b)",
            re.I,
        ),
        "Force-pushing to a protected branch (main/master/develop/release) is "
        "never allowed, even with --force-with-lease. Protected branch history "
        "must remain intact.",
    ),
]


# ---------------------------------------------------------------------------
# 2. Branch-aware patterns
#    Denied on protected branches with a plain-language explanation.
#    Allowed on other branches — goes to the normal permission prompt
#    so the user can approve or deny after the agent has explained.
# ---------------------------------------------------------------------------

BRANCH_AWARE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"\bgit\s+push\b(?=[^|&;]*--force-with-lease\b)", re.I),
        "Force-push (--force-with-lease) on '{branch}' is blocked because it "
        "is a protected branch.\n\n"
        "What this does: overwrites the remote copy of the branch with your "
        "local version. --force-with-lease is safer than bare --force because "
        "it refuses if the remote changed since you last fetched, but it still "
        "rewrites history.\n\n"
        "On non-protected branches (like agent worktree branches), this is "
        "allowed with your permission because those branches are disposable.",
    ),
    (
        re.compile(r"\bgit\s+reset\s+--hard\b", re.I),
        "Hard reset on '{branch}' is blocked because it is a protected branch."
        "\n\n"
        "What this does: moves the branch pointer to a specific commit and "
        "PERMANENTLY discards all uncommitted changes — both staged and "
        "unstaged files. There is no undo for uncommitted work.\n\n"
        "On non-protected branches, this is allowed with your permission.",
    ),
    (
        re.compile(r"\bgit\s+reset\s+--(?:soft|mixed)\b", re.I),
        "Soft/mixed reset on '{branch}' is blocked because it is a protected "
        "branch.\n\n"
        "What this does: moves the branch pointer backward, effectively "
        "'uncommitting' recent commits. The file changes are kept (staged or "
        "unstaged) but the commits disappear from history. If those commits "
        "were already pushed, you will need a force-push to sync.\n\n"
        "On non-protected branches, this is allowed with your permission.",
    ),
    (
        re.compile(r"\bgit\s+rebase\b(?!\s+--(?:abort|continue|skip)\b)", re.I),
        "Rebase on '{branch}' is blocked because it is a protected branch.\n\n"
        "What this does: takes your commits and replays them on top of another "
        "branch, rewriting every commit hash. After rebase, your local branch "
        "and the remote copy have different histories — the only way to sync "
        "them is force-push.\n\n"
        "Safer alternative: 'git merge main' pulls in the latest changes "
        "without rewriting history.\n\n"
        "On non-protected branches, rebase is allowed with your permission.",
    ),
    (
        re.compile(r"\bgit\s+pull\b(?=[^|&;]*--rebase\b)", re.I),
        "Pull-with-rebase on '{branch}' is blocked because it is a protected "
        "branch.\n\n"
        "What this does: fetches remote changes and then rebases your local "
        "commits on top, rewriting their hashes. This can create the same "
        "diverged-history problem as a standalone rebase.\n\n"
        "Safer alternative: 'git pull --no-rebase' or 'git merge'.",
    ),
    (
        re.compile(r"\bgit\s+checkout\s+--(?:\s|$)", re.I),
        "Path checkout on '{branch}' is blocked because it is a protected "
        "branch.\n\n"
        "What this does: overwrites your uncommitted file changes with the "
        "version from the last commit. This is permanent — the uncommitted "
        "changes are gone.\n\n"
        "On non-protected branches, this is allowed with your permission.",
    ),
    (
        re.compile(r"\bgit\s+restore\s+(?:\.(?:\s|$)|--(?:worktree|staged)\b)", re.I),
        "Git restore on '{branch}' is blocked because it is a protected "
        "branch.\n\n"
        "What this does: discards uncommitted changes to files (--worktree) "
        "or unstages them (--staged). The worktree variant permanently "
        "deletes your uncommitted edits.\n\n"
        "On non-protected branches, this is allowed with your permission.",
    ),
    (
        re.compile(r"\bgit\s+clean\b(?=[^|&;]*(?:-\S*f\S*|--force\b))", re.I),
        "Git clean on '{branch}' is blocked because it is a protected branch."
        "\n\n"
        "What this does: deletes untracked files from your working directory. "
        "These are files that were never committed — if they contain work "
        "you haven't saved elsewhere, they are gone permanently.\n\n"
        "On non-protected branches, this is allowed with your permission.",
    ),
]


# ---------------------------------------------------------------------------
# Secret-touching guard
# ---------------------------------------------------------------------------

SECRET_TOUCH = re.compile(
    r"(^|[\s/\\])\.env(?:\.|\s|$)|secrets?\.(json|ya?ml|toml)$|"
    r"(?:token|secret|password|api[_-]?key)",
    re.I,
)
READ_ONLY = re.compile(
    r"\b(?:rg|grep|cat|type|Get-Content|Select-String|"
    r"git\s+diff|git\s+status)\b",
    re.I,
)


# ---------------------------------------------------------------------------
# Segment-level patterns (for compound commands split by ; & |)
# ---------------------------------------------------------------------------

SEGMENT_DENY_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"\brm\s+(?:-[a-z]*r|--recursive\b)", re.I),
        "Recursive removal requires explicit human approval.",
    ),
]


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

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


def split_segments(command: str) -> list[str]:
    return re.split(r"\s*[;&|]+\s*", command)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

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

    # 1. Unconditional denies — always blocked regardless of branch
    for pattern, reason in DENY_PATTERNS:
        if pattern.search(compact):
            deny(reason)
            return 0

    # 2. Branch-aware denies — blocked on protected branches only
    for pattern, reason_template in BRANCH_AWARE_PATTERNS:
        if pattern.search(compact):
            if on_protected_branch():
                branch = get_current_branch() or "unknown/detached HEAD"
                deny(reason_template.format(branch=branch))
                return 0
            # Non-protected branch: let it through to the permission prompt.
            # The agent should have already explained the risks to the user.
            return 0

    # 3. Segment-level checks for compound commands
    for segment in split_segments(compact):
        for pattern, reason in SEGMENT_DENY_PATTERNS:
            if pattern.search(segment):
                deny(reason)
                return 0

    # 4. Secret-touching guard
    if SECRET_TOUCH.search(compact) and not READ_ONLY.search(compact):
        deny(
            "Command appears to modify or expose secret-bearing data. "
            "Ask for explicit approval."
        )
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
