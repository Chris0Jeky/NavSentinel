import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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

describe("top-sites build script", () => {
  it("resolves explicit paths from cwd and parses quoted CSV fields", () => {
    const dir = makeTempDir();
    const scriptPath = resolve("scripts/build-topsites-tier.mjs");
    writeInput(dir, [
      "domain,tier,source,category,include_subdomains",
      "Example.COM.,2,\"seed, quoted\",reference,true",
      "tenant.example,2,seed,hosting,false",
      "ignored.example,3,seed,reference,false",
    ]);

    execFileSync(process.execPath, [scriptPath, "input.csv", "out.ts"], {
      cwd: dir,
      stdio: "pipe",
    });
    execFileSync(process.execPath, [scriptPath, "--check", "input.csv", "out.ts"], {
      cwd: dir,
      stdio: "pipe",
    });

    const generated = readFileSync(join(dir, "out.ts"), "utf8");
    expect(generated).toContain("{ domain: \"example.com\", includeSubdomains: true }");
    expect(generated).not.toContain("tenant.example");
    expect(generated).not.toContain("ignored.example");
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
});
