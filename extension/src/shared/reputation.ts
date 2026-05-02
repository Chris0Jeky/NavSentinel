/**
 * Bloom filter-based domain reputation lookup.
 *
 * Ships a build-time compiled bloom filter of known-bad domains from public
 * threat feeds (URLhaus, OpenPhish). The filter is a static asset -- no
 * runtime network calls are made. Lookups run in < 1ms.
 *
 * Algorithm: classic bloom filter with k hash functions derived from two
 * independent MurmurHash3-32 seeds. The bit array is stored as a Uint8Array.
 *
 * False positive rate for the bloom filter itself: < 0.01% (configurable
 * via the build script by tuning m/n ratio and k).
 */

// ---------------------------------------------------------------------------
// MurmurHash3 (32-bit) -- public domain reference implementation
// ---------------------------------------------------------------------------

/**
 * MurmurHash3 32-bit finalizer.
 * @param key  String to hash
 * @param seed Seed value
 * @returns    32-bit unsigned hash
 */
export function murmurhash3_32(key: string, seed: number): number {
  let h = seed >>> 0;
  const len = key.length;
  const nblocks = len >> 2;

  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  // Body: process 4-byte blocks
  for (let i = 0; i < nblocks; i++) {
    let k =
      (key.charCodeAt(i * 4) & 0xff) |
      ((key.charCodeAt(i * 4 + 1) & 0xff) << 8) |
      ((key.charCodeAt(i * 4 + 2) & 0xff) << 16) |
      ((key.charCodeAt(i * 4 + 3) & 0xff) << 24);

    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);

    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }

  // Tail: remaining bytes
  const tail = nblocks * 4;
  let k1 = 0;
  switch (len & 3) {
    case 3:
      k1 ^= (key.charCodeAt(tail + 2) & 0xff) << 16;
    // falls through
    case 2:
      k1 ^= (key.charCodeAt(tail + 1) & 0xff) << 8;
    // falls through
    case 1:
      k1 ^= key.charCodeAt(tail) & 0xff;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h ^= k1;
  }

  // Finalization mix
  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Bloom filter
// ---------------------------------------------------------------------------

/** Header layout for the serialized bloom filter binary format. */
const HEADER_MAGIC = 0x424c4f4d; // "BLOM"
const HEADER_VERSION = 1;
const HEADER_SIZE = 16; // magic(4) + version(4) + k(4) + m(4)

/**
 * Safety caps to prevent OOM / CPU-lock from a crafted .bin file.
 * MAX_FILTER_BITS = 16M bits = 2MB bit array -- well above the 150KB budget.
 * MAX_HASH_FUNCTIONS = 30 -- optimal k for any practical FP rate is < 20.
 */
export const MAX_FILTER_BITS = 16 * 1024 * 1024; // 16 Mbit = 2 MB
export const MAX_HASH_FUNCTIONS = 30;

export interface BloomFilterState {
  /** Bit array */
  bits: Uint8Array;
  /** Number of bits in the filter */
  m: number;
  /** Number of hash functions */
  k: number;
}

/**
 * Deserialize a bloom filter from its binary representation.
 *
 * Format:
 *   [0..3]   magic    = 0x424c4f4d ("BLOM")
 *   [4..7]   version  = 1
 *   [8..11]  k        = number of hash functions
 *   [12..15] m        = number of bits
 *   [16..]   bit array (ceil(m/8) bytes)
 *
 * All multi-byte integers are little-endian.
 */
export function loadFilter(data: ArrayBuffer | Uint8Array): BloomFilterState {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (bytes.length < HEADER_SIZE) {
    throw new Error("Bloom filter data too short for header");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== HEADER_MAGIC) {
    throw new Error(`Invalid bloom filter magic: 0x${magic.toString(16)}`);
  }

  const version = view.getUint32(4, true);
  if (version !== HEADER_VERSION) {
    throw new Error(`Unsupported bloom filter version: ${version}`);
  }

  const k = view.getUint32(8, true);
  const m = view.getUint32(12, true);

  if (m > MAX_FILTER_BITS) {
    throw new Error(`Bloom filter m=${m} exceeds safety cap of ${MAX_FILTER_BITS} bits`);
  }
  if (k > MAX_HASH_FUNCTIONS) {
    throw new Error(`Bloom filter k=${k} exceeds safety cap of ${MAX_HASH_FUNCTIONS}`);
  }

  const expectedBytes = Math.ceil(m / 8);
  if (bytes.length < HEADER_SIZE + expectedBytes) {
    throw new Error(
      `Bloom filter data truncated: expected ${HEADER_SIZE + expectedBytes} bytes, got ${bytes.length}`
    );
  }

  const bits = bytes.slice(HEADER_SIZE, HEADER_SIZE + expectedBytes);

  return { bits, m, k };
}

/**
 * Check whether a domain might be in the bloom filter.
 *
 * Uses double-hashing: hash_i(x) = (h1(x) + i * h2(x)) mod m
 * where h1 = murmurhash3(x, seed1), h2 = murmurhash3(x, seed2).
 *
 * @returns true if the domain is possibly in the set (may be a false positive);
 *          false if the domain is definitely NOT in the set.
 */
