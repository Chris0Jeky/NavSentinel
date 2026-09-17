/**
 * Runtime-only reputation core for the research profile.
 *
 * The test/build helpers remain in reputation.ts. Keeping this production
 * surface small prevents those helpers from becoming part of the shipped
 * research bundle while retaining the same filter format and safety caps.
 */

const HEADER_SIZE = 16;
const MAGIC = 0x424c4f4d;
const VERSION = 1;
const MIN_BITS = 8;
const MAX_BITS = 16 * 1024 * 1024;
const MAX_HASHES = 30;
const MAX_FILE_BYTES = 2 * 1024 * 1024 + HEADER_SIZE;

interface Filter {
  bits: Uint8Array;
  m: number;
  k: number;
}

function hash(key: string, seed: number): number {
  let h = seed >>> 0;
  const blocks = key.length >> 2;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  for (let i = 0; i < blocks; i += 1) {
    let k = (key.charCodeAt(i * 4) & 255) |
      ((key.charCodeAt(i * 4 + 1) & 255) << 8) |
      ((key.charCodeAt(i * 4 + 2) & 255) << 16) |
      ((key.charCodeAt(i * 4 + 3) & 255) << 24);
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  const tail = blocks * 4;
  let k = 0;
  switch (key.length & 3) {
    case 3: k ^= (key.charCodeAt(tail + 2) & 255) << 16;
      // falls through
    case 2: k ^= (key.charCodeAt(tail + 1) & 255) << 8;
      // falls through
    case 1:
      k ^= key.charCodeAt(tail) & 255;
      k = Math.imul(k, c1);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, c2);
      h ^= k;
  }
  h ^= key.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function loadFilter(data: ArrayBuffer): Filter {
  if (data.byteLength < HEADER_SIZE) throw new Error("Bloom filter data too short for header");
  const view = new DataView(data);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) throw new Error(`Invalid bloom filter magic: 0x${magic.toString(16)}`);
  if (view.getUint32(4, true) !== VERSION) throw new Error("Unsupported bloom filter version");
  const k = view.getUint32(8, true);
  const m = view.getUint32(12, true);
  if (m < MIN_BITS) throw new Error("Bloom filter is below the minimum size");
  if (k === 0) throw new Error("Bloom filter k=0 is invalid");
  if (m > MAX_BITS) throw new Error("Bloom filter exceeds the bit safety cap");
  if (k > MAX_HASHES) throw new Error("Bloom filter exceeds the hash safety cap");
  const byteLength = Math.ceil(m / 8);
  if (data.byteLength < HEADER_SIZE + byteLength) throw new Error("Bloom filter data truncated");
  return { bits: new Uint8Array(data, HEADER_SIZE, byteLength), m, k };
}

function checkDomain(filter: Filter, domain: string): boolean {
  if (!domain) return false;
  const key = domain.toLowerCase();
  const first = hash(key, 0x9747b28c);
  const step = hash(key, 0xc6a4a793) | 1;
  for (let i = 0; i < filter.k; i += 1) {
    const bit = (first + Math.imul(i, step) >>> 0) % filter.m;
    if (!((filter.bits[bit >>> 3]! >> (bit & 7)) & 1)) return false;
  }
  return true;
}

let filter: Filter | null = null;

export function initReputation(data: ArrayBuffer): boolean {
  try {
    filter = loadFilter(data);
    return true;
  } catch (error) {
    console.warn("[NavSentinel] Failed to load reputation bloom filter:", error);
    filter = null;
    return false;
  }
}

export function isKnownBadDomain(domain: string): boolean {
  return filter ? checkDomain(filter, domain) : false;
}

export function reputationReady(): boolean {
  return filter !== null;
}

export function checkReputationViaMessage(domain: string): Promise<{ knownBad: boolean; filterReady: boolean }> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "ns-reputation-check", domain },
        (response: unknown) => {
          if (chrome.runtime.lastError || !response || typeof response !== "object") {
            resolve({ knownBad: false, filterReady: false });
            return;
          }
          const result = response as { knownBad?: unknown; filterReady?: unknown };
          resolve({ knownBad: result.knownBad === true, filterReady: result.filterReady === true });
        },
      );
    } catch {
      resolve({ knownBad: false, filterReady: false });
    }
  });
}

export { MAX_FILE_BYTES };
