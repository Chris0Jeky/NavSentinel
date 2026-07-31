#!/usr/bin/env python3
"""Smoke-test NavSentinel Claude Code and Codex hook behavior.

Two layers:
  1. The irreversible deny FLOOR is the canonical `.claude/hooks/dispatch.py`
     (copied verbatim from agent-harness/templates/hooks). Its full block/allow
     matrix is proven by `.claude/hooks/smoke_test.py`, which this test delegates
     to (`test_floor_matrix`). The local copies are pinned CI/audit fixtures:
     Claude executes the shared global floor, while Codex's one project adapter
     pins and invokes that same dispatcher with Codex runtime semantics.
  2. The repo-tier event handlers (SessionStart orientation ping, PostToolUse
     agentic nudge, PostToolUseFailure autolog) live in scripts/agent_hooks/ and
     are exercised directly.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import runpy
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SETTINGS = ROOT / ".claude" / "settings.json"
CODEX_HOOKS = ROOT / ".codex" / "hooks.json"
MCP = ROOT / ".mcp.json"
ACTION_ITEMS = ROOT / "ACTION_ITEMS.md"
HANDOFF = ROOT / "docs" / "agentic" / "HANDOFF.md"
QUESTION_PROTOCOL = ROOT / "docs" / "agentic" / "QUESTION_PROTOCOL.md"
FLOOR_SMOKE = ROOT / ".claude" / "hooks" / "smoke_test.py"
FLOOR_DISPATCH = ROOT / ".claude" / "hooks" / "dispatch.py"
FLOOR_PROVENANCE = "agent-harness canonical deny floor v1.6.21"
EXPECTED_DISPATCH_SHA256 = (
    "ea4fb45dc71a44e80392e7ea423bc70dcb604538e956cb13cf34b750118974b5"
)
EXPECTED_SMOKE_SHA256 = (
    "64f9caf0851cdc345cf40929ecc8f1fc21ea0f086212f87053290c3b5754706f"
)
VALID_EVENTS = {
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PostToolBatch",
    "PermissionRequest",
    "PermissionDenied",
    "Notification",
    "SessionStart",
    "Setup",
    "SessionEnd",
    "Stop",
    "StopFailure",
    "PreCompact",
    "PostCompact",
    "SubagentStart",
    "SubagentStop",
    "TaskCreated",
    "TaskCompleted",
    "ConfigChange",
    "CwdChanged",
    "FileChanged",
    "Elicitation",
    "ElicitationResult",
    "WorktreeCreate",
    "WorktreeRemove",
}
TOOL_EVENTS = {
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "PermissionDenied",
}
# Hook dirs whose referenced .py scripts must exist on disk.
HOOK_SCRIPT_RE = re.compile(
    r"(?:scripts[\\/]+agent_hooks|\.claude[\\/]+hooks)[\\/]+[^\"'\s]+?\.py"
)


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise AssertionError(f"{path} is not valid JSON: {exc}") from exc


def iter_hook_entries(settings: dict):
    hooks = settings.get("hooks", {})
    if not isinstance(hooks, dict):
        raise AssertionError(".claude/settings.json hooks must be an object")
    for event, entries in hooks.items():
        if event not in VALID_EVENTS:
            raise AssertionError(f"invalid hook event {event}")
        if not isinstance(entries, list):
            raise AssertionError(f"{event} hook entries must be a list")
        for entry in entries:
            yield event, entry


def validate_hook_shape(settings: dict) -> None:
    for event, entry in iter_hook_entries(settings):
        if event in TOOL_EVENTS and not entry.get("matcher") and "if" not in entry:
            raise AssertionError(f"{event} hook entry needs matcher or if")
        if "if" in entry:
            condition = entry["if"]
            if not isinstance(condition, str) or "&&" in condition or "||" in condition:
                raise AssertionError(f"{event} has invalid if condition")
        hooks = entry.get("hooks")
        if not isinstance(hooks, list) or not hooks:
            raise AssertionError(f"{event} entry has no hooks")
        for hook in hooks:
            if hook.get("type") != "command":
                raise AssertionError(f"{event} hook type must be command")
            command = hook.get("command")
            if not isinstance(command, str) or not command.strip():
                raise AssertionError(f"{event} hook has empty command")
            timeout = hook.get("timeout")
            if not isinstance(timeout, int) or timeout <= 0 or timeout > 30:
                raise AssertionError(f"{event} hook has invalid timeout {timeout!r}")
            for match in HOOK_SCRIPT_RE.finditer(command):
                rel = match.group(0).replace("\\", "/")
                script = ROOT / rel
                if not script.exists():
                    raise AssertionError(
                        f"{event} hook references missing script {script}"
                    )


def hook_command(settings: dict, event: str, handler_index: int = 0) -> dict:
    entries = settings["hooks"].get(event, [])
    if not entries:
        raise AssertionError(f"missing {event} hook")
    hooks = entries[0].get("hooks", [])
    if not hooks:
        raise AssertionError(f"{event} has no command hook")
    try:
        return hooks[handler_index]
    except IndexError as exc:
        raise AssertionError(f"{event} has no hook handler {handler_index}") from exc


def run_configured_hook(
    hook: dict, payload: dict, extra_env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["CLAUDE_PROJECT_DIR"] = str(ROOT)
    if extra_env:
        env.update(extra_env)
    shell = hook.get("shell", "powershell")
    command = hook["command"]
    if shell.lower() == "powershell":
        args = ["powershell", "-NoProfile", "-Command", command]
    else:
        args = [shell, "-c", command]
    return subprocess.run(
        args,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        cwd=ROOT,
        env=env,
        timeout=int(hook.get("timeout", 10)) + 5,
        check=False,
    )


def run_codex_hook(
    hook: dict,
    payload: dict,
    extra_env: dict[str, str] | None = None,
    cwd: Path = ROOT,
) -> subprocess.CompletedProcess[str]:
    """Run a project Codex hook using the current platform's command."""
    env = os.environ.copy()
    env.pop("CLAUDE_PROJECT_DIR", None)
    if extra_env:
        env.update(extra_env)
    if os.name == "nt":
        command = hook.get("commandWindows") or hook.get("command")
        args = ["powershell", "-NoProfile", "-Command", command]
    else:
        command = hook.get("command")
        args = ["/bin/sh", "-c", command]
    return subprocess.run(
        args,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        cwd=cwd,
        env=env,
        timeout=int(hook.get("timeout", 10)) + 5,
        check=False,
    )


