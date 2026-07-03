import { describe, expect, it } from "vitest";
// Importing must NOT stat/read the committed file — main() is guarded. (#321 / #322)
import { inspectBloomFilter, MIN_REAL_FILTER_BITS } from "../scripts/check-bloom-real.mjs";

function makeBin(
  opts: { magic?: number; version?: number; k?: number; m?: number; dataBytes?: number } = {},
): Uint8Array {
  const { magic = 0x424c4f4d, version = 1, k = 13, m = 288 } = opts;
  const dataBytes = opts.dataBytes ?? Math.ceil(m / 8);
  const buf = new Uint8Array(16 + dataBytes);
  const view = new DataView(buf.buffer);
  view.setUint32(0, magic, true);
  view.setUint32(4, version, true);
  view.setUint32(8, k, true);
  view.setUint32(12, m, true);
  return buf;
}

describe("check-bloom-real: production-vs-placeholder gate (#321)", () => {
  it("classifies the committed placeholder shape (m=288/306, k=13) as NOT real", () => {
    // This is the 15-domain `.example` test filter shipped on `main` today.
    const info = inspectBloomFilter(makeBin({ m: 288, k: 13 }));
    expect(info.real).toBe(false);
    expect(info.m).toBe(288);
    expect(info.k).toBe(13);
  });

  it("classifies a production-sized filter (m in the millions) as real", () => {
    // ceil(2_000_000/8) data bytes — validateBloomBinary requires an exact size.
    const info = inspectBloomFilter(makeBin({ m: 2_000_000, k: 13 }));
    expect(info.real).toBe(true);
  });

  it("uses m >= floor as the boundary", () => {
    expect(inspectBloomFilter(makeBin({ m: MIN_REAL_FILTER_BITS - 8 })).real).toBe(false);
    expect(inspectBloomFilter(makeBin({ m: MIN_REAL_FILTER_BITS })).real).toBe(true);
  });

  it("propagates header validation (throws on a corrupt/zeroed file, never mis-reports 'real')", () => {
    // A zeroed file must not be silently treated as a valid (real or placeholder) filter.
    expect(() => inspectBloomFilter(new Uint8Array(52))).toThrow(/magic/i);
    expect(() => inspectBloomFilter(new Uint8Array(8))).toThrow(/header|too small/i);
  });

  it("keeps the floor unambiguously between the test stub and any real feed", () => {
    // Guards against a future edit that lowers the floor into placeholder range
    // or raises it above a plausible small production feed.
    expect(MIN_REAL_FILTER_BITS).toBeGreaterThan(1_000); // well above the ~300-bit stub
    expect(MIN_REAL_FILTER_BITS).toBeLessThan(1_000_000); // below a real URLhaus/OpenPhish filter
  });
});
