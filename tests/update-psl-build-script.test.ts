import { describe, expect, it } from "vitest";
// Importing the build script must NOT trigger its network fetch — main() is guarded
// to run only when the script is invoked directly. (#322 / disc#15)
import { buildTrie, parsePSL, assertEnoughRules, MIN_PSL_RULES } from "../scripts/update-psl.mjs";

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

  it("compacts endpoint-only nodes without changing wildcard or exception structure", () => {
    expect(buildTrie(parsePSL("com\nco.uk\n*.ck\n!www.ck\n"))).toEqual({
      com: 1,
      uk: { co: 1 },
      ck: { "*": 1, www: { "!": 1 } },
    });
  });
});

describe("update-psl build script: fail-closed on malformed rules (#322 / #18)", () => {
  // A bare "*" does not match the "*." wildcard branch, so pre-fix it parsed as
  // { type: "exact", labels: ["*"] } and buildTrie wrote root["*"][""] = 1 — i.e. a
  // root-level wildcard marking every TLD label a public suffix, silently corrupting
  // registrable-domain computation. The same class of corruption applies to any rule
  // whose labels hit a reserved trie key ("" / "*" / "!") or an empty label.
  it("throws on a bare '*' rule (would become a root-level wildcard)", () => {
    expect(() => parsePSL("*")).toThrow(/Malformed PSL rule/);
  });

  it("throws on a bare '!' rule (empty exception label)", () => {
    expect(() => parsePSL("!")).toThrow(/Malformed PSL rule/);
  });

  it("throws on a '*.' wildcard with no base", () => {
    expect(() => parsePSL("*.")).toThrow(/Malformed PSL rule/);
  });

  it("throws on empty labels from a leading dot, trailing dot, or double dots", () => {
    expect(() => parsePSL(".com")).toThrow(/Malformed PSL rule/);
    expect(() => parsePSL("a..b")).toThrow(/Malformed PSL rule/);
    expect(() => parsePSL("com.")).toThrow(/Malformed PSL rule/); // trailing dot
    expect(() => parsePSL("!www.ck.")).toThrow(/Malformed PSL rule/);
  });

  it("throws on a bare-dot line (all labels empty)", () => {
    expect(() => parsePSL(".")).toThrow(/Malformed PSL rule/);
  });

  it("throws on a stray non-leftmost wildcard label", () => {
    expect(() => parsePSL("foo.*.bar")).toThrow(/Malformed PSL rule/);
  });

  it("throws on a stray-whitespace rule whose first token has an empty label", () => {
    // "a. .b" reads as "a." (PSL: read up to first whitespace) -> trailing empty label.
    expect(() => parsePSL("a. .b")).toThrow(/Malformed PSL rule/);
  });

  it("aborts the whole parse on a poisoned line (no partial trie reaches buildTrie)", () => {
    expect(() => parsePSL("com\norg\n*\nnet")).toThrow(/Malformed PSL rule/);
  });

  it("still accepts well-formed rules unchanged (no false positives)", () => {
    expect(parsePSL("com\n*.ck\n!www.ck\nco.uk\n")).toEqual([
      { type: "exact", labels: ["com"] },
      { type: "wildcard", labels: ["ck"] },
      { type: "exception", labels: ["ck", "www"] },
      { type: "exact", labels: ["uk", "co"] },
    ]);
  });

  it("reads a rule only up to the first whitespace (PSL annotation dropped, not rejected)", () => {
    // Spec behavior: trailing content after whitespace is an annotation, ignored.
    expect(parsePSL("com    trailing annotation")).toEqual([
      { type: "exact", labels: ["com"] },
    ]);
  });

  it("accepts genuine Unicode (IDN U-label) rules — must NOT ASCII-charset-filter", () => {
    // The real PSL lists IDN rules in Unicode (U-label) form; an ASCII-only filter would
    // reject ~1k valid labels and break update:psl. Reserved/empty labels are the only
    // structural corruption the guard targets. (#337 review)
    expect(parsePSL("公司.cn\nみんな\nامارات\n")).toEqual([
      { type: "exact", labels: ["cn", "公司"] },
      { type: "exact", labels: ["みんな"] },
      { type: "exact", labels: ["امارات"] },
    ]);
  });
});
