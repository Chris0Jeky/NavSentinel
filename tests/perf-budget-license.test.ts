import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { it } from "vitest";

const checker = resolve("scripts/check-perf-budget.mjs");
const license = readFileSync("LICENSE", "utf8").replace(/\r\n?/g, "\n");
const chunks = ["capture_isolated.ts", "main_guard.ts", "credential_guard.ts", "sw.ts", "storage",
  "popup.html", "options.html", "oauth_monitor", "domain_profile", "behavioural_reset", "ui_toast"];
const limit = 540 * 1024;

// Execute the actual CLI in a synthetic build tree. The aggregate boundary is
// exact bytes, including files outside the individually measured chunks.
for (const ending of ["LF", "CRLF"]) {
  for (const builtLicense of ["absent", "foreign", "GPL", "CRLF", "oversized"]) {
    for (const excess of [0, 1]) {
      it(`projects packaged LICENSE with ${ending} root, ${builtLicense} build, ${excess} excess bytes`, () => {
        const root = mkdtempSync(join(tmpdir(), "ns-perf-license-"));
        try {
          mkdirSync(join(root, "scripts"));
          const script = join(root, "scripts/check-perf-budget.mjs");
          copyFileSync(checker, script);
          const rootText = ending === "CRLF" ? license.replace(/\n/g, "\r\n") : license;
          writeFileSync(join(root, "LICENSE"), rootText);
          const dist = join(root, "extension/dist");
          mkdirSync(join(dist, "assets"), { recursive: true });
          for (const name of chunks) writeFileSync(join(dist, "assets", `${name}-fixture.js`), "x");
          mkdirSync(join(dist, "nested"));
          writeFileSync(join(dist, "nested/padding.bin"), Buffer.alloc(limit - Buffer.byteLength(license) - chunks.length + excess));
          const destination = join(dist, "LICENSE");
          if (builtLicense !== "absent") writeFileSync(destination,
            builtLicense === "foreign" ? "MIT\n" : builtLicense === "oversized" ? "x".repeat(100000) :
              builtLicense === "CRLF" ? license.replace(/\n/g, "\r\n") : license);
          const before = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 10000 });
          assert.ifError(before.error);
          assert.equal(before.signal, null);
          assert.equal(before.stderr, "");
          assert.equal(before.status, excess ? 1 : 0, before.stdout);
          assert.doesNotMatch(before.stdout, /\sMISS$/m);
          // Model package.mjs's exact LF-normalized replacement, not a new
          // build or a budget increase. The report must be invariant to it.
          writeFileSync(destination, license);
          const after = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 10000 });
          assert.ifError(after.error);
          assert.equal(after.signal, null);
          assert.equal(after.stderr, "");
          assert.equal(after.status, before.status, after.stdout);
          assert.equal(after.stdout, before.stdout);
          assert.equal(readFileSync(join(root, "LICENSE"), "utf8"), rootText);
        } finally { rmSync(root, { recursive: true, force: true }); }
      });
    }
  }
}

for (const builtLicense of ["MIT\n", license]) {
  it(`refuses a missing root LICENSE even when dist has ${Buffer.byteLength(builtLicense)} license bytes`, () => {
    const root = mkdtempSync(join(tmpdir(), "ns-perf-no-root-license-"));
    try {
      mkdirSync(join(root, "scripts"));
      const script = join(root, "scripts/check-perf-budget.mjs");
      copyFileSync(checker, script);
      const dist = join(root, "extension/dist");
      mkdirSync(join(dist, "assets"), { recursive: true });
      for (const name of chunks) writeFileSync(join(dist, "assets", `${name}-fixture.js`), "x");
      writeFileSync(join(dist, "LICENSE"), builtLicense);
      const result = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 10000 });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /ENOENT/);
      assert.doesNotMatch(result.stdout, /All 12 budgets pass/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
