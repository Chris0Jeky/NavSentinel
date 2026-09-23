// Checkout-end-of-line hygiene gate (#763).
//
// The provenance / state-authority / release-integrity tests compare raw
// working-tree bytes against git blobs BY DESIGN (a CRLF materialization of
// an LF blob is a real, deliberate RAW_BYTES_MISMATCH rejection — see the
// `rejects clean LF blobs materialized as CRLF` test). That means Windows
// checkouts must materialize LF bytes, which requires core.autocrlf=false:
// `eol=lf` attributes are not retroactive on existing working-tree files.
//
// This module is wired as a vitest globalSetup so a CRLF checkout fails fast
// with actionable text instead of surfacing as two dozen confusing
// RAW_BYTES_MISMATCH failures deep in the suite.

import { execFileSync } from "node:child_process";

/**
 * Parse `git ls-files --eol` output and return the paths whose working-tree
 * bytes are CRLF. Pure (no git I/O) so it is directly unit-testable.
 */
export function findCrlfWorktreeFiles(lsFilesOutput) {
  const flagged = [];
  for (const line of lsFilesOutput.split("\n")) {
    // Format: `<index-eol> <worktree-eol> <attrs> <tab> <path>`, e.g.
    // `i/lf    w/crlf  attr/text=auto eol=lf \tREADME.md`. The path is
    // tab-separated and the attrs column itself contains spaces, so split
    // on the tab first; only the header's second token is consulted, so
    // C-quoted paths with spaces cannot confuse it.
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const headerTokens = line.slice(0, tab).split(/\s+/).filter(Boolean);
    if (headerTokens[1] === "w/crlf") {
      flagged.push(line.slice(tab + 1));
    }
  }
  return flagged;
}

function countCrlfWorktreeFiles() {
  const output = execFileSync("git", ["ls-files", "--eol"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return findCrlfWorktreeFiles(output);
}

export default async function checkoutEolCheck() {
  let flagged;
  try {
    flagged = countCrlfWorktreeFiles();
  } catch {
    // Not a git checkout (tarball/CI artifact) or git unavailable: nothing
    // to enforce, and this gate must never mask the real suite result.
    return;
  }
  if (flagged.length === 0) return;
  const sample = flagged.slice(0, 5).join("\n  ");
  const more = flagged.length > 5 ? `\n  ... and ${flagged.length - 5} more` : "";
  throw new Error(
    `[NavSentinel] ${flagged.length} tracked file(s) are checked out as CRLF, ` +
      `but the provenance / state-authority tests compare raw working-tree bytes ` +
      `against LF git blobs by design and will fail with RAW_BYTES_MISMATCH.\n` +
      `Windows checkouts must materialize LF bytes:\n` +
      `  git config core.autocrlf false\n` +
      `  git add --renormalize .\n` +
      `(or clone fresh with core.autocrlf=false). See CONTRIBUTING.md (#763).\n` +
      `Flagged:\n  ${sample}${more}`,
  );
}
