import { describe, expect, it } from "vitest";
import {
  checkDomain,
  createFilter,
  insertDomain,
  loadFilter,
  MAX_HASH_FUNCTIONS,
  optimalParams,
  serializeFilter,
} from "../extension/src/shared/reputation";

describe("optimalParams obeys the runtime probe budget (#862)", () => {
  it.each([
    [1, 1e-10],
    [100, 1e-20],
    [1000, 1e-100],
  ])("keeps direct and serialized round trips usable for n=%s, p=%s", (n, p) => {
    const params = optimalParams(n, p);
    expect(params.k).toBe(MAX_HASH_FUNCTIONS);
    const filter = createFilter(params.m, params.k);
    insertDomain(filter, "sample.example");
    expect(checkDomain(filter, "sample.example")).toBe(true);
    const loaded = loadFilter(serializeFilter(filter));
    expect(checkDomain(loaded, "sample.example")).toBe(true);
  });

  it("preserves parameters for an ordinary target below the probe cap", () => {
    const n = 10_000;
    const p = 0.0001;
    const m = Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2));
    const k = Math.round((m / n) * Math.LN2);
    expect(k).toBeLessThan(MAX_HASH_FUNCTIONS);
    expect(optimalParams(n, p)).toEqual({ m, k });
  });
});