def is_denied(stdout: str) -> bool:
    if not stdout.strip():
        return False
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return False
    output = data.get("hookSpecificOutput", {})
    return output.get("permissionDecision") == "deny"


def normalized_sha256(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def test_floor_integrity() -> None:
    expected = {
        FLOOR_DISPATCH: EXPECTED_DISPATCH_SHA256,
        FLOOR_SMOKE: EXPECTED_SMOKE_SHA256,
    }
    for path, digest in expected.items():
        if not path.is_file():
            raise AssertionError(f"canonical floor artifact missing: {path}")
        actual = normalized_sha256(path)
        if actual != digest:
            raise AssertionError(
                f"canonical floor artifact drifted from {FLOOR_PROVENANCE}: "
                f"{path} expected={digest} actual={actual}"
            )


def test_floor_matrix() -> None:
    """Delegate to the canonical floor smoke test (full block/allow matrix)."""
    if not FLOOR_SMOKE.exists():
        raise AssertionError(f"canonical floor smoke test missing: {FLOOR_SMOKE}")
    result = subprocess.run(
        [sys.executable, str(FLOOR_SMOKE)],
        capture_output=True,
        text=True,
        cwd=ROOT,
        # The canonical floor matrix is large; on Windows (slow per-case
        # subprocess spawning) the whole smoke run measured ~294s on 2026-07-25,
        # well over the old 120s cap that used to fail this check outright.
        # The floor smoke exits fast on a real failure, so this bound only guards a
        # genuine hang, not normal completion. Keep headroom above the CI spread.
        timeout=600,
        check=False,
    )
    if result.returncode != 0:
        tail = "\n".join(result.stdout.strip().splitlines()[-8:])
        raise AssertionError(f"canonical floor matrix failed:\n{tail}\n{result.stderr}")


def test_single_floor_topology(settings: dict, hooks_config: dict) -> None:
    if settings.get("hooks", {}).get("PreToolUse"):
        raise AssertionError(
            "Claude project settings must not duplicate the global PreToolUse floor"
        )
    entries = hooks_config.get("hooks", {}).get("PreToolUse", [])
    if len(entries) != 1 or len(entries[0].get("hooks", [])) != 1:
        raise AssertionError("Codex must configure exactly one PreToolUse floor")


def test_post_tool_use(settings: dict) -> None:
    hook = hook_command(settings, "PostToolUse")
    payload = {
        "hook_event_name": "PostToolUse",
        "tool_name": "Edit",
        "tool_input": {"file_path": str(ROOT / "AGENTS.md")},
        "tool_response": {"success": True},
    }
    result = run_configured_hook(hook, payload)
    if result.returncode != 0:
        raise AssertionError(f"PostToolUse failed: {result.stderr}")
    data = json.loads(result.stdout)
    output = data.get("hookSpecificOutput", {})
    if "agent:hooks:smoke" not in output.get("additionalContext", ""):
        raise AssertionError("PostToolUse did not add agentic smoke-test context")

    nested_payload = {
        "hook_event_name": "PostToolUse",
        "tool_name": "apply_patch",
        "cwd": str(ROOT / "docs"),
        "tool_input": {"command": "*** Update File: ../AGENTS.md\n"},
        "tool_response": {"success": True},
    }
    nested_result = run_configured_hook(hook, nested_payload)
    if nested_result.returncode != 0 or "agent:hooks:smoke" not in nested_result.stdout:
        raise AssertionError(
            "PostToolUse ignored a relative agentic path from a nested payload cwd"
        )


def test_post_tool_use_alt_worktree_path() -> None:
    namespace = runpy.run_path(
        str(ROOT / "scripts" / "agent_hooks" / "post_tool_use.py")
    )
    normalize_path = namespace["normalize_path"]
    is_agentic_path = namespace["is_agentic_path"]
    with tempfile.TemporaryDirectory() as tmp:
        alternate_root = Path(tmp) / "NavSentinel-ri01"
        alternate_root.mkdir(parents=True, exist_ok=True)
        normalized = normalize_path(
            alternate_root / ".codex" / "hooks.json", alternate_root
        )
        if normalized != ".codex/hooks.json" or not is_agentic_path(normalized):
            raise AssertionError(
                "PostToolUse did not recognize an agentic file in an alternate-named worktree"
            )


def test_post_tool_use_failure(settings: dict) -> None:
    hook = hook_command(settings, "PostToolUseFailure")
    with tempfile.TemporaryDirectory() as tmp:
        ledger = Path(tmp) / "failure_ledger.jsonl"
        payload = {
            "hook_event_name": "PostToolUseFailure",
            "tool_name": "Bash",
            "tool_input": {"command": "echo token=abc123 password=hunter2"},
            "error": "authorization: Bearer raw-token api_key=abcdef secret=topsecret",
        }
        result = run_configured_hook(
            hook, payload, {"NAVSENTINEL_FAILURE_LEDGER": str(ledger)}
        )
        if result.returncode != 0:
            raise AssertionError(f"PostToolUseFailure failed: {result.stderr}")
        text = ledger.read_text(encoding="utf-8")
        for raw in ("abc123", "hunter2", "raw-token", "abcdef", "topsecret"):
            if raw in text:
                raise AssertionError(f"failure ledger leaked raw secret {raw!r}")
        if "<redacted>" not in text:
            raise AssertionError("failure ledger did not contain redaction markers")


def test_session_start(settings: dict) -> None:
    hook = hook_command(settings, "SessionStart")
    payload = {"hook_event_name": "SessionStart", "cwd": str(ROOT)}
    with tempfile.TemporaryDirectory() as tmp:
        action_items = Path(tmp) / "ACTION_ITEMS.md"
        action_items.write_text(
            "**Guided resolution cursor:** AI-101\n\n"
            "**OPEN: AI-101 - choose**\n\n**BLOCKED: AI-102 - wait**\n",
            encoding="utf-8",
        )
        result = run_configured_hook(
            hook,
            payload,
            {"NAVSENTINEL_ACTION_ITEMS": str(action_items)},
        )
        duplicate_items = Path(tmp) / "ACTION_ITEMS-duplicate.md"
        duplicate_items.write_text(
            "**OPEN: AI-101 - choose**\n\n**BLOCKED: AI-101 - wait**\n",
            encoding="utf-8",
        )
        duplicate_result = run_configured_hook(
            hook,
            payload,
            {"NAVSENTINEL_ACTION_ITEMS": str(duplicate_items)},
        )
        invalid_cursor_results = []
        invalid_cursor_cases = {
            "absent": "**OPEN: AI-101 - choose**\n",
            "missing": (
                "**Guided resolution cursor:** AI-999\n\n" "**OPEN: AI-101 - choose**\n"
            ),
            "blocked": (
                "**Guided resolution cursor:** AI-102\n\n"
                "**OPEN: AI-101 - choose**\n\n**BLOCKED: AI-102 - wait**\n"
            ),
            "empty": "**Guided resolution cursor:** AI-101\n",
        }
        for name, content in invalid_cursor_cases.items():
            invalid_items = Path(tmp) / f"ACTION_ITEMS-{name}.md"
            invalid_items.write_text(content, encoding="utf-8")
            invalid_cursor_results.append(
                run_configured_hook(
                    hook,
                    payload,
                    {"NAVSENTINEL_ACTION_ITEMS": str(invalid_items)},
                )
            )
        blocked_only_items = Path(tmp) / "ACTION_ITEMS-blocked-only.md"
        blocked_only_items.write_text(
            "**BLOCKED: AI-102 - wait**\n",
            encoding="utf-8",
        )
        blocked_only_result = run_configured_hook(
            hook,
            payload,
            {"NAVSENTINEL_ACTION_ITEMS": str(blocked_only_items)},
        )
        missing_result = run_configured_hook(
            hook,
            payload,
            {"NAVSENTINEL_ACTION_ITEMS": str(Path(tmp) / "missing.md")},
        )
        malformed_items = Path(tmp) / "ACTION_ITEMS-malformed.md"
        malformed_items.write_bytes(b"\xff")
        malformed_result = run_configured_hook(
            hook,
            payload,
            {"NAVSENTINEL_ACTION_ITEMS": str(malformed_items)},
        )
    if result.returncode != 0:
        raise AssertionError(f"SessionStart failed: {result.stderr}")
    required = (
        "NavSentinel agent context",
        "ACTION_ITEMS.md",
        "OPEN AI-101",
        "BLOCKED AI-102",
        "Resume at AI-101",
        "ns-human-action-guide",
    )
    if any(marker not in result.stdout for marker in required):
        raise AssertionError(
            "SessionStart did not emit the guided human-action context"
        )
    if (
        duplicate_result.returncode != 0
        or "queue INVALID: duplicate AI-101" not in duplicate_result.stdout
    ):
        raise AssertionError(
            "SessionStart silently accepted a duplicate/conflicting AI-N"
        )
    for invalid_result in invalid_cursor_results:
        if (
            invalid_result.returncode != 0
            or "queue INVALID:" not in invalid_result.stdout
            or "Resume at" in invalid_result.stdout
        ):
            raise AssertionError(
                "SessionStart accepted an absent, missing, blocked, or empty-queue cursor"
            )
    if (
        blocked_only_result.returncode != 0
        or "BLOCKED AI-102" not in blocked_only_result.stdout
        or "queue INVALID:" in blocked_only_result.stdout
        or "Resume at" in blocked_only_result.stdout
    ):
        raise AssertionError(
            "SessionStart mishandled an all-blocked queue without a cursor"
        )
    for unreadable_result in (missing_result, malformed_result):
        if (
            unreadable_result.returncode != 0
            or "queue INVALID: cannot read ACTION_ITEMS.md"
            not in unreadable_result.stdout
            or "Resume at" in unreadable_result.stdout
        ):
            raise AssertionError(
                "SessionStart silently accepted an unreadable action register"
            )


def test_guided_action_contract() -> None:
    agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    claude = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    protocol = QUESTION_PROTOCOL.read_text(encoding="utf-8")
    actions = ACTION_ITEMS.read_text(encoding="utf-8")
    handoff = HANDOFF.read_text(encoding="utf-8")

    for name, text in (("AGENTS.md", agents), ("CLAUDE.md", claude)):
        if "ns-human-action-guide" not in text:
            raise AssertionError(f"{name} does not route ns-human-action-guide")
    required_protocol = (
        "## Clarification Mode",
        "## Guided Outstanding-Action Mode",
        "q-N [AI-N]",
        "Resume at: AI-N",
    )
    if any(marker not in protocol for marker in required_protocol):
        raise AssertionError(
            "QUESTION_PROTOCOL.md is missing the guided-action contract"
        )

    action_matches = re.findall(
        r"^\*\*[^\n]*?\b(OPEN|BLOCKED):\s*(AI-\d+)\b",
        actions,
        re.MULTILINE,
    )
    action_ids_in_order = [action_id for _, action_id in action_matches]
    if len(action_ids_in_order) != len(set(action_ids_in_order)):
        raise AssertionError("ACTION_ITEMS contains duplicate/conflicting AI-N entries")
    action_status = {action_id: status for status, action_id in action_matches}
    open_section = re.search(
        r"## Open human items.*?(?=\n## )",
        handoff,
        re.DOTALL,
    )
    if not open_section:
        raise AssertionError("HANDOFF.md has no Open human items section")
    handoff_status: dict[str, str] = {}
    for line in open_section.group(0).splitlines():
        if not line.startswith("- **AI-"):
            continue
        status = "BLOCKED" if "BLOCKED" in line else "OPEN"
        for action_id in re.findall(r"\bAI-\d+\b", line):
            if action_id in handoff_status:
                raise AssertionError(f"HANDOFF contains duplicate {action_id}")
            handoff_status[action_id] = status
    if action_status != handoff_status:
        raise AssertionError(
            "ACTION_ITEMS/HANDOFF human status differs: "
            f"actions={action_status} handoff={handoff_status}"
        )

    cursors = re.findall(r"Guided resolution cursor:\*\*\s*`?(AI-\d+)", actions)
    if len(cursors) != 1 or action_status.get(cursors[0]) != "OPEN":
        raise AssertionError(
            "ACTION_ITEMS guided cursor is missing or not a current OPEN item"
        )


def validate_codex_hooks(hooks_config: dict) -> None:
    if set(hooks_config) != {"hooks"}:
        raise AssertionError("Codex hooks manifest must remain schema-minimal")
    required = {"SessionStart", "PreToolUse", "PostToolUse"}
    configured = set(hooks_config.get("hooks", {}))
    if not required.issubset(configured):
        raise AssertionError(f"Codex hooks missing {sorted(required - configured)}")
    validate_hook_shape(hooks_config)
    for event, entry in iter_hook_entries(hooks_config):
        for hook in entry["hooks"]:
            if not hook.get("commandWindows"):
                raise AssertionError(f"Codex {event} hook needs commandWindows")
    pre = hook_command(hooks_config, "PreToolUse")
    for key in ("command", "commandWindows"):
        command = pre.get(key, "")
        if "--runtime codex" not in command:
            raise AssertionError(
                f"Codex PreToolUse {key} omits Codex runtime semantics"
            )
        if EXPECTED_DISPATCH_SHA256 not in command:
            raise AssertionError(f"Codex PreToolUse {key} does not pin the dispatcher")
        if "git rev-parse" in command:
            raise AssertionError(
                f"Codex PreToolUse {key} permits nested Git-root shadowing"
            )
    if "$HOME/.claude/hooks/dispatch.py" not in pre["command"]:
        raise AssertionError(
            "Codex POSIX floor does not use the shared global dispatcher"
        )
    if ".claude\\hooks\\dispatch.py" not in pre["commandWindows"]:
        raise AssertionError(
            "Codex Windows floor does not use the shared global dispatcher"
        )
    windows_python_guard = (
        "Join-Path $env:SystemRoot 'py.exe'",
        "Test-Path -LiteralPath $p -PathType Leaf",
        "Python launcher is missing",
    )
    if any(marker not in pre["commandWindows"] for marker in windows_python_guard):
        raise AssertionError("Codex Windows floor does not fail closed without Python")
    post_entries = hooks_config["hooks"].get("PostToolUse", [])
    matcher = post_entries[0].get("matcher", "") if post_entries else ""
    if not re.search(matcher, "apply_patch"):
        raise AssertionError("Codex PostToolUse matcher does not include apply_patch")


def test_codex_pre_hook(hooks_config: dict) -> None:
    pre = hook_command(hooks_config, "PreToolUse")
    payload = {
        "hook_event_name": "PreToolUse",
        "tool_name": "Bash",
        "tool_input": {"command": "git push --force origin main"},
        "cwd": str(ROOT),
    }
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        shared = home / ".claude" / "hooks" / "dispatch.py"
        shared.parent.mkdir(parents=True)
        shutil.copyfile(FLOOR_DISPATCH, shared)
        shared_env = {"HOME": str(home), "USERPROFILE": str(home)}

        denied = run_codex_hook(pre, payload, shared_env)
        if denied.returncode != 0 or not is_denied(denied.stdout):
            raise AssertionError(
                f"Codex PreToolUse did not deny force-push: {denied.stderr!r}"
            )

        allowed = run_codex_hook(
            pre,
            {**payload, "tool_input": {"command": "git status --short"}},
            shared_env,
        )
        if allowed.returncode != 0 or is_denied(allowed.stdout):
            raise AssertionError("Codex PreToolUse did not allow a safe Git read")

        t2_allowed = run_codex_hook(
            pre,
            {**payload, "tool_input": {"command": "git reset --hard HEAD~1"}},
            shared_env,
        )
        if t2_allowed.returncode != 0 or is_denied(t2_allowed.stdout):
            raise AssertionError(
                "Codex PreToolUse changed the declared T2 work-loss posture"
            )

        nested = home / "nested-repository"
        (nested / ".git").mkdir(parents=True)
        nested_dispatcher = nested / ".claude" / "hooks" / "dispatch.py"
        nested_dispatcher.parent.mkdir(parents=True)
        nested_dispatcher.write_text("raise SystemExit(0)\n", encoding="utf-8")
        nested_denied = run_codex_hook(pre, payload, shared_env, cwd=nested)
        if nested_denied.returncode != 0 or not is_denied(nested_denied.stdout):
            raise AssertionError("Nested Git state shadowed the shared Codex floor")

        no_home = run_codex_hook(
            pre,
            payload,
            {**shared_env, "HOME": "", "USERPROFILE": ""},
        )
        if no_home.returncode != 2:
            raise AssertionError("Codex PreToolUse did not fail closed without a home")

        if os.name == "nt":
            windows_command = pre["commandWindows"]
            if "Python launcher is missing" not in windows_command:
                raise AssertionError("Codex Windows floor has no missing-Python guard")
        else:
            no_python_env = shared_env.copy()
            no_python_env["PATH"] = str(home / "missing-path")
            no_python = run_codex_hook(pre, payload, no_python_env)
            if no_python.returncode != 2:
                raise AssertionError(
                    "Codex PreToolUse did not fail closed without Python: "
                    f"rc={no_python.returncode} stdout={no_python.stdout!r} "
                    f"stderr={no_python.stderr!r}"
                )

        shared.write_text("# drifted dispatcher\n", encoding="utf-8")
        mismatch = run_codex_hook(pre, payload, shared_env)
        if mismatch.returncode != 2 or "identity mismatch" not in mismatch.stderr:
            raise AssertionError(
                "Codex PreToolUse did not fail closed on dispatcher drift"
            )

        shared.unlink()
        missing = run_codex_hook(pre, payload, shared_env)
        if missing.returncode != 2 or "dispatcher is missing" not in missing.stderr:
            raise AssertionError(
                "Codex PreToolUse did not fail closed when dispatcher is missing"
            )


def test_codex_lifecycle_hooks(hooks_config: dict) -> None:
    session = run_codex_hook(
        hook_command(hooks_config, "SessionStart"),
        {
            "hook_event_name": "SessionStart",
            "source": "startup",
            "cwd": str(ROOT),
        },
    )
    if session.returncode != 0 or "NavSentinel agent context" not in session.stdout:
        raise AssertionError("Codex SessionStart did not emit repository context")
    if (
        "ACTION_ITEMS.md" not in session.stdout
        or "ns-human-action-guide" not in session.stdout
    ):
        raise AssertionError("Codex SessionStart did not emit human-action routing")

    post = run_codex_hook(
        hook_command(hooks_config, "PostToolUse"),
        {
            "hook_event_name": "PostToolUse",
            "tool_name": "apply_patch",
            "tool_input": {
                "command": "*** Begin Patch\n*** Update File: .codex/hooks.json\n*** End Patch"
            },
            "tool_response": {"success": True},
            "cwd": str(ROOT),
        },
    )
    if post.returncode != 0:
        raise AssertionError(f"Codex PostToolUse reminder failed: {post.stderr!r}")
    output = json.loads(post.stdout).get("hookSpecificOutput", {})
    if "agent:hooks:smoke" not in output.get("additionalContext", ""):
        raise AssertionError(
            "Codex apply_patch did not trigger agentic-change reminder"
        )

    failure_hook = hook_command(hooks_config, "PostToolUse", 1)
    root_probe = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import runpy; "
                "data=runpy.run_path(r'scripts/agent_hooks/post_tool_failure.py'); "
                "print(data['ROOT'])"
            ),
        ],
        text=True,
        capture_output=True,
        cwd=ROOT,
        timeout=10,
        check=False,
    )
    nested_probe = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import runpy; "
                f"data=runpy.run_path(r'{ROOT / 'scripts' / 'agent_hooks' / 'post_tool_failure.py'}'); "
                "print(data['ROOT'])"
            ),
        ],
        text=True,
        capture_output=True,
        cwd=ROOT / "scripts",
        timeout=10,
        check=False,
    )
    expected_root = str(ROOT.resolve()).lower()
    if (
        root_probe.stdout.strip().lower() != expected_root
        or nested_probe.stdout.strip().lower() != expected_root
    ):
        raise AssertionError(
            "Codex failure capture is not anchored to the repository root"
        )

    with tempfile.TemporaryDirectory() as tmp:
        ledger = Path(tmp) / "failure_ledger.jsonl"
        failed = run_codex_hook(
            failure_hook,
            {
                "hook_event_name": "PostToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": "echo token=codex-secret"},
                "tool_response": {
                    "metadata": {"exit_code": 1},
                    "error": "Bearer raw-codex-token",
                    "api_key": "structured-api-secret",
                    "nested": {"password": "structured-password"},
                    "headers": {"Set-Cookie": "session=structured-cookie-secret"},
                },
                "cwd": str(ROOT),
            },
            {"NAVSENTINEL_FAILURE_LEDGER": str(ledger)},
        )
        if failed.returncode != 0 or not ledger.exists():
            raise AssertionError(
                f"Codex failure capture did not write: {failed.stderr!r}"
            )
        captured = ledger.read_text(encoding="utf-8")
        leaked = (
            "codex-secret",
            "raw-codex-token",
            "structured-api-secret",
            "structured-password",
            "structured-cookie-secret",
        )
        if any(raw in captured for raw in leaked):
            raise AssertionError("Codex failure capture leaked a raw secret")

        ledger.unlink()
        succeeded = run_codex_hook(
            failure_hook,
            {
                "hook_event_name": "PostToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": "git status --short"},
                "tool_response": {
                    "metadata": {"exit_code": 0},
                    "success": True,
                    "result": {"status": "failed", "error": "application-domain-data"},
                },
                "cwd": str(ROOT),
            },
            {"NAVSENTINEL_FAILURE_LEDGER": str(ledger)},
        )
        if succeeded.returncode != 0 or ledger.exists():
            raise AssertionError("Codex failure capture logged a successful tool call")


