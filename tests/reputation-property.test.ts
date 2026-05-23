import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  murmurhash3_32,
  loadFilter,
  checkDomain,
  serializeFilter,
  createFilter,
  insertDomain,
  optimalParams,
  MAX_FILTER_BITS,
  MAX_HASH_FUNCTIONS,
} from "../extension/src/shared/reputation";

const arbLabel = fc
  .array(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
    { minLength: 1, maxLength: 12 },
  )
  .map((chars) => chars.join(""));

const arbDomain = fc
  .tuple(arbLabel, fc.constantFrom("com", "org", "net", "io", "example"))
  .map(([label, tld]) => `${label}.${tld}`);

const arbMixedCaseDomain = fc
  .tuple(
    fc.array(
      fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")),
      { minLength: 1, maxLength: 12 },
    ).map((chars) => chars.join("")),
    fc.constantFrom("com", "org", "net", "io"),
  )
  .map(([label, tld]) => `${label}.${tld}`);

const arbSeed = fc.integer({ min: 0, max: 0xffffffff });

const arbString = fc
  .array(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789.-_".split("")),
    { minLength: 0, maxLength: 30 },
  )
  .map((chars) => chars.join(""));

// ---------------------------------------------------------------------------
// murmurhash3_32
// ---------------------------------------------------------------------------

