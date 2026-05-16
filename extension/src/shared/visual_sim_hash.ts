/**
 * Visual Similarity Detection — Hash Algorithms (P4-01)
 *
 * Implements Average Hash (aHash) and Block Mean Hash (bHash) for
 * perceptual image comparison. Operates on raw pixel data from canvas.
 */

const AHASH_SIZE = 8;
const BHASH_SIZE = 16;
const BHASH_BLOCK = 4;

/**
 * Compute Average Hash (aHash) from an 8x8 grayscale image.
 *
 * Each bit represents whether that pixel is above or below the mean brightness.
 * Result: 64-bit hash stored as 8-byte Uint8Array.
 */
export function computeAHash(pixels: Uint8ClampedArray, width: number, height: number): Uint8Array {
  if (width !== AHASH_SIZE || height !== AHASH_SIZE) {
    throw new Error(`aHash requires ${AHASH_SIZE}x${AHASH_SIZE} input`);
  }
  if (pixels.length < width * height * 4) {
    throw new Error(`Pixel buffer too short: need ${width * height * 4}, got ${pixels.length}`);
  }

  let sum = 0;
  const grayscale = new Uint8Array(AHASH_SIZE * AHASH_SIZE);

  for (let i = 0; i < AHASH_SIZE * AHASH_SIZE; i++) {
    const r = pixels[i * 4]!;
    const g = pixels[i * 4 + 1]!;
    const b = pixels[i * 4 + 2]!;
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    grayscale[i] = gray;
    sum += gray;
  }

  const mean = sum / (AHASH_SIZE * AHASH_SIZE);

  // Uniform images have no perceptual structure — return all-zeros sentinel
  // to avoid false-positive collisions with any template.
  let isUniform = true;
  for (let i = 0; i < AHASH_SIZE * AHASH_SIZE; i++) {
    if (grayscale[i] !== grayscale[0]) { isUniform = false; break; }
  }
  if (isUniform) return new Uint8Array(8);

  const hash = new Uint8Array(8);

  for (let i = 0; i < 64; i++) {
    if (grayscale[i]! >= mean) {
      const byteIdx = Math.floor(i / 8);
      hash[byteIdx] = (hash[byteIdx] ?? 0) | (1 << (7 - (i % 8)));
    }
  }

  return hash;
}

/**
 * Compute Block Mean Hash (bHash) from a 16x16 RGBA image.
 *
 * Divides the 16x16 image into a 4x4 grid of 4x4-pixel blocks, computes
 * block means, then thresholds each pixel against the average of its block
 * mean and the overall image mean. Result: 256-bit hash (32 bytes).
 */
export function computeBHash(pixels: Uint8ClampedArray, width: number, height: number): Uint8Array {
  if (width !== BHASH_SIZE || height !== BHASH_SIZE) {
    throw new Error(`bHash requires ${BHASH_SIZE}x${BHASH_SIZE} input`);
  }
  if (pixels.length < width * height * 4) {
    throw new Error(`Pixel buffer too short: need ${width * height * 4}, got ${pixels.length}`);
  }

  let sum = 0;
  const grayscale = new Uint8Array(BHASH_SIZE * BHASH_SIZE);

  for (let i = 0; i < BHASH_SIZE * BHASH_SIZE; i++) {
    const r = pixels[i * 4]!;
    const g = pixels[i * 4 + 1]!;
    const b = pixels[i * 4 + 2]!;
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    grayscale[i] = gray;
    sum += gray;
  }

  const blockMeans = new Float64Array((BHASH_SIZE / BHASH_BLOCK) * (BHASH_SIZE / BHASH_BLOCK));
  const blocksPerRow = BHASH_SIZE / BHASH_BLOCK;

  for (let by = 0; by < blocksPerRow; by++) {
    for (let bx = 0; bx < blocksPerRow; bx++) {
      let blockSum = 0;
      for (let py = 0; py < BHASH_BLOCK; py++) {
        for (let px = 0; px < BHASH_BLOCK; px++) {
          const idx = (by * BHASH_BLOCK + py) * BHASH_SIZE + (bx * BHASH_BLOCK + px);
          blockSum += grayscale[idx]!;
        }
      }
      blockMeans[by * blocksPerRow + bx] = blockSum / (BHASH_BLOCK * BHASH_BLOCK);
    }
  }

  const overallMean = sum / (BHASH_SIZE * BHASH_SIZE);
  const hash = new Uint8Array(32);

  for (let i = 0; i < BHASH_SIZE * BHASH_SIZE; i++) {
    const by = Math.floor(Math.floor(i / BHASH_SIZE) / BHASH_BLOCK);
    const bx = Math.floor((i % BHASH_SIZE) / BHASH_BLOCK);
    const blockMean = blockMeans[by * blocksPerRow + bx]!;
    const threshold = (overallMean + blockMean) / 2;

    if (grayscale[i]! >= threshold) {
      const byteIdx = Math.floor(i / 8);
      hash[byteIdx] = (hash[byteIdx] ?? 0) | (1 << (7 - (i % 8)));
    }
  }

  return hash;
}

/**
 * Compute Hamming distance between two hashes of equal length.
 * Returns the number of differing bits.
 */
export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    throw new Error("Hash length mismatch");
  }

  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let xor = a[i]! ^ b[i]!;
    while (xor) {
      distance += xor & 1;
      xor >>>= 1;
    }
  }
  return distance;
}
