// Checkout-end-of-line hygiene gate (#763).
//
// Raw worktree bytes are intentionally compared with git blobs by the
// provenance tests. Attributes/config changes do not rematerialize existing
// CRLF files, and `git add --renormalize` changes the index, not those bytes.
// Diagnose the checkout without changing files or weakening integrity checks.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Return tracked paths with CRLF separators, including mixed LF/CRLF files. */
export function findCrlfWorktreeFiles(lsFilesOutput) {
  const flagged = [];
  for (const line of lsFilesOutput.split("\n")) {
    // Attributes contain spaces; the first tab separates metadata from the
    // (possibly C-quoted) path. Preserve that path for diagnostics only.
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const headerTokens = line.slice(0, tab).split(/\s+/).filter(Boolean);
    if (headerTokens[1] === "w/crlf" || headerTokens[1] === "w/mixed") {
      flagged.push(line.slice(tab + 1));
    }
  }
  return flagged;
}

export default async function checkoutEolCheck() {
  let flagged;
  try {
    // Anchor to the project containing this module, not the caller's cwd.
    // Git can otherwise inherit a parent repository for a nested source copy,
    // or inspect only a subdirectory when Vitest is launched below the root.
    const projectRoot = realpathSync.native(fileURLToPath(new URL("../", import.meta.url)));
    const options = {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    };
    const checkoutRoot = realpathSync.native(
      execFileSync("git", ["rev-parse", "--show-toplevel"], options).replace(/\r?\n$/, ""),
    );
    if (relative(projectRoot, checkoutRoot) !== "") return;
    const output = execFileSync("git", ["ls-files", "--eol"], options);
    flagged = findCrlfWorktreeFiles(output);
  } catch {
    // A tarball or unavailable Git is not checkout evidence. Leave the real
    // integrity tests authoritative rather than fabricating an LF-clean result.
    return;
  }
  if (flagged.length === 0) return;
  const sample = flagged.slice(0, 5).join("\n  ");
  const more = flagged.length > 5 ? `\n  ... and ${flagged.length - 5} more` : "";
  throw new Error(
    `[NavSentinel] ${flagged.length} tracked file(s) contain CRLF or mixed line endings.\n` +
      `Provenance / state-authority tests compare raw working-tree bytes against ` +
      `LF git blobs by design (RAW_BYTES_MISMATCH).\n` +
      `Preserve this checkout and any local work. Clone into a new directory:\n` +
      `  git -c core.autocrlf=false clone <repository-url> <new-directory>\n` +
      `Reapply saved edits deliberately and verify with git ls-files --eol.\n` +
      `Changing Git configuration or renormalizing the index does not rewrite ` +
      `existing working-tree bytes. See CONTRIBUTING.md (#763).\n` +
      `Flagged:\n  ${sample}${more}`,
  );
}