def validate_mcp() -> None:
    if not MCP.exists():
        raise AssertionError(".mcp.json is missing")
    data = load_json(MCP)
    servers = data.get("mcpServers")
    if not isinstance(servers, dict) or not servers:
        raise AssertionError(".mcp.json has no mcpServers")
    for name, server in servers.items():
        if server.get("type", "stdio") != "stdio":
            raise AssertionError(f"{name} uses unsupported shared transport")
        if server.get("command") != "cmd":
            raise AssertionError(f"{name} should use cmd for Windows npx stdio launch")
        args = server.get("args", [])
        if args[:3] != ["/c", "npx", "-y"]:
            raise AssertionError(f"{name} should launch with cmd /c npx -y")


def main() -> int:
    settings = load_json(SETTINGS)
    codex_hooks = load_json(CODEX_HOOKS)
    checks = [
        ("settings JSON", lambda: load_json(SETTINGS)),
        ("Codex hooks JSON", lambda: load_json(CODEX_HOOKS)),
        ("MCP JSON", validate_mcp),
        ("hook shape", lambda: validate_hook_shape(settings)),
        ("Codex hook shape", lambda: validate_codex_hooks(codex_hooks)),
        ("deny floor integrity", test_floor_integrity),
        ("deny floor matrix (canonical)", test_floor_matrix),
        (
            "single-floor topology",
            lambda: test_single_floor_topology(settings, codex_hooks),
        ),
        ("PostToolUse alternate worktree path", test_post_tool_use_alt_worktree_path),
        ("guided human-action contract", test_guided_action_contract),
        ("Codex PreToolUse wiring", lambda: test_codex_pre_hook(codex_hooks)),
        (
            "Codex lifecycle wiring",
            lambda: test_codex_lifecycle_hooks(codex_hooks),
        ),
    ]
    if os.name == "nt":
        checks.extend(
            [
                ("PostToolUse context", lambda: test_post_tool_use(settings)),
                (
                    "PostToolUseFailure redaction",
                    lambda: test_post_tool_use_failure(settings),
                ),
                ("SessionStart output", lambda: test_session_start(settings)),
            ]
        )

    failures: list[str] = []
    for name, check in checks:
        try:
            check()
            print(f"ok - {name}")
        except Exception as exc:
            failures.append(f"{name}: {exc}")
            print(f"FAIL - {name}: {exc}", file=sys.stderr)

    if failures:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
