import { describe, expect, it } from "vitest";
import { murmurhash3_32 } from "../extension/src/shared/reputation";

// Degenerate-size loadFilter rejections (m=1, k=0, oversize m) are already
// pinned in tests/reputation.test.ts and tests/reputation-property.test.ts,
// so they are intentionally not duplicated here. This file pins only the
// missing golden equality: existing murmur tests assert self-consistency and
// cross-copy agreement, never a fixed reference value.
describe("reputation filter bounds (missing pins)", () => {
  it("murmurhash3_32 golden: empty key with seed 0 hashes to 0", () => {
    expect(murmurhash3_32("", 0)).toBe(0);
  });
});