export function checkDomain(filter: BloomFilterState, domain: string): boolean {
  if (!filter.bits || filter.m === 0 || filter.k === 0) return false;
  if (!domain) return false;

  const key = domain.toLowerCase();
  const h1 = murmurhash3_32(key, 0x9747b28c);
  // Force h2 to be odd so double-hashing never degenerates when h2=0.
  const h2 = murmurhash3_32(key, 0xc6a4a793) | 1;

  for (let i = 0; i < filter.k; i++) {
    const bit = ((h1 + Math.imul(i, h2)) >>> 0) % filter.m;
    const byteIndex = bit >>> 3;
    const bitIndex = bit & 7;
    if (!((filter.bits[byteIndex]! >> bitIndex) & 1)) {
      return false;
    }
  }
  return true;
}

/**
 * Serialize a bloom filter to its binary representation.
 * Not used at runtime -- build scripts have their own copies.
 * Exported only for unit tests.
 * @internal
 */
export function serializeFilter(filter: BloomFilterState): Uint8Array {
  const expectedBytes = Math.ceil(filter.m / 8);
  const out = new Uint8Array(HEADER_SIZE + expectedBytes);
  const view = new DataView(out.buffer);

  view.setUint32(0, HEADER_MAGIC, true);
  view.setUint32(4, HEADER_VERSION, true);
  view.setUint32(8, filter.k, true);
  view.setUint32(12, filter.m, true);

  out.set(filter.bits.slice(0, expectedBytes), HEADER_SIZE);
  return out;
}

/**
 * Create a new empty bloom filter with the given parameters.
 * Not used at runtime -- build scripts have their own copies.
 * Exported only for unit tests.
 * @internal
 *
 * @param m Number of bits
 * @param k Number of hash functions
 */
export function createFilter(m: number, k: number): BloomFilterState {
  return {
    bits: new Uint8Array(Math.ceil(m / 8)),
    m,
    k,
  };
}

/**
 * Insert a domain into the bloom filter.
 * Not used at runtime -- build scripts have their own copies.
 * Exported only for unit tests.
 * @internal
 */
export function insertDomain(filter: BloomFilterState, domain: string): void {
  if (!domain || filter.m === 0) return;
  const key = domain.toLowerCase();
  const h1 = murmurhash3_32(key, 0x9747b28c);
  // Force h2 to be odd -- must match checkDomain's h2 derivation.
  const h2 = murmurhash3_32(key, 0xc6a4a793) | 1;

  for (let i = 0; i < filter.k; i++) {
    const bit = ((h1 + Math.imul(i, h2)) >>> 0) % filter.m;
    const byteIndex = bit >>> 3;
    const bitIndex = bit & 7;
    filter.bits[byteIndex]! |= 1 << bitIndex;
  }
}

/**
 * Calculate optimal bloom filter parameters for n items at a target FP rate.
 * Not used at runtime -- build scripts have their own copies.
 * Exported only for unit tests.
 * @internal
 *
 * m = -(n * ln(p)) / (ln(2))^2
 * k = (m / n) * ln(2)
 *
 * @param n Number of items
 * @param p Target false positive rate (e.g. 0.0001 for 0.01%)
 */
export function optimalParams(n: number, p: number): { m: number; k: number } {
  if (n <= 0) return { m: 8, k: 1 };
  const m = Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2));
  const k = Math.max(1, Math.round((m / n) * Math.LN2));
  return { m, k };
}

// ---------------------------------------------------------------------------
// Runtime reputation state
// ---------------------------------------------------------------------------

let _filter: BloomFilterState | null = null;

/**
 * Initialize the reputation module by loading the bloom filter data.
 * Call once at extension startup with the binary data from the bundled asset.
 *
 * @returns true if the filter loaded successfully
 */
export function initReputation(data: ArrayBuffer | Uint8Array): boolean {
  try {
    _filter = loadFilter(data);
    return true;
  } catch (err) {
    console.warn("[NavSentinel] Failed to load reputation bloom filter:", err);
    _filter = null;
    return false;
  }
}

/**
 * Check whether a domain appears in the known-bad domain bloom filter.
 * Returns false if the filter has not been loaded (graceful degradation).
 */
export function isKnownBadDomain(domain: string): boolean {
  if (!_filter) return false;
  return checkDomain(_filter, domain);
}

/**
 * Returns true if the reputation module has a loaded filter.
 * Not used at runtime. Exported only for unit tests.
 * @internal
 */
export function reputationReady(): boolean {
  return _filter !== null;
}

/**
 * Ask the service worker to check a domain against the bloom filter.
 *
 * Used by child frames that do not load their own copy of the filter.
 * Returns false on any communication error (graceful degradation).
 */
export function checkReputationViaMessage(domain: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "ns-reputation-check", domain },
        (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve(false);
            return;
          }
          resolve(!!response.knownBad);
        }
      );
    } catch {
      resolve(false);
    }
  });
}
