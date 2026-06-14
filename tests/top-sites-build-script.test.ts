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

describe("top-sites build script", () => {
  it("resolves explicit paths from cwd and parses quoted CSV fields", () => {
    const dir = makeTempDir();
    const scriptPath = resolve("scripts/build-topsites-tier.mjs");
    writeFileSync(
      join(dir, "input.csv"),
      [
        "domain,tier,source,category",
        "Example.COM.,2,\"seed, quoted\",reference",
        "tenant.example,2,seed,hosting",
        "ignored.example,3,seed,reference",
      ].join("\n"),
      "utf8"
    );

    execFileSync(process.execPath, [scriptPath, "input.csv", "out.ts"], {
      cwd: dir,
      stdio: "pipe",
    });
    execFileSync(process.execPath, [scriptPath, "--check", "input.csv", "out.ts"], {
      cwd: dir,
      stdio: "pipe",
    });

    const generated = readFileSync(join(dir, "out.ts"), "utf8");
    expect(generated).toContain("\"example.com\"");
    expect(generated).not.toContain("tenant.example");
    expect(generated).not.toContain("ignored.example");
  });
});