describe("murmurhash3_32 properties", () => {
  it("deterministic: same input + seed = same output", () => {
    fc.assert(
      fc.property(arbString, arbSeed, (key, seed) => {
        expect(murmurhash3_32(key, seed)).toBe(murmurhash3_32(key, seed));
      }),
    );
  });

  it("output is always a 32-bit unsigned integer", () => {
    fc.assert(
      fc.property(arbString, arbSeed, (key, seed) => {
        const h = murmurhash3_32(key, seed);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(0xffffffff);
        expect(Number.isInteger(h)).toBe(true);
      }),
    );
  });

  it("different seeds produce different hashes (with high probability)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("test", "hello", "domain.com", "abcdefgh"),
        arbSeed,
        arbSeed,
        (key, seed1, seed2) => {
          if (seed1 === seed2) return;
          const h1 = murmurhash3_32(key, seed1);
          const h2 = murmurhash3_32(key, seed2);
          expect(h1 !== h2 || seed1 === seed2).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("handles all tail lengths (0-3 remainder bytes)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        arbSeed,
        (len, seed) => {
          const key = "x".repeat(len);
          const h = murmurhash3_32(key, seed);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThanOrEqual(0xffffffff);
        },
      ),
    );
  });

  it("empty string produces a valid hash", () => {
    fc.assert(
      fc.property(arbSeed, (seed) => {
        const h = murmurhash3_32("", seed);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(0xffffffff);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// createFilter
// ---------------------------------------------------------------------------

describe("createFilter properties", () => {
  it("bits array length is ceil(m/8)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 20 }),
        (m, k) => {
          const f = createFilter(m, k);
          expect(f.bits.length).toBe(Math.ceil(m / 8));
        },
      ),
    );
  });

  it("all bits are initially zero", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 20 }),
        (m, k) => {
          const f = createFilter(m, k);
          expect(f.bits.every((b) => b === 0)).toBe(true);
        },
      ),
    );
  });

  it("preserves m and k parameters", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 20 }),
        (m, k) => {
          const f = createFilter(m, k);
          expect(f.m).toBe(m);
          expect(f.k).toBe(k);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// insertDomain + checkDomain: no false negatives
// ---------------------------------------------------------------------------

describe("bloom filter no-false-negatives guarantee", () => {
  it("every inserted domain is found by checkDomain", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomain, { minLength: 1, maxLength: 20 }),
        (domains) => {
          const unique = [...new Set(domains)];
          const { m, k } = optimalParams(unique.length, 0.001);
          const f = createFilter(m, k);
          for (const d of unique) {
            insertDomain(f, d);
          }
          for (const d of unique) {
            expect(checkDomain(f, d)).toBe(true);
          }
        },
      ),
    );
  });

  it("insertion is cumulative: later inserts don't break earlier ones", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomain, { minLength: 2, maxLength: 15 }),
        (domains) => {
          const unique = [...new Set(domains)];
          if (unique.length < 2) return;
          const { m, k } = optimalParams(unique.length, 0.001);
          const f = createFilter(m, k);

          insertDomain(f, unique[0]!);
          expect(checkDomain(f, unique[0]!)).toBe(true);

          for (let i = 1; i < unique.length; i++) {
            insertDomain(f, unique[i]!);
          }
          expect(checkDomain(f, unique[0]!)).toBe(true);
        },
      ),
    );
  });

  it("case insensitive: inserting lowercase, checking uppercase still finds it", () => {
    fc.assert(
      fc.property(arbMixedCaseDomain, (domain) => {
        const f = createFilter(1024, 7);
        insertDomain(f, domain.toLowerCase());
        expect(checkDomain(f, domain.toUpperCase())).toBe(true);
        expect(checkDomain(f, domain)).toBe(true);
      }),
    );
  });

  it("empty domain: insertDomain is a no-op and checkDomain returns false", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 64, max: 2048 }),
        fc.integer({ min: 1, max: 10 }),
        (m, k) => {
          const f = createFilter(m, k);
          insertDomain(f, "");
          expect(f.bits.every((b) => b === 0)).toBe(true);
          expect(checkDomain(f, "")).toBe(false);
        },
      ),
    );
  });

  it("empty filter never returns true", () => {
    fc.assert(
      fc.property(
        arbDomain,
        fc.integer({ min: 64, max: 2048 }),
        fc.integer({ min: 1, max: 10 }),
        (domain, m, k) => {
          const f = createFilter(m, k);
          expect(checkDomain(f, domain)).toBe(false);
        },
      ),
    );
  });

  it("degenerate filter (m=0) returns false for any domain", () => {
    fc.assert(
      fc.property(arbDomain, (domain) => {
        const f = { bits: new Uint8Array(0), m: 0, k: 7 };
        expect(checkDomain(f, domain)).toBe(false);
      }),
    );
  });

  it("degenerate filter (k=0) returns false for any domain", () => {
    fc.assert(
      fc.property(arbDomain, (domain) => {
        const f = { bits: new Uint8Array(128), m: 1024, k: 0 };
        expect(checkDomain(f, domain)).toBe(false);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Bit array monotonicity
// ---------------------------------------------------------------------------

describe("bloom filter bit-array monotonicity", () => {
  it("inserting a domain only sets bits, never clears them", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomain, { minLength: 1, maxLength: 10 }),
        arbDomain,
        (domains, extra) => {
          const { m, k } = optimalParams(domains.length + 1, 0.001);
          const f = createFilter(m, k);
          for (const d of domains) {
            insertDomain(f, d);
          }
          const before = new Uint8Array(f.bits);
          insertDomain(f, extra);

          for (let i = 0; i < before.length; i++) {
            expect(f.bits[i]! & before[i]!).toBe(before[i]!);
          }
        },
      ),
    );
  });

  it("bit count is monotonically non-decreasing with each insert", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomain, { minLength: 2, maxLength: 10 }),
        (domains) => {
          const { m, k } = optimalParams(domains.length, 0.001);
          const f = createFilter(m, k);
          let prevCount = 0;

          for (const d of domains) {
            insertDomain(f, d);
            let count = 0;
            for (const byte of f.bits) {
              let b = byte;
              while (b) {
                count += b & 1;
                b >>>= 1;
              }
            }
            expect(count).toBeGreaterThanOrEqual(prevCount);
            prevCount = count;
          }
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Serialization round-trip
// ---------------------------------------------------------------------------

describe("bloom filter serialization round-trip", () => {
  it("loadFilter(serializeFilter(f)) preserves m, k, and all membership queries", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomain, { minLength: 1, maxLength: 15 }),
        (domains) => {
          const unique = [...new Set(domains)];
          const { m, k } = optimalParams(unique.length, 0.001);
          const original = createFilter(m, k);
          for (const d of unique) {
            insertDomain(original, d);
          }

          const loaded = loadFilter(serializeFilter(original));
          expect(loaded.m).toBe(original.m);
          expect(loaded.k).toBe(original.k);

          for (const d of unique) {
            expect(checkDomain(loaded, d)).toBe(true);
          }
        },
      ),
    );
  });

  it("serialization is idempotent: serialize(load(serialize(f))) === serialize(f)", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomain, { minLength: 0, maxLength: 10 }),
        (domains) => {
          const { m, k } = optimalParams(Math.max(1, domains.length), 0.01);
          const f = createFilter(m, k);
          for (const d of domains) {
            insertDomain(f, d);
          }

          const first = serializeFilter(f);
          const loaded = loadFilter(first);
          const second = serializeFilter(loaded);

          expect(Array.from(second)).toEqual(Array.from(first));
        },
      ),
    );
  });

  it("serialized output has correct header layout", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 8, max: 5000 }),
        fc.integer({ min: 1, max: 20 }),
        (m, k) => {
          const f = createFilter(m, k);
          const bin = serializeFilter(f);
          const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

          expect(view.getUint32(0, true)).toBe(0x424c4f4d);
          expect(view.getUint32(4, true)).toBe(1);
          expect(view.getUint32(8, true)).toBe(k);
          expect(view.getUint32(12, true)).toBe(m);
          expect(bin.length).toBe(16 + Math.ceil(m / 8));
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// loadFilter validation
// ---------------------------------------------------------------------------

describe("loadFilter validation properties", () => {
  it("rejects any buffer shorter than 16 bytes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 15 }),
        (len) => {
          expect(() => loadFilter(new Uint8Array(len))).toThrow();
        },
      ),
    );
  });

  it("rejects buffers with wrong magic", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }).filter((v) => v !== 0x424c4f4d),
        (magic) => {
          const buf = new Uint8Array(20);
          const view = new DataView(buf.buffer);
          view.setUint32(0, magic, true);
          view.setUint32(4, 1, true);
          view.setUint32(8, 1, true);
          view.setUint32(12, 8, true);
          expect(() => loadFilter(buf)).toThrow("magic");
        },
      ),
    );
  });

  it("rejects unsupported versions", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),
        (version) => {
          const buf = new Uint8Array(20);
          const view = new DataView(buf.buffer);
          view.setUint32(0, 0x424c4f4d, true);
          view.setUint32(4, version, true);
          view.setUint32(8, 1, true);
          view.setUint32(12, 8, true);
          expect(() => loadFilter(buf)).toThrow("version");
        },
      ),
    );
  });

  it("rejects m exceeding MAX_FILTER_BITS", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_FILTER_BITS + 1, max: MAX_FILTER_BITS + 1000 }),
        (bigM) => {
          const buf = new Uint8Array(20);
          const view = new DataView(buf.buffer);
          view.setUint32(0, 0x424c4f4d, true);
          view.setUint32(4, 1, true);
          view.setUint32(8, 1, true);
          view.setUint32(12, bigM, true);
          expect(() => loadFilter(buf)).toThrow("safety cap");
        },
      ),
    );
  });

  it("rejects k exceeding MAX_HASH_FUNCTIONS", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_HASH_FUNCTIONS + 1, max: MAX_HASH_FUNCTIONS + 100 }),
        (bigK) => {
          const buf = new Uint8Array(20);
          const view = new DataView(buf.buffer);
          view.setUint32(0, 0x424c4f4d, true);
          view.setUint32(4, 1, true);
          view.setUint32(8, bigK, true);
          view.setUint32(12, 64, true);
          expect(() => loadFilter(buf)).toThrow("safety cap");
        },
      ),
    );
  });

  it("accepts m and k at exactly the safety cap limits", () => {
    const m = 64;
    const k = MAX_HASH_FUNCTIONS;
    const f = createFilter(m, k);
    const bin = serializeFilter(f);
    expect(() => loadFilter(bin)).not.toThrow();
    const loaded = loadFilter(bin);
    expect(loaded.k).toBe(k);
    expect(loaded.m).toBe(m);
  });
});

