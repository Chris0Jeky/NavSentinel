import { describe, expect, it } from "vitest";
// Importing the build script must NOT trigger its network fetch — main() is guarded
// to run only when the script is invoked directly. (#322 / disc#15)
import { parsePSL, assertEnoughRules, MIN_PSL_RULES } from "../scripts/update-psl.mjs";

describe("update-psl build script: fail-closed on short rule sets (#322 / disc#15)", () => {
  it("parsePSL('') yields an empty rule set (the truncated-/empty-body case)", () => {
    expect(parsePSL("")).toEqual([]);
  });

  it("assertEnoughRules throws on an empty rule set", () => {
    expect(() => assertEnoughRules([])).toThrow(/too short/i);
  });

  it("assertEnoughRules throws on a truncated parse (tiny body)", () => {
    const rules = parsePSL("// comment\ncom\norg\nnet\n");
    expect(rules.length).toBeLessThan(MIN_PSL_RULES);
    // Pre-fix: main() had no such guard and would buildTrie([])/short -> overwrite
    // psl_data.json with a near-empty trie. Now it fails closed before writing.
    expect(() => assertEnoughRules(rules)).toThrow(/too short/i);
  });

  it("assertEnoughRules throws on a non-array", () => {
    expect(() => assertEnoughRules(null)).toThrow();
    expect(() => assertEnoughRules(undefined)).toThrow();
  });

  it("assertEnoughRules passes for a full-size rule set", () => {
    const rules = Array.from({ length: MIN_PSL_RULES }, (_, i) => ({
      type: "exact",
      labels: [`tld${i}`],
    }));
    expect(() => assertEnoughRules(rules)).not.toThrow();
  });

  it("parsePSL parses exact / wildcard / exception rule types", () => {
    const rules = parsePSL("com\n*.ck\n!www.ck\n");
    expect(rules).toContainEqual({ type: "exact", labels: ["com"] });
    expect(rules).toContainEqual({ type: "wildcard", labels: ["ck"] });
    expect(rules).toContainEqual({ type: "exception", labels: ["ck", "www"] });
  });
});
