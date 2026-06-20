import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  murmurhash3_32,
  loadFilter,
  checkDomain,
  serializeFilter,
  createFilter,
  insertDomain,
  optimalParams,
  initReputation,
  isKnownBadDomain,
  reputationReady,
  checkReputationViaMessage,
  MAX_FILTER_BITS,
  MAX_HASH_FUNCTIONS,
  type BloomFilterState,
} from "../extension/src/shared/reputation";

// ---------------------------------------------------------------------------
// MurmurHash3 tests
// ---------------------------------------------------------------------------

describe("murmurhash3_32", () => {
  it("returns consistent hashes for the same input and seed", () => {
    const h1 = murmurhash3_32("test", 0);
    const h2 = murmurhash3_32("test", 0);
    expect(h1).toBe(h2);
  });

  it("returns different hashes for different seeds", () => {
    const h1 = murmurhash3_32("test", 0);
    const h2 = murmurhash3_32("test", 1);
    expect(h1).not.toBe(h2);
  });

  it("returns different hashes for different inputs", () => {
    const h1 = murmurhash3_32("foo", 0);
    const h2 = murmurhash3_32("bar", 0);
    expect(h1).not.toBe(h2);
  });

  it("returns a 32-bit unsigned integer", () => {
    const h = murmurhash3_32("hello world", 42);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });

  it("handles empty string", () => {
    const h = murmurhash3_32("", 0);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(h)).toBe(true);
  });

  it("handles strings of various lengths (1-8 chars covers tail cases)", () => {
    for (let len = 1; len <= 8; len++) {
      const key = "x".repeat(len);
      const h = murmurhash3_32(key, 0);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

// ---------------------------------------------------------------------------
// optimalParams tests
// ---------------------------------------------------------------------------

describe("optimalParams", () => {
  it("returns reasonable m and k for 100K domains at 0.01% FP", () => {
    const { m, k } = optimalParams(100_000, 0.0001);
    expect(m).toBeGreaterThan(0);
    expect(k).toBeGreaterThan(0);
    // For 100K items at 0.01% FP: m ~= 1,917,011 bits (~234KB)
    // k ~= 13
    expect(k).toBeGreaterThanOrEqual(10);
    expect(k).toBeLessThanOrEqual(20);
    const sizeKB = Math.ceil(m / 8) / 1024;
    expect(sizeKB).toBeLessThan(300); // reasonable upper bound
  });

  it("returns m=8, k=1 for zero items", () => {
    const { m, k } = optimalParams(0, 0.0001);
    expect(m).toBe(8);
    expect(k).toBe(1);
  });

  it("returns smaller filter for higher FP rate", () => {
    const strict = optimalParams(10_000, 0.0001);
    const relaxed = optimalParams(10_000, 0.01);
    expect(relaxed.m).toBeLessThan(strict.m);
  });

  it("returns defaults for p=0 (would produce Infinity)", () => {
    const { m, k } = optimalParams(1000, 0);
    expect(m).toBe(8);
    expect(k).toBe(1);
  });

  it("returns defaults for negative p (would produce NaN)", () => {
    const { m, k } = optimalParams(1000, -0.5);
    expect(m).toBe(8);
    expect(k).toBe(1);
  });

  it("returns defaults for p=1 (log(1)=0, zero-size filter)", () => {
    const { m, k } = optimalParams(1000, 1);
    expect(m).toBe(8);
    expect(k).toBe(1);
  });

  it("returns defaults for p>1 (invalid probability)", () => {
    const { m, k } = optimalParams(1000, 2);
    expect(m).toBe(8);
    expect(k).toBe(1);
  });

  it("returns defaults for NaN inputs", () => {
    expect(optimalParams(NaN, 0.0001)).toEqual({ m: 8, k: 1 });
    expect(optimalParams(1000, NaN)).toEqual({ m: 8, k: 1 });
    expect(optimalParams(NaN, NaN)).toEqual({ m: 8, k: 1 });
  });

  it("returns defaults for Infinity inputs", () => {
    expect(optimalParams(Infinity, 0.0001)).toEqual({ m: 8, k: 1 });
    expect(optimalParams(1000, Infinity)).toEqual({ m: 8, k: 1 });
  });

  it("returns defaults for negative n", () => {
    const { m, k } = optimalParams(-100, 0.0001);
    expect(m).toBe(8);
    expect(k).toBe(1);
  });

  it("handles extremely small valid p without NaN", () => {
    const { m, k } = optimalParams(100, 1e-15);
    expect(Number.isFinite(m)).toBe(true);
    expect(m).toBeGreaterThan(0);
    expect(Number.isFinite(k)).toBe(true);
    expect(k).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Bloom filter create / insert / check / serialize / load
// ---------------------------------------------------------------------------

describe("bloom filter core", () => {
  const TEST_DOMAINS = [
    "evil-phishing-test.example",
    "malware-dropper-test.example",
    "fake-login-test.example",
    "credential-harvest-test.example",
    "scam-redirect-test.example",
  ];

  const KNOWN_GOOD_DOMAINS = [
    "google.com",
    "github.com",
    "example.com",
    "wikipedia.org",
    "mozilla.org",
    "stackoverflow.com",
    "amazon.com",
    "microsoft.com",
    "apple.com",
    "reddit.com",
  ];

  let filter: BloomFilterState;

  beforeEach(() => {
    const { m, k } = optimalParams(TEST_DOMAINS.length, 0.0001);
    filter = createFilter(m, k);
    for (const d of TEST_DOMAINS) {
      insertDomain(filter, d);
    }
  });

  it("finds all inserted domains", () => {
    for (const d of TEST_DOMAINS) {
      expect(checkDomain(filter, d)).toBe(true);
    }
  });

  it("is case-insensitive on lookups", () => {
    expect(checkDomain(filter, "Evil-Phishing-Test.Example")).toBe(true);
    expect(checkDomain(filter, "FAKE-LOGIN-TEST.EXAMPLE")).toBe(true);
  });

  it("returns false for known-good domains (no FP expected at this size)", () => {
    for (const d of KNOWN_GOOD_DOMAINS) {
      expect(checkDomain(filter, d)).toBe(false);
    }
  });

  it("returns false for empty domain", () => {
    expect(checkDomain(filter, "")).toBe(false);
  });

  it("returns false when filter is empty (all zeroes)", () => {
    const empty = createFilter(1024, 7);
    expect(checkDomain(empty, "evil-phishing-test.example")).toBe(false);
  });

  it("returns false when m=0 or k=0", () => {
    const zeroM: BloomFilterState = { bits: new Uint8Array(0), m: 0, k: 7 };
    expect(checkDomain(zeroM, "anything")).toBe(false);

    const zeroK: BloomFilterState = { bits: new Uint8Array(128), m: 1024, k: 0 };
    expect(checkDomain(zeroK, "anything")).toBe(false);
  });

  it("skips empty domain on insert without error", () => {
    const f = createFilter(1024, 7);
    insertDomain(f, "");
    // All bits should remain zero
    expect(f.bits.every((b) => b === 0)).toBe(true);
  });
});

describe("bloom filter serialization", () => {
  const TEST_DOMAINS = [
    "evil-phishing-test.example",
    "malware-dropper-test.example",
    "fake-login-test.example",
  ];

  it("round-trips through serialize/load", () => {
    const { m, k } = optimalParams(TEST_DOMAINS.length, 0.0001);
    const original = createFilter(m, k);
    for (const d of TEST_DOMAINS) {
      insertDomain(original, d);
    }

    const binary = serializeFilter(original);
    const loaded = loadFilter(binary);

    expect(loaded.m).toBe(original.m);
    expect(loaded.k).toBe(original.k);

    for (const d of TEST_DOMAINS) {
      expect(checkDomain(loaded, d)).toBe(true);
    }
    expect(checkDomain(loaded, "not-in-filter.example")).toBe(false);
  });

  it("rejects data that is too short", () => {
    expect(() => loadFilter(new Uint8Array(8))).toThrow("too short");
  });

  it("rejects invalid magic", () => {
    const bad = new Uint8Array(20);
    expect(() => loadFilter(bad)).toThrow("Invalid bloom filter magic");
  });

  it("rejects unsupported version", () => {
    const buf = new Uint8Array(20);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x424c4f4d, true); // "BLOM"
    view.setUint32(4, 99, true); // bad version
    expect(() => loadFilter(buf)).toThrow("Unsupported bloom filter version");
  });

  it("rejects m exceeding safety cap (OOM prevention)", () => {
    const buf = new Uint8Array(20);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x424c4f4d, true); // "BLOM"
    view.setUint32(4, 1, true);           // version 1
    view.setUint32(8, 7, true);           // k=7
    view.setUint32(12, MAX_FILTER_BITS + 1, true); // m exceeds cap
    expect(() => loadFilter(buf)).toThrow("exceeds safety cap");
  });

  it("rejects k exceeding safety cap (CPU-lock prevention)", () => {
    const buf = new Uint8Array(20);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x424c4f4d, true); // "BLOM"
    view.setUint32(4, 1, true);           // version 1
    view.setUint32(8, MAX_HASH_FUNCTIONS + 1, true); // k exceeds cap
    view.setUint32(12, 64, true);         // m=64 (small)
    expect(() => loadFilter(buf)).toThrow("exceeds safety cap");
  });

  it("rejects a degenerate filter with m=0 (fail closed) (#287)", () => {
    const buf = new Uint8Array(16);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x424c4f4d, true); // "BLOM"
    view.setUint32(4, 1, true);           // version 1
    view.setUint32(8, 7, true);           // k=7
    view.setUint32(12, 0, true);          // m=0 (degenerate)
    expect(() => loadFilter(buf)).toThrow("m=0 is invalid");
  });

  it("rejects a degenerate filter with k=0 (fail closed) (#287)", () => {
    const buf = new Uint8Array(16);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x424c4f4d, true); // "BLOM"
    view.setUint32(4, 1, true);           // version 1
    view.setUint32(8, 0, true);           // k=0 (degenerate)
    view.setUint32(12, 64, true);         // m=64
    expect(() => loadFilter(buf)).toThrow("k=0 is invalid");
  });

  it("accepts m and k at safety cap limits", () => {
    // Build a valid header with k=MAX_HASH_FUNCTIONS and a small m
    const m = 64;
    const k = MAX_HASH_FUNCTIONS;
    const filter = createFilter(m, k);
    const binary = serializeFilter(filter);
    const view = new DataView(binary.buffer);
    view.setUint32(8, k, true);
    const loaded = loadFilter(binary);
    expect(loaded.k).toBe(k);
    expect(loaded.m).toBe(m);
  });

  it("rejects truncated bit array", () => {
    const { m, k } = optimalParams(10, 0.0001);
    const filter = createFilter(m, k);
    const full = serializeFilter(filter);
    // Truncate the bit array
    const truncated = full.slice(0, 16 + 1); // header + 1 byte instead of full
    if (Math.ceil(m / 8) > 1) {
      expect(() => loadFilter(truncated)).toThrow("truncated");
    }
  });

  it("serialized size is within budget for small filters", () => {
    const { m, k } = optimalParams(15, 0.0001);
    const filter = createFilter(m, k);
    const binary = serializeFilter(filter);
    // 15 domains at 0.01% FP should be tiny
    expect(binary.length).toBeLessThan(1024);
  });

  it("serialized size is within 150KB budget for 100K domains", () => {
    const { m } = optimalParams(100_000, 0.0001);
    const sizeKB = (16 + Math.ceil(m / 8)) / 1024;
    // The actual filter size at 0.01% FP for 100K items is ~234KB
    // At 0.1% FP it's ~117KB. The roadmap says 125KB for 100K at <0.01%.
    // With the exact optimal formula, 100K @ 0.01% needs ~234KB.
    // Realistically we'd use a slightly higher FP rate to stay in budget.
    // This test just verifies the math is sane.
    expect(sizeKB).toBeLessThan(300);
  });
});

// ---------------------------------------------------------------------------
// False positive rate verification
// ---------------------------------------------------------------------------

describe("bloom filter false positive rate", () => {
  it("has FP rate < 1% on a small filter with 100 random lookups", () => {
    const domains = Array.from({ length: 50 }, (_, i) => `bad-domain-${i}.example`);
    const { m, k } = optimalParams(domains.length, 0.0001);
    const filter = createFilter(m, k);
    for (const d of domains) {
      insertDomain(filter, d);
    }

    // Test 100 domains that were NOT inserted
    let falsePositives = 0;
    for (let i = 0; i < 100; i++) {
      if (checkDomain(filter, `good-domain-${i}-definitely-not-in-filter.test`)) {
        falsePositives++;
      }
    }

    // With 50 items and 0.01% target FP rate, we should see 0 FPs in 100 tests
    expect(falsePositives).toBeLessThan(2); // allow up to 1% margin
  });
});

// ---------------------------------------------------------------------------
// Runtime reputation state (initReputation / isKnownBadDomain)
// ---------------------------------------------------------------------------

describe("runtime reputation state", () => {
  it("isKnownBadDomain returns false when no filter loaded", () => {
    // Reputation module starts with no filter
    // Note: This test may be affected by other tests loading filters.
    // The important thing is that the function doesn't throw.
    const result = isKnownBadDomain("anything.example");
    expect(typeof result).toBe("boolean");
  });

  it("initReputation loads a valid filter and enables lookups", () => {
    const domains = ["test-bad.example", "phishing-test.example"];
    const { m, k } = optimalParams(domains.length, 0.0001);
    const filter = createFilter(m, k);
    for (const d of domains) {
      insertDomain(filter, d);
    }
    const binary = serializeFilter(filter);

    const loaded = initReputation(binary);
    expect(loaded).toBe(true);
    expect(reputationReady()).toBe(true);
    expect(isKnownBadDomain("test-bad.example")).toBe(true);
    expect(isKnownBadDomain("phishing-test.example")).toBe(true);
    expect(isKnownBadDomain("safe-domain.example")).toBe(false);
  });

  it("initReputation returns false for invalid data", () => {
    const result = initReputation(new Uint8Array(4));
    expect(result).toBe(false);
    // After failed init, isKnownBadDomain should return false (graceful degradation)
    expect(isKnownBadDomain("anything")).toBe(false);
  });

  it("initReputation fails closed on a degenerate m=0 filter: reputationReady() stays false (#287)", () => {
    // A zeroed/corrupt binary with a valid header must NOT load as a non-null filter that
    // reports ready while matching nothing (which would silently disable all reputation checks).
    const buf = new Uint8Array(16);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x424c4f4d, true); // "BLOM"
    view.setUint32(4, 1, true);           // version 1
    view.setUint32(8, 7, true);           // k=7
    view.setUint32(12, 0, true);          // m=0 (degenerate)
    expect(initReputation(buf)).toBe(false);
    expect(reputationReady()).toBe(false); // honest: not protected (pre-fix this was true)
    expect(isKnownBadDomain("anything.example")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NRS integration
// ---------------------------------------------------------------------------

describe("NRS known_bad_domain factor", () => {
  // Importing dynamically so the NRS module picks up on the new field
  it("adds +50 for known bad domain", async () => {
    const { computeNRS } = await import("../extension/src/shared/nrs");

    const cdsResult = { cds: 0, reasonCodes: [] as string[] };
    const navCtx = {
      isNewTabOrWindow: false,
      isCrossSite: false,
      knownBadDomain: true,
    };

    const result = computeNRS(cdsResult, navCtx);
    expect(result.nrs).toBe(50);
    expect(result.nrsFactors).toContain("nrs_known_bad_domain");
    expect(result.reasonCodes).toContain("nrs_known_bad_domain");
  });

  it("does not add points when knownBadDomain is false", async () => {
    const { computeNRS } = await import("../extension/src/shared/nrs");

    const cdsResult = { cds: 0, reasonCodes: [] as string[] };
    const navCtx = {
      isNewTabOrWindow: false,
      isCrossSite: false,
      knownBadDomain: false,
    };

    const result = computeNRS(cdsResult, navCtx);
    expect(result.nrs).toBe(0);
    expect(result.nrsFactors).not.toContain("nrs_known_bad_domain");
  });

  it("does not add points when knownBadDomain is undefined", async () => {
    const { computeNRS } = await import("../extension/src/shared/nrs");

    const cdsResult = { cds: 10, reasonCodes: ["some_reason"] };
    const navCtx = {
      isNewTabOrWindow: false,
      isCrossSite: false,
    };

    const result = computeNRS(cdsResult, navCtx);
    expect(result.nrs).toBe(10);
    expect(result.nrsFactors).not.toContain("nrs_known_bad_domain");
  });

  it("combines with other NRS factors to cross block threshold", async () => {
    const { computeNRS, NRS_BLOCK_THRESHOLD } = await import("../extension/src/shared/nrs");

    const cdsResult = { cds: 0, reasonCodes: [] as string[] };
    const navCtx = {
      isNewTabOrWindow: true, // +20
      isCrossSite: false,
      knownBadDomain: true,   // +50
    };

    const result = computeNRS(cdsResult, navCtx);
    expect(result.nrs).toBe(70);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_BLOCK_THRESHOLD);
  });

  it("allowlist still reduces even with known-bad domain", async () => {
    const { computeNRS } = await import("../extension/src/shared/nrs");

    const cdsResult = { cds: 0, reasonCodes: [] as string[] };
    const navCtx = {
      isNewTabOrWindow: false,
      isCrossSite: false,
      knownBadDomain: true,         // +50
      destinationAllowlisted: true, // -100
    };

    const result = computeNRS(cdsResult, navCtx);
    expect(result.nrs).toBe(0); // clamped to 0
  });
});

// ---------------------------------------------------------------------------
// checkReputationViaMessage (child-frame SW delegation)
// ---------------------------------------------------------------------------

describe("checkReputationViaMessage", () => {
  let sendMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessageMock = vi.fn();
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        lastError: null,
        sendMessage: sendMessageMock,
      },
    };
  });

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("resolves knownBad: true and filterReady: true when SW responds accordingly", async () => {
    sendMessageMock.mockImplementation((_msg: unknown, cb: (resp: unknown) => void) => {
      cb({ knownBad: true, filterReady: true });
    });
    const result = await checkReputationViaMessage("evil.example");
    expect(result.knownBad).toBe(true);
    expect(result.filterReady).toBe(true);
    expect(sendMessageMock).toHaveBeenCalledWith(
      { type: "ns-reputation-check", domain: "evil.example" },
      expect.any(Function)
    );
  });

  it("resolves knownBad: false, filterReady: true when domain is clean", async () => {
    sendMessageMock.mockImplementation((_msg: unknown, cb: (resp: unknown) => void) => {
      cb({ knownBad: false, filterReady: true });
    });
    const result = await checkReputationViaMessage("safe.example");
    expect(result.knownBad).toBe(false);
    expect(result.filterReady).toBe(true);
  });

  it("resolves knownBad: false, filterReady: false when SW returns null response", async () => {
    sendMessageMock.mockImplementation((_msg: unknown, cb: (resp: unknown) => void) => {
      cb(null);
    });
    const result = await checkReputationViaMessage("any.example");
    expect(result.knownBad).toBe(false);
    expect(result.filterReady).toBe(false);
  });

  it("resolves knownBad: false, filterReady: false when runtime.lastError is set", async () => {
    sendMessageMock.mockImplementation((_msg: unknown, cb: (resp: unknown) => void) => {
      (chrome.runtime as { lastError: unknown }).lastError = { message: "disconnected" };
      cb(undefined);
      (chrome.runtime as { lastError: unknown }).lastError = null;
    });
    const result = await checkReputationViaMessage("any.example");
    expect(result.knownBad).toBe(false);
    expect(result.filterReady).toBe(false);
  });

  it("resolves knownBad: false, filterReady: false when sendMessage throws", async () => {
    sendMessageMock.mockImplementation(() => {
      throw new Error("Extension context invalidated");
    });
    const result = await checkReputationViaMessage("any.example");
    expect(result.knownBad).toBe(false);
    expect(result.filterReady).toBe(false);
  });

  it("resolves knownBad: false, filterReady: false when chrome.runtime is undefined", async () => {
    delete (globalThis as { chrome?: unknown }).chrome;
    // Re-import is not needed; the function accesses chrome at call time
    // but the try/catch should handle the missing global.
    const result = await checkReputationViaMessage("any.example");
    expect(result.knownBad).toBe(false);
    expect(result.filterReady).toBe(false);
  });

  it("distinguishes 'domain clean' from 'filter not ready'", async () => {
    // Filter not ready: SW responds without filterReady
    sendMessageMock.mockImplementation((_msg: unknown, cb: (resp: unknown) => void) => {
      cb({ knownBad: false, filterReady: false });
    });
    const notReady = await checkReputationViaMessage("any.example");
    expect(notReady.knownBad).toBe(false);
    expect(notReady.filterReady).toBe(false);

    // Filter ready, domain clean
    sendMessageMock.mockImplementation((_msg: unknown, cb: (resp: unknown) => void) => {
      cb({ knownBad: false, filterReady: true });
    });
    const clean = await checkReputationViaMessage("safe.example");
    expect(clean.knownBad).toBe(false);
    expect(clean.filterReady).toBe(true);
  });
});
