#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def patch_playwright_configs() -> None:
    for name in (
        "playwright.rollback.config.ts",
        "playwright.live.config.ts",
    ):
        replace_once(
            ROOT / name,
            '  testMatch: "**/*.spec.ts",\n  fullyParallel:',
            '  testMatch: "**/*.spec.ts",\n  testIgnore: "**/state-authority-sink.spec.ts",\n  fullyParallel:',
            f"{name} launcher-only exclusion",
        )


def patch_docs() -> None:
    target = ROOT / "docs/security-program/STATE_AUTHORITY_CAMPAIGN.md"
    replace_once(
        target,
        '''`state-authority-sink.spec.ts` is excluded from ordinary Playwright collection.
It remains available only through `playwright.stress.config.ts` and the committed
launcher, so the default E2E lane neither bypasses the authority boundary nor
fails merely by importing a launcher-only module.''',
        '''`state-authority-sink.spec.ts` is excluded from every broad ordinary
Playwright collection: default, rollback, and live. It remains available only
through `playwright.stress.config.ts` and the committed launcher, so ordinary
E2E lanes neither bypass the authority boundary nor fail merely by importing a
launcher-only module.''',
        "broad Playwright collection boundary",
    )


def main() -> None:
    patch_playwright_configs()
    patch_docs()
    print("Issue #684 broad Playwright boundary repair materialized.")


if __name__ == "__main__":
    main()
