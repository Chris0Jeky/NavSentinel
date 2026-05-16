import { describe, expect, it } from "vitest";
import {
  computeAHash,
  computeBHash,
  hammingDistance,
} from "../extension/src/shared/visual_sim_hash";

function makePixels(width: number, height: number, fill: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = fill;
    pixels[i * 4 + 1] = fill;
    pixels[i * 4 + 2] = fill;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

function makeGradientPixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = Math.round(((x + y) / (width + height - 2)) * 255);
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

function makeCheckerboard(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = (x + y) % 2 === 0 ? 255 : 0;
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

describe("computeAHash", () => {
  it("returns 8-byte hash for 8x8 input", () => {
    const pixels = makePixels(8, 8, 128);
    const hash = computeAHash(pixels, 8, 8);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(8);
  });

  it("uniform image produces all-zeros or all-ones hash", () => {
    const pixels = makePixels(8, 8, 100);
    const hash = computeAHash(pixels, 8, 8);
    const allZero = hash.every(b => b === 0);
    const allOnes = hash.every(b => b === 0xFF);
    expect(allZero || allOnes).toBe(true);
  });

  it("identical images produce identical hashes", () => {
    const pixels = makeGradientPixels(8, 8);
    const hash1 = computeAHash(pixels, 8, 8);
    const hash2 = computeAHash(pixels, 8, 8);
    expect(hammingDistance(hash1, hash2)).toBe(0);
  });

  it("very different images produce different hashes", () => {
    const gradient = makeGradientPixels(8, 8);
    const checker = makeCheckerboard(8, 8);
    const h1 = computeAHash(gradient, 8, 8);
    const h2 = computeAHash(checker, 8, 8);
    expect(hammingDistance(h1, h2)).toBeGreaterThan(10);
  });

  it("throws for wrong dimensions", () => {
    const pixels = makePixels(16, 16, 128);
    expect(() => computeAHash(pixels, 16, 16)).toThrow();
  });
});

describe("computeBHash", () => {
  it("returns 32-byte hash for 16x16 input", () => {
    const pixels = makePixels(16, 16, 128);
    const hash = computeBHash(pixels, 16, 16);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  it("identical images produce identical bHashes", () => {
    const pixels = makeGradientPixels(16, 16);
    const h1 = computeBHash(pixels, 16, 16);
    const h2 = computeBHash(pixels, 16, 16);
    expect(hammingDistance(h1, h2)).toBe(0);
  });

  it("different images produce different bHashes", () => {
    const gradient = makeGradientPixels(16, 16);
    const checker = makeCheckerboard(16, 16);
    const h1 = computeBHash(gradient, 16, 16);
    const h2 = computeBHash(checker, 16, 16);
    expect(hammingDistance(h1, h2)).toBeGreaterThan(20);
  });

  it("throws for wrong dimensions", () => {
    const pixels = makePixels(8, 8, 128);
    expect(() => computeBHash(pixels, 8, 8)).toThrow();
  });
});

describe("hammingDistance", () => {
  it("returns 0 for identical arrays", () => {
    const a = new Uint8Array([0xFF, 0x00, 0xAA]);
    expect(hammingDistance(a, a)).toBe(0);
  });

  it("returns correct distance for single bit difference", () => {
    const a = new Uint8Array([0b10000000]);
    const b = new Uint8Array([0b00000000]);
    expect(hammingDistance(a, b)).toBe(1);
  });

  it("returns 8 for fully inverted single byte", () => {
    const a = new Uint8Array([0xFF]);
    const b = new Uint8Array([0x00]);
    expect(hammingDistance(a, b)).toBe(8);
  });

  it("returns total bits for fully inverted multi-byte", () => {
    const a = new Uint8Array([0xFF, 0xFF, 0xFF]);
    const b = new Uint8Array([0x00, 0x00, 0x00]);
    expect(hammingDistance(a, b)).toBe(24);
  });

  it("throws for mismatched lengths", () => {
    const a = new Uint8Array([0xFF]);
    const b = new Uint8Array([0xFF, 0x00]);
    expect(() => hammingDistance(a, b)).toThrow();
  });

  it("handles real-world hash comparison", () => {
    const a = new Uint8Array([0b11110000, 0b10101010]);
    const b = new Uint8Array([0b11100000, 0b10101110]);
    // XOR byte 0: 0b00010000 = 1 bit; byte 1: 0b00000100 = 1 bit; total = 2
    expect(hammingDistance(a, b)).toBe(2);
  });
});

describe("visual similarity template matching", () => {
  it("similar gradient produces low hamming distance", () => {
    const original = makeGradientPixels(8, 8);
    const slightlyDifferent = new Uint8ClampedArray(original);
    slightlyDifferent[0] = Math.min(255, slightlyDifferent[0]! + 5);
    slightlyDifferent[4] = Math.min(255, slightlyDifferent[4]! + 5);

    const h1 = computeAHash(original, 8, 8);
    const h2 = computeAHash(slightlyDifferent, 8, 8);
    expect(hammingDistance(h1, h2)).toBeLessThanOrEqual(2);
  });
});
