#!/usr/bin/env python3
"""Validate local Claude and Codex skill metadata and parity."""
from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def parse_frontmatter(path: Path) -> dict[str, str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("missing frontmatter")
    data: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return data
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip().strip('"')
    raise ValueError("unterminated frontmatter")


def validate_tree(base: Path) -> tuple[set[str], list[str]]:
    names: set[str] = set()
    errors: list[str] = []
    for skill_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        skill = skill_dir / "SKILL.md"
        if not skill.exists():
            errors.append(f"{skill_dir}: missing SKILL.md")
            continue
        names.add(skill_dir.name)
        text = skill.read_text(encoding="utf-8")
        try:
            frontmatter = parse_frontmatter(skill)
        except ValueError as exc:
            errors.append(f"{skill}: {exc}")
            continue
        if frontmatter.get("name") != skill_dir.name:
            errors.append(f"{skill}: name does not match directory")
        if not frontmatter.get("description"):
            errors.append(f"{skill}: missing description")
    return names, errors


def main() -> int:
    claude_names, claude_errors = validate_tree(ROOT / ".claude" / "skills")
    codex_names, codex_errors = validate_tree(ROOT / ".agents" / "skills")

    expected_claude_only = {"ns-claude-tooling"}
    expected_codex_only = {"ns-codex-tooling"}
    shared_claude = claude_names - expected_claude_only
    shared_codex = codex_names - expected_codex_only

    errors = claude_errors + codex_errors
    if shared_claude != shared_codex:
        errors.append(
            "shared skill names differ: "
            f"claude_only={sorted(shared_claude - shared_codex)} "
            f"codex_only={sorted(shared_codex - shared_claude)}"
        )
    if claude_names - shared_claude != expected_claude_only:
        errors.append("unexpected Claude runtime-specific skills")
    if codex_names - shared_codex != expected_codex_only:
        errors.append("unexpected Codex runtime-specific skills")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(
        f"Validated {len(claude_names)} Claude skills and {len(codex_names)} Codex skills; "
        f"{len(shared_claude)} shared workflows are aligned."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
