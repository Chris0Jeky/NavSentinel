import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  computeAHash,
  computeBHash,
  hammingDistance,
} from "../extension/src/shared/visual_sim_hash";

const arbHash8 = fc.uint8Array({ minLength: 8, maxLength: 8 });
const arbHashN = fc.integer({ min: 1, max: 64 }).chain((n) =>
  fc.uint8Array({ minLength: n, maxLength: n })
);

function makeRGBA(width: number, height: number, grayscale: Uint8Array): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = grayscale[i] ?? 0;
    pixels[i * 4] = v;
    pixels[i * 4 + 1] = v;
    pixels[i * 4 + 2] = v;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

const arbAHashInput = fc.uint8Array({ minLength: 64, maxLength: 64 }).map((gray) =>
  makeRGBA(8, 8, gray)
);

const arbAHashColorInput = fc.uint8Array({ minLength: 8 * 8 * 4, maxLength: 8 * 8 * 4 }).map(
  (raw) => {
    const pixels = new Uint8ClampedArray(raw);
    for (let i = 0; i < 64; i++) pixels[i * 4 + 3] = 255;
    return pixels;
  }
);

const arbBHashInput = fc.uint8Array({ minLength: 256, maxLength: 256 }).map((gray) =>
  makeRGBA(16, 16, gray)
);

describe("hammingDistance properties", () => {
  it("identity: hammingDistance(a, a) === 0", () => {
    fc.assert(
      fc.property(arbHashN, (a) => {
        expect(hammingDistance(a, a)).toBe(0);
      })
    );
  });

  it("symmetry: hammingDistance(a, b) === hammingDistance(b, a)", () => {
    fc.assert(
      fc.property(arbHash8, arbHash8, (a, b) => {
        expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
      })
    );
  });

  it("non-negative: hammingDistance(a, b) >= 0", () => {
    fc.assert(
      fc.property(arbHash8, arbHash8, (a, b) => {
        expect(hammingDistance(a, b)).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it("upper bound: hammingDistance(a, b) <= 8 * length", () => {
    fc.assert(
      fc.property(arbHashN, (a) => {
        const b = new Uint8Array(a.length);
        for (let i = 0; i < a.length; i++) b[i] = ~a[i]! & 0xff;
        expect(hammingDistance(a, b)).toBeLessThanOrEqual(8 * a.length);
      })
    );
  });

  it("fully inverted arrays produce exactly 8 * length distance", () => {
    fc.assert(
      fc.property(arbHashN, (a) => {
        const b = new Uint8Array(a.length);
        for (let i = 0; i < a.length; i++) b[i] = ~a[i]! & 0xff;
        expect(hammingDistance(a, b)).toBe(8 * a.length);
      })
    );
  });

  it("triangle inequality: dist(a, c) <= dist(a, b) + dist(b, c)", () => {
    fc.assert(
      fc.property(arbHash8, arbHash8, arbHash8, (a, b, c) => {
        expect(hammingDistance(a, c)).toBeLessThanOrEqual(
          hammingDistance(a, b) + hammingDistance(b, c)
        );
      })
    );
  });

  it("single bit flip produces distance 1", () => {
    fc.assert(
      fc.property(
        arbHashN,
        fc.integer({ min: 0, max: 511 }),
        (a, bitPosRaw) => {
          const bitPos = bitPosRaw % (a.length * 8);
          const b = new Uint8Array(a);
          const byteIdx = Math.floor(bitPos / 8);
          b[byteIdx] = b[byteIdx]! ^ (1 << (bitPos % 8));
          expect(hammingDistance(a, b)).toBe(1);
        }
      )
    );
  });

  it("empty arrays have distance 0", () => {
    expect(hammingDistance(new Uint8Array(0), new Uint8Array(0))).toBe(0);
  });
});

describe("computeAHash properties", () => {
  it("is deterministic: same pixels produce same hash", () => {
    fc.assert(
      fc.property(arbAHashInput, (pixels) => {
        const h1 = computeAHash(pixels, 8, 8);
        const h2 = computeAHash(pixels, 8, 8);
        expect(hammingDistance(h1, h2)).toBe(0);
      })
    );
  });

  it("always returns exactly 8 bytes", () => {
    fc.assert(
      fc.property(arbAHashInput, (pixels) => {
        expect(computeAHash(pixels, 8, 8).length).toBe(8);
      })
    );
  });

  it("hash distance is bounded by 64 bits", () => {
    fc.assert(
      fc.property(arbAHashInput, arbAHashInput, (p1, p2) => {
        const h1 = computeAHash(p1, 8, 8);
        const h2 = computeAHash(p2, 8, 8);
        expect(hammingDistance(h1, h2)).toBeLessThanOrEqual(64);
      })
    );
  });

  it("is deterministic with varied RGB channels", () => {
    fc.assert(
      fc.property(arbAHashColorInput, (pixels) => {
        const h1 = computeAHash(pixels, 8, 8);
        const h2 = computeAHash(pixels, 8, 8);
        expect(hammingDistance(h1, h2)).toBe(0);
      })
    );
  });
});

describe("computeBHash properties", () => {
  it("is deterministic: same pixels produce same hash", () => {
    fc.assert(
      fc.property(arbBHashInput, (pixels) => {
        const h1 = computeBHash(pixels, 16, 16);
        const h2 = computeBHash(pixels, 16, 16);
        expect(hammingDistance(h1, h2)).toBe(0);
      })
    );
  });

  it("always returns exactly 32 bytes", () => {
    fc.assert(
      fc.property(arbBHashInput, (pixels) => {
        expect(computeBHash(pixels, 16, 16).length).toBe(32);
      })
    );
  });

  it("hash distance is bounded by 256 bits", () => {
    fc.assert(
      fc.property(arbBHashInput, arbBHashInput, (p1, p2) => {
        const h1 = computeBHash(p1, 16, 16);
        const h2 = computeBHash(p2, 16, 16);
        expect(hammingDistance(h1, h2)).toBeLessThanOrEqual(256);
      })
    );
  });
});