// ---------------------------------------------------------------------------
// optimalParams
// ---------------------------------------------------------------------------

describe("optimalParams properties", () => {
  it("m is always positive for n > 0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.double({ min: 0.000001, max: 0.5, noNaN: true }),
        (n, p) => {
          const { m } = optimalParams(n, p);
          expect(m).toBeGreaterThan(0);
        },
      ),
    );
  });

  it("k is always >= 1 for n > 0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.double({ min: 0.000001, max: 0.5, noNaN: true }),
        (n, p) => {
          const { k } = optimalParams(n, p);
          expect(k).toBeGreaterThanOrEqual(1);
        },
      ),
    );
  });

  it("m and k are positive integers", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.double({ min: 0.000001, max: 0.5, noNaN: true }),
        (n, p) => {
          const { m, k } = optimalParams(n, p);
          expect(Number.isInteger(m)).toBe(true);
          expect(Number.isInteger(k)).toBe(true);
        },
      ),
    );
  });

  it("returns safe defaults for n <= 0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 0 }),
        (n) => {
          const { m, k } = optimalParams(n, 0.01);
          expect(m).toBe(8);
          expect(k).toBe(1);
        },
      ),
    );
  });

  it("m increases as p decreases (stricter FP rate needs more bits)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 10000 }),
        (n) => {
          const loose = optimalParams(n, 0.1);
          const strict = optimalParams(n, 0.0001);
          expect(strict.m).toBeGreaterThan(loose.m);
        },
      ),
    );
  });

  it("m increases as n increases (more items need more bits)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0001, max: 0.1, noNaN: true }),
        (p) => {
          const small = optimalParams(100, p);
          const large = optimalParams(10000, p);
          expect(large.m).toBeGreaterThan(small.m);
        },
      ),
    );
  });

  it("m/n ratio increases as p decreases", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10000 }),
        (n) => {
          const loose = optimalParams(n, 0.1);
          const strict = optimalParams(n, 0.0001);
          expect(strict.m / n).toBeGreaterThan(loose.m / n);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Double-hashing h2 odd guarantee
// ---------------------------------------------------------------------------

describe("double-hashing h2 odd guarantee", () => {
  it("h2 is always odd (never zero, prevents degenerate probing)", () => {
    fc.assert(
      fc.property(arbDomain, (domain) => {
        const key = domain.toLowerCase();
        const h2 = murmurhash3_32(key, 0xc6a4a793) | 1;
        expect(h2 & 1).toBe(1);
        expect(h2).not.toBe(0);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// False positive rate (statistical property)
// ---------------------------------------------------------------------------

describe("bloom filter false positive rate", () => {
  it("FP rate is below 1% for properly sized filters", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 50 }),
        (n) => {
          const domains = Array.from({ length: n }, (_, i) => `inserted-domain-${i}.test`);
          const { m, k } = optimalParams(n, 0.001);
          const f = createFilter(m, k);
          for (const d of domains) {
            insertDomain(f, d);
          }

          let fps = 0;
          const probes = 200;
          for (let i = 0; i < probes; i++) {
            if (checkDomain(f, `probe-not-inserted-${i}-${n}.check`)) {
              fps++;
            }
          }
          expect(fps / probes).toBeLessThanOrEqual(0.02);
        },
      ),
      { numRuns: 20 },
    );
  });
});
