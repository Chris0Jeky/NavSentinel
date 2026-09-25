import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
// The production builder is import-safe: main() is guarded to run only when
// invoked directly, and importing must NOT trigger its threat-feed fetch
// (same guarantee build-bloom-build-script.test.ts relies on). (#322, #805)
import { murmurhash3_32 as prodMurmur } from "../scripts/build-bloom-filter.mjs";
// The test builder gained the same main guard in #805 so importing it no
// longer rewrites the committed asset as a side effect.
// Test-builder script ships without runtime TypeScript declarations.
// @ts-expect-error (see above)
import { TEST_BAD_DOMAINS, murmurhash3_32 as testMurmur } from "../scripts/build-test-bloom-filter.mjs";
import {
  checkDomain,
  loadFilter,
  murmurhash3_32 as runtimeMurmur,
} from "../extension/src/shared/reputation";

describe("bloom murmur3 copies agree across runtime and builders (#805)", () => {
  // Regression pin for the three unlinked murmurhash3_32 copies (runtime +
  // two builders): existing murmur tests only assert self-consistency, so a
  // drift in any copy would pass them while silently breaking reputation
  // (build inserts with hash A, runtime checks with hash B -> systematic
  // false negatives with reputationReady() still true).
  const keys = [
    "",
    "a",
    "ab",
    "abc",
    "abcd",
    "abcde",
    "test",
    "evil-phishing-test.example",
    "UPPERCASE.EXAMPLE",
    "münchen.de",
    "x".repeat(64),
    "_obj__.proto__",
    ...TEST_BAD_DOMAINS,
  ];
  const seeds = [0, 1, 42, 0x9747b28c, 0xc6a4a793, 0xffffffff];

  it("all three copies produce identical hashes", () => {
    for (const key of keys) {
      for (const seed of seeds) {
        const expected = runtimeMurmur(key, seed);
        expect(prodMurmur(key, seed)).toBe(expected);
        expect(testMurmur(key, seed)).toBe(expected);
      }
    }
  });

  it("the committed test filter round-trips through the runtime loader", () => {
    // End-to-end pin of builder->runtime agreement (hash + seeds + h2-odd +
    // modulo + bit layout + endianness + header): every fixture domain the
    // test builder inserted must check true via the runtime path.
    expect(TEST_BAD_DOMAINS.length).toBeGreaterThan(0);
    const bytes = new Uint8Array(readFileSync("extension/public/reputation_data.bin"));
    const filter = loadFilter(bytes);
    for (const domain of TEST_BAD_DOMAINS) {
      expect(checkDomain(filter, domain)).toBe(true);
    }
    expect(checkDomain(filter, "definitely-not-inserted-xyz123.com")).toBe(false);
    expect(checkDomain(filter, "google.com")).toBe(false);
  });

  it("importing the test builder does not rewrite the committed asset", () => {
    // Pre-guard, merely importing the module rewrote reputation_data.bin (the
    // static import at the top of this file would already have done it). Prove
    // the guard in a fresh process: import, then confirm the asset is untouched.
    const asset = "extension/public/reputation_data.bin";
    const before = statSync(asset).mtimeMs;
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", "await import('./scripts/build-test-bloom-filter.mjs');"],
      { stdio: "pipe" },
    );
    expect(statSync(asset).mtimeMs).toBe(before);
  });
});
