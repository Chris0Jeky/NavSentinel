import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

/**
 * Scripts on the release path. `scripts/release.mjs` shipped an unparseable
 * raw-newline-in-string-literal syntax error that went undetected for months
 * because nothing in CI or tests ever ran OR parsed it (0 releases ever — the
 * literal reason the release path "never produced a release"). `node --check`
 * parses a module without executing it, so it is a cheap, side-effect-free
 * guard against a broken release/build script slipping in again. (#321 / #415)
 */
const RELEASE_PATH_SCRIPTS = [
  "scripts/release.mjs",
  "scripts/package.mjs",
  "scripts/check-bloom-real.mjs",
  "scripts/check-bloom-size.mjs",
  "scripts/build-bloom-filter.mjs",
  "scripts/build-test-bloom-filter.mjs",
];

describe("release-path scripts parse without syntax errors (#321/#415)", () => {
  for (const rel of RELEASE_PATH_SCRIPTS) {
    it(`node --check ${rel}`, () => {
      expect(() =>
        execFileSync("node", ["--check", path.join(root, rel)], { stdio: "pipe" }),
      ).not.toThrow();
    });
  }
});
