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


def patch_provenance() -> None:
    target = ROOT / "tests/e2e/extension_build_provenance.ts"

    replace_once(
        target,
        '''const EXPECTED_VITE_CONFIG = "vite.config.ts";
const VITE_CONFIG_CANDIDATES = [''',
        '''const EXPECTED_VITE_CONFIG = "vite.config.ts";
const VITE_PROJECT_ROOT = "extension";
const VITE_CONFIG_CANDIDATES = [''',
        "Vite project root declaration",
    )

    replace_once(
        target,
        "const POSTCSS_CONFIG_PATHS = new Set<string>(POSTCSS_CONFIG_CANDIDATES);",
        '''const POSTCSS_CONFIG_PATHS = new Set<string>([
  ...POSTCSS_CONFIG_CANDIDATES,
  ...POSTCSS_CONFIG_CANDIDATES.map(
    (candidate) => `${VITE_PROJECT_ROOT}/${candidate}`,
  ),
]);''',
        "two-root PostCSS candidate set",
    )

    replace_once(
        target,
        '''    assertContainedDirectPath(authority.root, absolutePath, relativePath);

    if (relativePath === FIXED_OUTPUT_RELATIVE_PATH) {''',
        '''    assertContainedDirectPath(authority.root, absolutePath, relativePath);

    if (POSTCSS_CONFIG_PATHS.has(relativePath)) {
      throw integrityError(
        "AUTO_DISCOVERED_POSTCSS_CONFIG",
        `auto-discovered PostCSS configuration '${relativePath}' is not allowed`,
      );
    }

    if (relativePath === FIXED_OUTPUT_RELATIVE_PATH) {''',
        "recursive PostCSS rejection",
    )


def patch_docs() -> None:
    raw_authority = ROOT / "docs/security-program/RAW_EVIDENCE_AUTHORITY_684.md"
    replace_once(
        raw_authority,
        '''The build-input verifier rejects every supported root PostCSS configuration
candidate (`.postcssrc*` and `postcss.config.*`) because this release build has
no declared PostCSS configuration.''',
        '''The build-input verifier rejects every supported PostCSS configuration
candidate (`.postcssrc*` and `postcss.config.*`) at both the repository root
and the committed Vite project root `extension/`, because this release build
has no declared PostCSS configuration.''',
        "raw authority PostCSS boundary",
    )

    campaign = ROOT / "docs/security-program/STATE_AUTHORITY_CAMPAIGN.md"
    replace_once(
        campaign,
        '''The external verifier requires the trusted run's manifest SHA-256 before it will
parse or accept the retained set.''',
        '''Because the committed Vite project root is `extension/`, build authority rejects
every supported `.postcssrc*` and `postcss.config.*` candidate at both the
repository root and `extension/`, whether tracked or untracked.

The external verifier requires the trusted run's manifest SHA-256 before it will
parse or accept the retained set.''',
        "campaign Vite-root PostCSS boundary",
    )


def main() -> None:
    patch_provenance()
    patch_docs()
    print("Issue #684 Vite-root PostCSS repair materialized.")


if __name__ == "__main__":
    main()
