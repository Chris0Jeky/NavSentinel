import { describe, expect, it } from "vitest";
// Importing must NOT stat/read the committed file — main() is guarded. (#322 / disc#11)
import { validateBloomBinary } from "../scripts/check-bloom-size.mjs";

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

describe("check-bloom-size: header validation (#322 / disc#11)", () => {
  it("accepts a structurally valid filter (matches the committed 52-byte shape)", () => {
    expect(validateBloomBinary(makeBin({ m: 288, k: 13 }))).toEqual({ m: 288, k: 13 });
  });

  it("rejects a zeroed/corrupt file (bad magic) — the core disc#11 case", () => {
    // A zeroed file passes a bare size check but is non-functional at runtime.
    expect(() => validateBloomBinary(new Uint8Array(52))).toThrow(/magic/i);
  });

  it("rejects a wrong version", () => {
    expect(() => validateBloomBinary(makeBin({ version: 2 }))).toThrow(/version/i);
  });

  it("rejects a degenerate k=0", () => {
    expect(() => validateBloomBinary(makeBin({ k: 0 }))).toThrow(/k=0|degenerate/i);
  });

  it("rejects a sub-byte degenerate m", () => {
    expect(() => validateBloomBinary(makeBin({ m: 5 }))).toThrow(/m=5|degenerate/i);
  });

  it("rejects a truncated file (size does not match header m)", () => {
    // header says m=288 (=> 52 bytes) but the file is shorter
    expect(() => validateBloomBinary(makeBin({ m: 288, dataBytes: 4 }))).toThrow(/mismatch|truncat/i);
  });

  it("rejects trailing garbage (size larger than header m)", () => {
    // header says m=288 (=> 52 bytes) but the file has an extra byte (53)
    expect(() => validateBloomBinary(makeBin({ m: 288, dataBytes: 37 }))).toThrow(/mismatch|trailing/i);
  });

  it("rejects k above the runtime safety cap (parity with loadFilter)", () => {
    expect(() => validateBloomBinary(makeBin({ k: 31 }))).toThrow(/safety cap/i);
  });

  it("rejects m above the runtime safety cap (parity with loadFilter)", () => {
    // m far beyond 16 Mbit; use a tiny dataBytes so we don't allocate a huge buffer,
    // and let the size-mismatch/cap check fire (the m-cap check runs before the size check).
    expect(() => validateBloomBinary(makeBin({ m: 20 * 1024 * 1024, dataBytes: 4 }))).toThrow(/safety cap/i);
  });

  it("rejects a buffer too small for the header", () => {
    expect(() => validateBloomBinary(new Uint8Array(8))).toThrow(/header|too small/i);
  });
});
