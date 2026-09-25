import { describe, expect, it } from "vitest";
import {
  checkDomain,
  createFilter,
  insertDomain,
  MAX_HASH_FUNCTIONS,
} from "../extension/src/shared/reputation";

// Bound the regression itself: a reverted cap must fail promptly rather than
// burn CPU for a huge finite k. Saturated bits prevent checkDomain from hiding
// the defect by returning false on its first probe.
function boundedBits(fill: number) {
  const raw = new Uint8Array(128).fill(fill);
  let reads = 0;
  let writes = 0;
  const isIndex = (key: string | symbol) => typeof key === "string" && /^\d+$/.test(key);
  const bits = new Proxy(raw, {
    get(target, key) {
      if (isIndex(key) && ++reads > MAX_HASH_FUNCTIONS) {
        throw new Error("probe budget exceeded");
      }
      return Reflect.get(target, key, target);
    },
    set(target, key, value) {
      if (isIndex(key) && ++writes > MAX_HASH_FUNCTIONS) {
        throw new Error("write budget exceeded");
      }
      return Reflect.set(target, key, value, target);
    },
  });
  return { bits, raw, counts: () => ({ reads, writes }) };
}

describe("direct-filter probe budget (follow-up to #806)", () => {
  it.each([
    MAX_HASH_FUNCTIONS + 1,
    1e6,
    Number.MAX_SAFE_INTEGER,
    1e100,
    Number.MAX_VALUE,
  ])("rejects k=%s before any bit reads or writes", (k) => {
    const lookup = boundedBits(0xff);
    expect(checkDomain({ bits: lookup.bits, m: 1024, k }, "sample.example")).toBe(false);
    expect(lookup.counts()).toEqual({ reads: 0, writes: 0 });
    const insertion = boundedBits(0);
    insertDomain({ bits: insertion.bits, m: 1024, k }, "sample.example");
    expect(insertion.counts()).toEqual({ reads: 0, writes: 0 });
    expect(insertion.raw.every((value) => value === 0)).toBe(true);
  });

  it.each([1, MAX_HASH_FUNCTIONS])("preserves valid insertion and lookup at k=%s", (k) => {
    const filter = createFilter(1024, k);
    insertDomain(filter, "sample.example");
    expect(checkDomain(filter, "sample.example")).toBe(true);
  });
});
