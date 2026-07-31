import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareTopSiteDomains } from "../scripts/build-topsites-tier.mjs";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navsentinel-topsites-"));
  tempDirs.push(dir);
  return dir;
}

function writeInput(dir: string, lines: string[]): void {
  writeFileSync(join(dir, "input.csv"), lines.join("\n"), "utf8");
}

function runScript(dir: string): void {
  execFileSync(process.execPath, [resolve("scripts/build-topsites-tier.mjs"), "input.csv", "out.ts"], {
    cwd: dir,
    stdio: "pipe",
  });
}

function runCheck(dir: string): void {
  execFileSync(process.execPath, [resolve("scripts/build-topsites-tier.mjs"), "--check", "input.csv", "out.ts"], {
    cwd: dir,
    stdio: "pipe",
  });
}

describe("top-sites build script", () => {
  it("resolves explicit paths from cwd and parses quoted CSV fields", () => {
    const dir = makeTempDir();
    writeInput(dir, [
      "domain,tier,source,category,include_subdomains",
      "Example.COM.,2,\"seed, quoted\",reference,true",
      "tenant.example,2,seed,hosting,false",
      "ignored.example,3,seed,reference,false",
    ]);

    runScript(dir);
    runCheck(dir);

    const generated = readFileSync(join(dir, "out.ts"), "utf8");
    expect(generated).toContain("{ domain: \"example.com\", includeSubdomains: true }");
    expect(generated).not.toContain("tenant.example");
    expect(generated).not.toContain("ignored.example");
  });

  it("accepts current generated content with LF or CRLF, but rejects stale output", () => {
    const dir = makeTempDir();
    writeInput(dir, [
      "domain,tier,source,category",
      "example.com,2,seed,reference",
    ]);

    runScript(dir);
    runCheck(dir); // Current LF output.

    const outputPath = join(dir, "out.ts");
    const generated = readFileSync(outputPath, "utf8");
    writeFileSync(outputPath, generated.replace(/\n/g, "\r\n"), "utf8");
    runCheck(dir); // Equivalent Windows CRLF checkout.

    writeFileSync(outputPath, `${generated}// stale\n`, "utf8");
    expect(() => runCheck(dir)).toThrow(/out\.ts is stale/);
  });

  it("rejects missing row fields and unsupported categories", () => {
    const missingCategoryDir = makeTempDir();
    writeInput(missingCategoryDir, [
      "domain,tier,source,category",
      "example.com,2,seed",
    ]);
    expect(() => runScript(missingCategoryDir)).toThrow(/CSV row has 3 columns, expected 4/);

    const unknownCategoryDir = makeTempDir();
    writeInput(unknownCategoryDir, [
      "domain,tier,source,category",
      "example.com,2,seed,hostng",
    ]);
    expect(() => runScript(unknownCategoryDir)).toThrow(/Unsupported category/);

    const extraColumnDir = makeTempDir();
    writeInput(extraColumnDir, [
      "domain,tier,source,category",
      "example.com,2,seed,reference,extra",
    ]);
    expect(() => runScript(extraColumnDir)).toThrow(/CSV row has 5 columns, expected 4/);
  });

  it("fails closed on duplicate domains instead of OR-merging includeSubdomains", () => {
    const dir = makeTempDir();
    writeInput(dir, [
      "domain,tier,source,category,include_subdomains",
      "github.com,2,seed,developer,false",
      "github.com,2,seed,developer,true",
    ]);
    expect(() => runScript(dir)).toThrow(/Duplicate domain in seed: github\.com/);
  });
});

// The locale-explicit hazard proof below needs full ICU data (Estonian / Lithuanian
// collation). Node 13+ official builds and the project's CI ship full-icu; a custom
// small-icu build silently falls back to code-unit collation for unknown locale tags,
// which would flip those assertions and fail them for the wrong reason. Detect full ICU
// (the locale resolves to itself, not to a fallback) and run the hazard proof only when
// available — the locale-independent code-unit pins and the runtime invariant guard run
// everywhere regardless. (#335 review)
const HAS_FULL_ICU =
  new Intl.Collator("et").resolvedOptions().locale === "et" &&
  new Intl.Collator("lt").resolvedOptions().locale === "lt";

describe("compareTopSiteDomains — runtime binary-search sort parity (#322 / disc#17)", () => {
  // The runtime consumer (top_sites.ts findTopSiteEntry) binary-searches the generated
  // array with `candidate.domain < domain`, i.e. UTF-16 code-unit order. The build MUST
  // sort with the same comparison. localeCompare is host-locale-dependent and would
  // diverge under some locales, leaving the array out of order for the `<` search so a
  // present top-site domain becomes unfindable (trust tier silently lost).
  it.runIf(HAS_FULL_ICU)(
    "diverges from host-locale collation: localeCompare and compareTopSiteDomains order the same pairs oppositely",
    () => {
      // Self-contained hazard proof: for the SAME pair, the host-locale collation and the
      // build comparator disagree. Estonian collates "z" before "t" and Lithuanian "y"
      // before "k" (opposite to code units), so a build that sorted with localeCompare
      // would mis-order these; compareTopSiteDomains stays code-unit consistent.
      expect("zebra.com".localeCompare("tea.com", "et")).toBeLessThan(0); // et: z < t
      expect(compareTopSiteDomains("zebra.com", "tea.com")).toBeGreaterThan(0); // code unit: t < z
      expect("yahoo.com".localeCompare("kite.com", "lt")).toBeLessThan(0); // lt: y < k
      expect(compareTopSiteDomains("yahoo.com", "kite.com")).toBeGreaterThan(0); // code unit: k < y
    },
  );

  it("orders strictly by UTF-16 code unit, independent of host locale", () => {
    // Code-unit order: t(0x74) < z(0x7A), k(0x6B) < y(0x79).
    expect(compareTopSiteDomains("zebra.com", "tea.com")).toBeGreaterThan(0);
    expect(compareTopSiteDomains("yahoo.com", "kite.com")).toBeGreaterThan(0);
    expect(compareTopSiteDomains("apple.com", "apple.com")).toBe(0);
    expect(compareTopSiteDomains("a.com", "b.com")).toBeLessThan(0);
  });

  it("produces an array a `<` binary search can traverse", () => {
    const sorted = ["zebra.com", "tea.com", "apple.com", "yahoo.com", "kite.com"]
      .slice()
      .sort(compareTopSiteDomains);
    for (let i = 1; i < sorted.length; i += 1) {
      // Strictly ascending under the exact comparison findTopSiteEntry uses.
      expect(sorted[i - 1]! < sorted[i]!).toBe(true);
    }
  });
});
