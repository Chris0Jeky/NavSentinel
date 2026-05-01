/**
 * Structural sync test: COMMAND_KEYWORDS in main_guard.ts and
 * clickfix_detector.ts must contain the same entries.
 *
 * These two files cannot share an import because main_guard.ts runs
 * in the MAIN world (no ES module imports) while clickfix_detector.ts
 * runs in the ISOLATED world. This test reads the source files as text
 * and compares the extracted arrays.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function extractKeywords(source: string): string[] {
  // Match the COMMAND_KEYWORDS array literal, allowing multiline
  const match = source.match(
    /const\s+COMMAND_KEYWORDS\s*=\s*\[([\s\S]*?)\];/
  );
  if (!match) throw new Error("COMMAND_KEYWORDS array not found in source");

  const body = match[1]!;
  const keywords: string[] = [];

  // Extract all quoted string entries (single or double quotes)
  for (const m of body.matchAll(/"([^"]*?)"|'([^']*?)'/g)) {
    keywords.push(m[1] ?? m[2]!);
  }

  return keywords;
}

describe("COMMAND_KEYWORDS sync", () => {
  const mainGuardPath = resolve(
    __dirname,
    "..",
    "extension",
    "src",
    "content",
    "main_guard.ts"
  );
  const clickfixPath = resolve(
    __dirname,
    "..",
    "extension",
    "src",
    "content",
    "clickfix_detector.ts"
  );

  const mainGuardSrc = readFileSync(mainGuardPath, "utf-8");
  const clickfixSrc = readFileSync(clickfixPath, "utf-8");

  const mainGuardKw = extractKeywords(mainGuardSrc);
  const clickfixKw = extractKeywords(clickfixSrc);

  it("both files define a non-empty COMMAND_KEYWORDS array", () => {
    expect(mainGuardKw.length).toBeGreaterThan(0);
    expect(clickfixKw.length).toBeGreaterThan(0);
  });

  it("main_guard.ts and clickfix_detector.ts have the same keywords (order-independent)", () => {
    const mainSet = new Set(mainGuardKw);
    const clickfixSet = new Set(clickfixKw);

    const onlyInMainGuard = mainGuardKw.filter((k) => !clickfixSet.has(k));
    const onlyInClickfix = clickfixKw.filter((k) => !mainSet.has(k));

    expect(onlyInMainGuard).toEqual([]);
    expect(onlyInClickfix).toEqual([]);
    expect(mainSet.size).toBe(clickfixSet.size);
  });
});
