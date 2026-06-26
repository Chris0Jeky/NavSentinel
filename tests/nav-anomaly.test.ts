import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  classifyDomain,
  getAnomalyScoreSync,
  applyDecay,
  normalizeProfile,
  pruneBurstRecords,
  computeAnomalyScore,
  recordNavigationAnomaly,
  primeAnomalySession,
  clearNavProfile,
  _resetRecentNavs,
  _getRecentNavs,
  NAV_PROFILE_KEY,
  DECAY_INTERVAL_MS,
  MAX_TOTAL_NAVIGATIONS,
  BURST_WINDOW_MS,
  MAX_BURST_RECORDS,
  BURST_RECORD_TTL_MS,
  BASE_ANOMALY_SCORE,
  BURST_3_PLUS_BONUS,
  ANOMALY_SCORE_CAP,
  MIN_NAVIGATIONS_FOR_ANOMALY,
  type NavProfile,
  type BurstRecord,
} from "../extension/src/shared/nav_anomaly";

// ---------------------------------------------------------------------------
// chrome.storage.local mock
// ---------------------------------------------------------------------------

const store: Record<string, unknown> = {};

function mockGet(keys: string | string[]) {
  const ks = Array.isArray(keys) ? keys : [keys];
  const result: Record<string, unknown> = {};
  for (const k of ks) {
    if (k in store) result[k] = structuredClone(store[k]);
  }
  return Promise.resolve(result);
}

function mockSet(items: Record<string, unknown>) {
  for (const [k, v] of Object.entries(items)) {
    store[k] = structuredClone(v);
  }
  return Promise.resolve();
}

(globalThis as { chrome?: unknown }).chrome = {
  storage: {
    local: {
      get: vi.fn(mockGet),
      set: vi.fn(mockSet),
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStoredProfile(): NavProfile | undefined {
  return store[NAV_PROFILE_KEY] as NavProfile | undefined;
}

function makeProfile(overrides: Partial<NavProfile> = {}): NavProfile {
  return {
    categoryCounts: {},
    totalNavigations: 0,
    lastUpdated: Date.now(),
    recentBurst: [],
    ...overrides,
  };
}

/**
 * Pre-populate the profile with navigations so anomaly detection activates.
 * Adds MIN_NAVIGATIONS_FOR_ANOMALY+10 navigations to the "entertainment" category.
 */
function makeEstablishedProfile(now: number): NavProfile {
  const count = MIN_NAVIGATIONS_FOR_ANOMALY + 10;
  return makeProfile({
    categoryCounts: { entertainment: count },
    totalNavigations: count,
    lastUpdated: now,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  _resetRecentNavs();
  // Reset the storage mocks (incl. any queued mockRejectedValueOnce) so a one-time override
  // from one test cannot bleed into the next test's first get/set call (#286 R1).
  (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockReset().mockImplementation(mockGet);
  (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockReset().mockImplementation(mockSet);
});

// ========================================================================
// Category classification
// ========================================================================

describe("classifyDomain", () => {
  it("classifies known crypto domains", () => {
    expect(classifyDomain("binance.com")).toBe("crypto");
    expect(classifyDomain("coinbase.com")).toBe("crypto");
    expect(classifyDomain("metamask.io")).toBe("crypto");
  });

  it("classifies known banking domains", () => {
    expect(classifyDomain("chase.com")).toBe("banking");
    expect(classifyDomain("paypal.com")).toBe("banking");
    expect(classifyDomain("revolut.com")).toBe("banking");
  });

  it("classifies known social domains", () => {
    expect(classifyDomain("facebook.com")).toBe("social");
    expect(classifyDomain("twitter.com")).toBe("social");
    expect(classifyDomain("linkedin.com")).toBe("social");
    expect(classifyDomain("x.com")).toBe("social");
  });

  it("classifies known email domains", () => {
    expect(classifyDomain("gmail.com")).toBe("email");
    expect(classifyDomain("outlook.com")).toBe("email");
    expect(classifyDomain("proton.me")).toBe("email");
  });

  it("classifies known shopping domains", () => {
    expect(classifyDomain("amazon.com")).toBe("shopping");
    expect(classifyDomain("ebay.com")).toBe("shopping");
  });

  it("classifies known developer domains", () => {
    expect(classifyDomain("github.com")).toBe("developer");
    expect(classifyDomain("stackoverflow.com")).toBe("developer");
    expect(classifyDomain("npmjs.com")).toBe("developer");
  });

  it("classifies known entertainment domains", () => {
    expect(classifyDomain("youtube.com")).toBe("entertainment");
    expect(classifyDomain("netflix.com")).toBe("entertainment");
    expect(classifyDomain("spotify.com")).toBe("entertainment");
  });

  it("classifies known news domains", () => {
    expect(classifyDomain("bbc.com")).toBe("news");
    expect(classifyDomain("cnn.com")).toBe("news");
    expect(classifyDomain("reuters.com")).toBe("news");
  });

  it("uses keyword fallback for crypto-related domains", () => {
    expect(classifyDomain("my-wallet-connect.xyz")).toBe("crypto");
    expect(classifyDomain("super-defi-swap.com")).toBe("crypto");
    expect(classifyDomain("nft-marketplace.io")).toBe("crypto");
    expect(classifyDomain("blockchain-verify.org")).toBe("crypto");
  });

  it("uses keyword fallback for banking-related domains", () => {
    expect(classifyDomain("my-bank-secure.com")).toBe("banking");
    expect(classifyDomain("credit-union-login.org")).toBe("banking");
  });

  it("uses keyword fallback for shopping-related domains", () => {
    expect(classifyDomain("best-deals-shop.com")).toBe("shopping");
  });

  it("uses keyword fallback for news-related domains", () => {
    expect(classifyDomain("daily-news-press.com")).toBe("news");
  });

  it("uses keyword fallback for government-related domains", () => {
    expect(classifyDomain("tax-forms.gov")).toBe("government");
    expect(classifyDomain("services.gov.uk")).toBe("government");
  });

  it("uses keyword fallback for education-related domains", () => {
    expect(classifyDomain("courses.edu")).toBe("education");
    expect(classifyDomain("state-university.edu.au")).toBe("education");
  });

  it("returns unknown for unrecognized domains", () => {
    expect(classifyDomain("random-site-12345.xyz")).toBe("unknown");
    expect(classifyDomain("totally-unique-domain.net")).toBe("unknown");
  });

  it("handles empty string", () => {
    expect(classifyDomain("")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(classifyDomain("GITHUB.COM")).toBe("developer");
    expect(classifyDomain("GitHub.com")).toBe("developer");
  });

  it("classifies subdomains via registrable domain lookup", () => {
    // sub.github.com should resolve to github.com via PSL
    expect(classifyDomain("sub.github.com")).toBe("developer");
  });

  it("does not false-positive on domains containing 'press' as substring", () => {
    expect(classifyDomain("express.com")).toBe("unknown");
    expect(classifyDomain("wordpress.com")).toBe("unknown");
  });

  it("does not false-positive on domains containing 'shop' as substring", () => {
    expect(classifyDomain("workshop-tools.com")).toBe("unknown");
  });

  it("does not false-positive on domains containing 'store' as substring", () => {
    expect(classifyDomain("restore-backup.com")).toBe("unknown");
  });

  it("does not false-positive on domains containing 'drive' as substring", () => {
    expect(classifyDomain("driveway-repair.com")).toBe("unknown");
  });

  it("still matches anchored keywords at segment boundaries", () => {
    expect(classifyDomain("my-press.com")).toBe("news");
    expect(classifyDomain("press.example.com")).toBe("news");
    expect(classifyDomain("shop.example.com")).toBe("shopping");
    expect(classifyDomain("my-store.net")).toBe("shopping");
    expect(classifyDomain("drive.example.com")).toBe("cloud");
  });
});

// ========================================================================
// Decay logic
// ========================================================================

describe("applyDecay", () => {
  it("does not decay if less than one week has passed", () => {
    const now = Date.now();
    const profile = makeProfile({
      categoryCounts: { crypto: 100, entertainment: 50 },
      totalNavigations: 150,
      lastUpdated: now - DECAY_INTERVAL_MS + 1000,
    });
    const result = applyDecay(profile, now);
    expect(result).toBe(false);
    expect(profile.categoryCounts["crypto"]).toBe(100);
  });

  it("decays by 10% after exactly one week", () => {
    const now = Date.now();
    const profile = makeProfile({
      categoryCounts: { crypto: 100, entertainment: 50 },
      totalNavigations: 150,
      lastUpdated: now - DECAY_INTERVAL_MS,
    });
    const result = applyDecay(profile, now);
    expect(result).toBe(true);
    expect(profile.categoryCounts["crypto"]).toBe(90); // floor(100 * 0.9)
    expect(profile.categoryCounts["entertainment"]).toBe(45); // floor(50 * 0.9)
    // totalNavigations recomputed from category counts
    expect(profile.totalNavigations).toBe(135);
  });

  it("applies multiple decay rounds for multiple elapsed weeks", () => {
    const now = Date.now();
    const profile = makeProfile({
      categoryCounts: { crypto: 100 },
      totalNavigations: 100,
      lastUpdated: now - 2 * DECAY_INTERVAL_MS,
    });
    applyDecay(profile, now);
    // Round 1: floor(100 * 0.9) = 90
    // Round 2: floor(90 * 0.9) = 81
    expect(profile.categoryCounts["crypto"]).toBe(81);
  });

  it("prunes categories that reach zero", () => {
    const now = Date.now();
    const profile = makeProfile({
      categoryCounts: { crypto: 1 },
      totalNavigations: 1,
      lastUpdated: now - DECAY_INTERVAL_MS,
    });
    applyDecay(profile, now);
    // floor(1 * 0.9) = 0 => pruned
    expect(profile.categoryCounts["crypto"]).toBeUndefined();
    expect(profile.totalNavigations).toBe(0);
  });

  it("handles non-finite lastUpdated", () => {
    const profile = makeProfile({ lastUpdated: NaN });
    const result = applyDecay(profile, Date.now());
    expect(result).toBe(false);
  });

  it("caps decay iterations to prevent infinite loops", () => {
    const now = Date.now();
    const profile = makeProfile({
      categoryCounts: { crypto: 1000000 },
      totalNavigations: 1000000,
      lastUpdated: now - 100 * DECAY_INTERVAL_MS, // 100 weeks
    });
    // Should not hang; capped at 52 iterations
    applyDecay(profile, now);
    expect(profile.lastUpdated).toBe(now);
  });
});

// ========================================================================
// Profile normalization
// ========================================================================

describe("normalizeProfile", () => {
  it("does not normalize when under the cap", () => {
    const profile = makeProfile({
      categoryCounts: { crypto: 100, banking: 200 },
      totalNavigations: 300,
    });
    normalizeProfile(profile);
    expect(profile.categoryCounts["crypto"]).toBe(100);
    expect(profile.categoryCounts["banking"]).toBe(200);
  });

  it("normalizes when over the cap", () => {
    const profile = makeProfile({
      categoryCounts: { crypto: 8000, banking: 4000 },
      totalNavigations: 12000,
    });
    normalizeProfile(profile);
    // Scale factor = (10000/2) / 12000 = 0.4167
    // crypto: floor(8000 * 0.4167) = 3333
    // banking: floor(4000 * 0.4167) = 1666
    expect(profile.totalNavigations).toBeLessThanOrEqual(MAX_TOTAL_NAVIGATIONS);
    // Proportional relationship preserved
    const ratio = profile.categoryCounts["crypto"]! / profile.categoryCounts["banking"]!;
    expect(ratio).toBeCloseTo(2, 0);
  });

  it("ensures minimum count of 1 per category after normalization", () => {
    const counts: Record<string, number> = {};
    // One huge category and one tiny category
    counts["crypto"] = MAX_TOTAL_NAVIGATIONS + 100;
    counts["banking"] = 1;
    const profile = makeProfile({
      categoryCounts: counts,
      totalNavigations: MAX_TOTAL_NAVIGATIONS + 101,
    });
    normalizeProfile(profile);
    expect(profile.categoryCounts["banking"]).toBeGreaterThanOrEqual(1);
  });
});

// ========================================================================
// Burst record pruning
// ========================================================================

describe("pruneBurstRecords", () => {
  it("removes records older than 24 hours", () => {
    const now = Date.now();
    const profile = makeProfile({
      recentBurst: [
        { category: "crypto", ts: now - BURST_RECORD_TTL_MS - 1000, count: 2 },
        { category: "banking", ts: now - 1000, count: 3 },
      ],
    });
    pruneBurstRecords(profile, now);
    expect(profile.recentBurst.length).toBe(1);
    expect(profile.recentBurst[0]!.category).toBe("banking");
  });

  it("caps at MAX_BURST_RECORDS", () => {
    const now = Date.now();
    const bursts: BurstRecord[] = [];
    for (let i = 0; i < MAX_BURST_RECORDS + 5; i++) {
      bursts.push({ category: "crypto", ts: now - i * 1000, count: 2 });
    }
    const profile = makeProfile({ recentBurst: bursts });
    pruneBurstRecords(profile, now);
    expect(profile.recentBurst.length).toBe(MAX_BURST_RECORDS);
  });

  it("handles empty burst records", () => {
    const profile = makeProfile({ recentBurst: [] });
    pruneBurstRecords(profile, Date.now());
    expect(profile.recentBurst.length).toBe(0);
  });
});

// ========================================================================
// Anomaly score computation
// ========================================================================

describe("computeAnomalyScore", () => {
  it("returns 0 for unknown category", () => {
    const profile = makeProfile({
      categoryCounts: { entertainment: 100 },
      totalNavigations: 100,
    });
    const score = computeAnomalyScore(profile, "unknown", 3);
    expect(score).toBe(0);
  });

  it("returns 0 for a corrupt non-finite totalNavigations (no gate bypass) (#373)", () => {
    // Pre-fix: NaN < MIN is false AND NaN >= RARE_CATEGORY_THRESHOLD is false, so BOTH the
    // min-nav gate and the rarity gate are bypassed and a burst scores ~15. A corrupt
    // profile must score nothing.
    expect(computeAnomalyScore(makeProfile({ categoryCounts: { crypto: 1 }, totalNavigations: NaN }), "crypto", 3)).toBe(0);
    expect(computeAnomalyScore(makeProfile({ categoryCounts: { crypto: 1 }, totalNavigations: Infinity }), "crypto", 3)).toBe(0);
  });

  it("returns 0 when total navigations below minimum", () => {
    const profile = makeProfile({
      categoryCounts: { entertainment: MIN_NAVIGATIONS_FOR_ANOMALY - 1 },
      totalNavigations: MIN_NAVIGATIONS_FOR_ANOMALY - 1,
    });
    const score = computeAnomalyScore(profile, "crypto", 3);
    expect(score).toBe(0);
  });

  it("returns 0 for a common category (>= 5% of navigations)", () => {
    const profile = makeProfile({
      categoryCounts: { entertainment: 90, crypto: 10 },
      totalNavigations: 100,
    });
    // crypto is 10/100 = 10%, well above 5%
    const score = computeAnomalyScore(profile, "crypto", 3);
    expect(score).toBe(0);
  });

  it("returns 0 when burst count is below threshold", () => {
    const profile = makeProfile({
      categoryCounts: { entertainment: 100 },
      totalNavigations: 100,
    });
    // crypto is 0/100 = 0%, but only 1 navigation (below BURST_MIN_COUNT)
    const score = computeAnomalyScore(profile, "crypto", 1);
    expect(score).toBe(0);
  });

  it("returns BASE_ANOMALY_SCORE when conditions met with 2 bursts", () => {
    const profile = makeProfile({
      categoryCounts: { entertainment: 100 },
      totalNavigations: 100,
    });
    // crypto is 0/100 = 0% (rare) AND 2 navigations in window
    const score = computeAnomalyScore(profile, "crypto", 2);
    expect(score).toBe(BASE_ANOMALY_SCORE);
  });

  it("returns BASE_ANOMALY_SCORE + BURST_3_PLUS_BONUS for 3+ bursts", () => {
    const profile = makeProfile({
      categoryCounts: { entertainment: 100 },
      totalNavigations: 100,
    });
    const score = computeAnomalyScore(profile, "crypto", 3);
    expect(score).toBe(BASE_ANOMALY_SCORE + BURST_3_PLUS_BONUS);
  });

  it("caps at ANOMALY_SCORE_CAP", () => {
    const profile = makeProfile({
      categoryCounts: { entertainment: 100 },
      totalNavigations: 100,
    });
    const score = computeAnomalyScore(profile, "crypto", 10);
    expect(score).toBeLessThanOrEqual(ANOMALY_SCORE_CAP);
    expect(score).toBe(15);
  });

  it("detects near-threshold rare category (just under 5%)", () => {
    const profile = makeProfile({
      categoryCounts: { entertainment: 10000, crypto: 490 },
      totalNavigations: 10490,
    });
    // crypto is 490/10490 = 4.67%, just under 5% threshold
    const score = computeAnomalyScore(profile, "crypto", 2);
    expect(score).toBe(BASE_ANOMALY_SCORE);
  });

  it("does NOT flag when pre-burst frequency is at 5%", () => {
    // After burst inflation correction (recentCategoryCount=2, subtract 1):
    // preBurstCount = 502 - 1 = 501, preBurstTotal = 10000 - 1 = 9999
    // frequency = 501/9999 = 5.01% >= 5% => no flag
    const profile = makeProfile({
      categoryCounts: { entertainment: 9498, crypto: 502 },
      totalNavigations: 10000,
    });
    const score = computeAnomalyScore(profile, "crypto", 2);
    expect(score).toBe(0);
  });
});

// ========================================================================
// recordNavigationAnomaly (integrated with storage)
// ========================================================================

describe("recordNavigationAnomaly", () => {
  it("returns 0 for empty profile (below MIN_NAVIGATIONS_FOR_ANOMALY)", async () => {
    const score = await recordNavigationAnomaly("binance.com");
    expect(score).toBe(0);
  });

  it("records navigation and updates profile", async () => {
    await recordNavigationAnomaly("youtube.com");
    const profile = getStoredProfile();
    expect(profile).toBeDefined();
    expect(profile!.categoryCounts["entertainment"]).toBe(1);
    expect(profile!.totalNavigations).toBe(1);
  });

  it("returns anomaly score for burst into rare category", async () => {
    const now = Date.now();
    // Set up an established profile with all entertainment navigations
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);

    // Burst: 2 rapid crypto navigations
    const score1 = await recordNavigationAnomaly("binance.com", now + 1000);
    const score2 = await recordNavigationAnomaly("coinbase.com", now + 2000);

    // First crypto nav: only 1 in window, no anomaly
    expect(score1).toBe(0);
    // Second crypto nav: 2 in window, anomaly detected
    expect(score2).toBe(BASE_ANOMALY_SCORE);
  });

  it("rolls back the sliding-window entry when storage fails, so no phantom burst (#286)", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);

    // First crypto nav: force loadProfile's storage read to reject once.
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("storage fail")
    );
    await expect(recordNavigationAnomaly("binance.com", now + 1000)).rejects.toThrow();
    expect(_getRecentNavs().length).toBe(0); // phantom removed (pre-fix: 1)

    // Second crypto nav (storage healthy again). Pre-fix the failed nav left a phantom
    // 'crypto' entry in recentNavs, so this would see count=2 and fire a burst anomaly
    // (BASE_ANOMALY_SCORE). Post-fix the phantom is rolled back, so count=1 -> no burst -> 0.
    const score = await recordNavigationAnomaly("coinbase.com", now + 2000);
    expect(score).toBe(0);
  });

  it("rolls back the sliding-window entry when saveProfile fails too (#286)", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);

    // First crypto nav: loadProfile succeeds but saveProfile's storage write rejects once
    // (the catch is shared, so this exercises the set-rejection branch of the rollback).
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("set fail")
    );
    await expect(recordNavigationAnomaly("binance.com", now + 1000)).rejects.toThrow();
    expect(_getRecentNavs().length).toBe(0); // phantom removed (pre-fix: 1)

    // Second crypto nav (storage healthy): no phantom from the failed first nav.
    const score = await recordNavigationAnomaly("coinbase.com", now + 2000);
    expect(score).toBe(0);
  });

  it("keeps the serialization chain alive after a failure so later queued calls run (#286)", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);

    // Queue three crypto navs synchronously; the FIRST fails its storage read.
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("storage fail")
    );
    const pA = recordNavigationAnomaly("binance.com", now + 1000);
    const pB = recordNavigationAnomaly("coinbase.com", now + 2000);
    const pC = recordNavigationAnomaly("metamask.io", now + 3000);

    await expect(pA).rejects.toThrow();
    const scoreB = await pB;
    const scoreC = await pC;

    // A failed and rolled back its phantom; the chain stayed alive so B and C ran against
    // correct state: B is the 1st crypto in-window (count=1 -> 0), C is the 2nd (count=2 -> burst).
    expect(scoreB).toBe(0);
    expect(scoreC).toBe(BASE_ANOMALY_SCORE);
    expect(_getRecentNavs().length).toBe(2); // exactly B + C (A rolled back)
  });

  it("returns higher score for 3+ burst into rare category", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);

    await recordNavigationAnomaly("binance.com", now + 1000);
    await recordNavigationAnomaly("coinbase.com", now + 2000);
    const score3 = await recordNavigationAnomaly("metamask.io", now + 3000);

    expect(score3).toBe(BASE_ANOMALY_SCORE + BURST_3_PLUS_BONUS);
  });

  it("does not flag burst into common category", async () => {
    const now = Date.now();
    // Profile with lots of entertainment navigations
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);

    // Burst into entertainment (the established category)
    const score1 = await recordNavigationAnomaly("youtube.com", now + 1000);
    const score2 = await recordNavigationAnomaly("netflix.com", now + 2000);
    const score3 = await recordNavigationAnomaly("spotify.com", now + 3000);

    expect(score1).toBe(0);
    expect(score2).toBe(0);
    expect(score3).toBe(0);
  });

  it("records burst in recentBurst when anomaly detected", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);

    await recordNavigationAnomaly("binance.com", now + 1000);
    await recordNavigationAnomaly("coinbase.com", now + 2000);

    const profile = getStoredProfile()!;
    expect(profile.recentBurst.length).toBe(1);
    expect(profile.recentBurst[0]!.category).toBe("crypto");
    expect(profile.recentBurst[0]!.count).toBe(2);
  });

  it("does not flag navigations to unknown category", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);

    await recordNavigationAnomaly("random-xyz-domain.net", now + 1000);
    const score = await recordNavigationAnomaly("another-xyz-domain.net", now + 2000);

    expect(score).toBe(0);
  });

  it("applies decay on load", async () => {
    const now = Date.now();
    // Profile last updated 2 weeks ago
    store[NAV_PROFILE_KEY] = makeProfile({
      categoryCounts: { entertainment: 100 },
      totalNavigations: 100,
      lastUpdated: now - 2 * DECAY_INTERVAL_MS,
    });

    await recordNavigationAnomaly("youtube.com", now);

    const profile = getStoredProfile()!;
    // After 2 rounds of decay: floor(floor(100*0.9)*0.9) = floor(90*0.9) = 81, then +1 = 82
    expect(profile.categoryCounts["entertainment"]).toBe(82);
  });

  it("normalizes when cap exceeded", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeProfile({
      categoryCounts: { entertainment: MAX_TOTAL_NAVIGATIONS },
      totalNavigations: MAX_TOTAL_NAVIGATIONS,
      lastUpdated: now,
    });

    await recordNavigationAnomaly("youtube.com", now + 1000);

    const profile = getStoredProfile()!;
    expect(profile.totalNavigations).toBeLessThanOrEqual(MAX_TOTAL_NAVIGATIONS);
  });

  it("serializes concurrent writes", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);

    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(recordNavigationAnomaly("youtube.com", now + i * 100));
    }
    await Promise.all(promises);

    const profile = getStoredProfile()!;
    // Initial count was MIN_NAVIGATIONS_FOR_ANOMALY + 10, plus 5 new ones
    const expectedTotal = MIN_NAVIGATIONS_FOR_ANOMALY + 10 + 5;
    expect(profile.totalNavigations).toBe(expectedTotal);
  });
});

// ========================================================================
// In-memory sliding window
// ========================================================================

describe("sliding window", () => {
  it("tracks recent navigations", async () => {
    const now = Date.now();
    await recordNavigationAnomaly("youtube.com", now);
    await recordNavigationAnomaly("github.com", now + 1000);

    const recent = _getRecentNavs();
    expect(recent.length).toBe(2);
    expect(recent[0]!.category).toBe("entertainment");
    expect(recent[1]!.category).toBe("developer");
  });

  it("prunes entries older than BURST_WINDOW_MS", async () => {
    const now = Date.now();
    await recordNavigationAnomaly("youtube.com", now);
    // Navigate well past the burst window
    await recordNavigationAnomaly("github.com", now + BURST_WINDOW_MS + 1000);

    const recent = _getRecentNavs();
    // The old entry should have been pruned
    expect(recent.length).toBe(1);
    expect(recent[0]!.category).toBe("developer");
  });
});

// ========================================================================
// clearNavProfile
// ========================================================================

describe("clearNavProfile", () => {
  it("clears stored profile and in-memory state", async () => {
    await recordNavigationAnomaly("youtube.com");
    await clearNavProfile();

    expect(getStoredProfile()).toBeNull();
    expect(_getRecentNavs().length).toBe(0);
  });
});

// ========================================================================
// Edge cases
// ========================================================================

describe("edge cases", () => {
  it("handles single navigation (no anomaly possible)", async () => {
    const score = await recordNavigationAnomaly("binance.com");
    expect(score).toBe(0);
    const profile = getStoredProfile()!;
    expect(profile.totalNavigations).toBe(1);
  });

  it("handles all same category navigations", async () => {
    const now = Date.now();
    // Build up a profile of only entertainment
    for (let i = 0; i < 25; i++) {
      await recordNavigationAnomaly("youtube.com", now + i * 100);
    }
    const profile = getStoredProfile()!;
    expect(profile.categoryCounts["entertainment"]).toBe(25);
    expect(profile.totalNavigations).toBe(25);
    // All same category, no anomaly possible within that category
  });

  it("score is always within 0-15 range", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);

    // Many rapid crypto navigations
    let maxScore = 0;
    for (let i = 0; i < 10; i++) {
      const score = await recordNavigationAnomaly("binance.com", now + i * 500);
      maxScore = Math.max(maxScore, score);
    }
    expect(maxScore).toBeLessThanOrEqual(ANOMALY_SCORE_CAP);
    expect(maxScore).toBeGreaterThanOrEqual(0);
  });

  it("burst detection resets after BURST_WINDOW_MS", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);

    // First burst
    await recordNavigationAnomaly("binance.com", now + 1000);
    const scoreBurst = await recordNavigationAnomaly("coinbase.com", now + 2000);
    expect(scoreBurst).toBe(BASE_ANOMALY_SCORE);

    // Wait past the burst window, then try again with a fresh nav
    // (Now crypto has 2 in the profile, but none are in the sliding window)
    _resetRecentNavs(); // Simulate time passing by clearing the window
    const scoreLater = await recordNavigationAnomaly("binance.com", now + BURST_WINDOW_MS + 5000);
    // Only 1 nav in the window now, below BURST_MIN_COUNT
    expect(scoreLater).toBe(0);
  });
});

// ========================================================================
// getAnomalyScoreSync
// ========================================================================

describe("getAnomalyScoreSync", () => {
  it("returns 0 when session nav count is below minimum", () => {
    // sessionNavCount starts at 0 after _resetRecentNavs
    const score = getAnomalyScoreSync("binance.com");
    expect(score).toBe(0);
  });

  it("returns BASE_ANOMALY_SCORE (10) for 1 prior crypto nav + the current one (=2)", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);
    // Build up sessionNavCount via recordNavigationAnomaly
    for (let i = 0; i < MIN_NAVIGATIONS_FOR_ANOMALY + 1; i++) {
      await recordNavigationAnomaly("youtube.com", now + i * 100);
    }
    _resetRecentNavs();

    // One crypto nav already in the window; the current nav is the 2nd.
    await recordNavigationAnomaly("binance.com", now + 50000);

    // getAnomalyScoreSync counts the current nav (+1): 1 prior + current = 2 =>
    // BASE, no 3+ bonus.
    const score = getAnomalyScoreSync("metamask.io", now + 51000);
    expect(score).toBe(BASE_ANOMALY_SCORE);
    expect(score).toBe(10);
  });

  it("counts the current nav so a completing 3rd crypto nav scores the bonus (no 1-nav lag)", async () => {
    // Regression guard for the D-ANOM sync lag fix: 2 crypto already in window,
    // scoring the current (3rd) nav. Before the fix the sync score saw only the
    // 2 already-recorded and returned BASE (10) — one nav behind what
    // recordNavigationAnomaly computes for the very same navigation (15).
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);
    for (let i = 0; i < MIN_NAVIGATIONS_FOR_ANOMALY + 1; i++) {
      await recordNavigationAnomaly("youtube.com", now + i * 100);
    }
    _resetRecentNavs();

    await recordNavigationAnomaly("binance.com", now + 50000);
    await recordNavigationAnomaly("coinbase.com", now + 51000);

    const score = getAnomalyScoreSync("metamask.io", now + 52000);
    expect(score).toBe(BASE_ANOMALY_SCORE + BURST_3_PLUS_BONUS);
    expect(score).toBe(15);
  });

  it("returns 15 for 3+ crypto navs already in the window", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);
    for (let i = 0; i < MIN_NAVIGATIONS_FOR_ANOMALY + 1; i++) {
      await recordNavigationAnomaly("youtube.com", now + i * 100);
    }
    _resetRecentNavs();

    // Record 3 crypto navs into the sliding window
    await recordNavigationAnomaly("binance.com", now + 50000);
    await recordNavigationAnomaly("coinbase.com", now + 51000);
    await recordNavigationAnomaly("metamask.io", now + 52000);

    // Sync check sees 3 crypto in window => recentCount = 3 => 10 + 5 = 15
    const score = getAnomalyScoreSync("walletconnect.com", now + 53000);
    expect(score).toBe(BASE_ANOMALY_SCORE + BURST_3_PLUS_BONUS);
    expect(score).toBe(15);
  });

  it("returns 0 for unknown category even with burst", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);
    for (let i = 0; i < MIN_NAVIGATIONS_FOR_ANOMALY + 1; i++) {
      await recordNavigationAnomaly("youtube.com", now + i * 100);
    }
    _resetRecentNavs();

    await recordNavigationAnomaly("random-xyz-12345.net", now + 50000);
    await recordNavigationAnomaly("another-xyz-99999.net", now + 51000);

    const score = getAnomalyScoreSync("yet-another-random.net", now + 52000);
    expect(score).toBe(0);
  });
});

describe("primeAnomalySession", () => {
  it("seeds sessionNavCount from the stored profile so a returning user is not gated on fresh load", async () => {
    const now = Date.now();
    // Returning user with plenty of history; fresh content-script load (no
    // in-session records yet, sessionNavCount reset to 0).
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);
    _resetRecentNavs();

    await primeAnomalySession();

    // sessionNavCount is now seeded from the stored profile (>= MIN), so a burst
    // detected early in the session is scored rather than blanked by the gate.
    await recordNavigationAnomaly("binance.com", now + 50000);
    await recordNavigationAnomaly("coinbase.com", now + 51000);
    const score = getAnomalyScoreSync("metamask.io", now + 52000);
    expect(score).toBe(BASE_ANOMALY_SCORE + BURST_3_PLUS_BONUS);
  });

  it("is a no-op-safe read when there is no stored profile (new user)", async () => {
    delete store[NAV_PROFILE_KEY];
    _resetRecentNavs();
    await expect(primeAnomalySession()).resolves.toBeUndefined();
    // No history → still gated, score stays 0.
    expect(getAnomalyScoreSync("binance.com", Date.now())).toBe(0);
  });

  it("a corrupt re-prime does not poison the frequency cache while the gate stays armed (#297)", async () => {
    const now = Date.now();
    // 1. Good prime: crypto is a FREQUENT category (50%), so the rarity gate would blank a
    //    crypto burst. This also arms sessionNavCount (>= MIN).
    store[NAV_PROFILE_KEY] = makeProfile({
      categoryCounts: { crypto: 50, entertainment: 50 },
      totalNavigations: 100,
      lastUpdated: now,
    });
    _resetRecentNavs();
    await primeAnomalySession();

    // 2. Build the crypto burst into recentNavs NOW, while the good profile is still stored
    //    (this record keeps the cache crypto-frequent). The score read below adds +1, so
    //    recentCount = 2 meets the burst threshold.
    await recordNavigationAnomaly("binance.com", now + 50000);

    // 3. A CORRUPT re-prime (non-finite totalNavigations) that OMITS crypto, with NO record
    //    afterward. Pre-fix this overwrote cachedCategoryCounts (crypto now looks "rare")
    //    while leaving the gate armed; post-fix the corrupt profile is ignored and the good
    //    frequency cache is preserved — so it is the ONLY thing touching the cache here.
    store[NAV_PROFILE_KEY] = makeProfile({
      categoryCounts: { entertainment: 100 },
      totalNavigations: NaN,
      lastUpdated: now,
    });
    await primeAnomalySession();

    // 4. The crypto burst must STILL be rarity-blanked (crypto is frequent in the preserved
    //    cache). Pre-fix the poisoned cache forgot crypto was frequent → a false-positive 10.
    expect(getAnomalyScoreSync("coinbase.com", now + 51000)).toBe(0);
  });

  it("recordNavigationAnomaly self-heals a corrupt totalNavigations instead of propagating NaN (#373)", async () => {
    const now = Date.now();
    // Corrupt stored profile: category counts intact, totalNavigations NaN.
    store[NAV_PROFILE_KEY] = makeProfile({
      categoryCounts: { crypto: 30, entertainment: 70 },
      totalNavigations: NaN,
      lastUpdated: now,
    });
    _resetRecentNavs();

    await recordNavigationAnomaly("binance.com", now);

    // The re-saved profile must be finite: pre-fix `NaN + 1` re-persisted NaN (sticky) and
    // `Math.max(sessionNavCount, NaN)` poisoned the session gate. Recomputed from counts
    // (30 + 70 = 100) + this nav = 101.
    const saved = store[NAV_PROFILE_KEY] as { totalNavigations: number };
    expect(Number.isFinite(saved.totalNavigations)).toBe(true);
    expect(saved.totalNavigations).toBe(101);
  });
});

describe("getAnomalyScoreSync rarity gate (D-ANOM R2: sync path matches async rarity check)", () => {
  it("rarity-gates a burst to a frequently-visited category (no false positive into NRS)", async () => {
    const now = Date.now();
    // Heavy crypto history: crypto is ~50% of navigations, NOT rare.
    store[NAV_PROFILE_KEY] = makeProfile({
      categoryCounts: { crypto: 50, entertainment: 50 },
      totalNavigations: 100,
      lastUpdated: now,
    });
    _resetRecentNavs();
    await primeAnomalySession(); // seeds sessionNavCount + frequency cache

    // 1 prior crypto + current = 2: burst threshold is met, but because crypto
    // is a frequently-visited category the rarity gate must blank the score.
    // (Without the gate the sync path would return BASE=10 — a false positive.)
    await recordNavigationAnomaly("binance.com", now + 50000);
    const score = getAnomalyScoreSync("coinbase.com", now + 51000);
    expect(score).toBe(0);
  });

  it("still scores a burst to a rare category for the same heavy-history user", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeProfile({
      categoryCounts: { entertainment: 100 }, // no crypto history → crypto is rare
      totalNavigations: 100,
      lastUpdated: now,
    });
    _resetRecentNavs();
    await primeAnomalySession();

    await recordNavigationAnomaly("binance.com", now + 50000);
    const score = getAnomalyScoreSync("coinbase.com", now + 51000);
    expect(score).toBe(BASE_ANOMALY_SCORE);
  });

  it("clearNavProfile resets the session gate so a stale seed cannot keep scoring active", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);
    for (let i = 0; i < MIN_NAVIGATIONS_FOR_ANOMALY + 1; i++) {
      await recordNavigationAnomaly("youtube.com", now + i * 100);
    }
    // sessionNavCount is now high. Clear the profile.
    await clearNavProfile();

    // After clear, priming reads the (now-empty) profile; the gate must be reset,
    // so an early burst is not scored against a profile that no longer exists.
    await primeAnomalySession();
    await recordNavigationAnomaly("binance.com", now + 60000);
    const score = getAnomalyScoreSync("coinbase.com", now + 61000);
    // Only 1 in-session nav after clear → sessionNavCount below MIN → gated.
    expect(score).toBe(0);
  });

  it("clearNavProfile is serialized: a concurrent in-flight record cannot resurrect it", async () => {
    const now = Date.now();
    store[NAV_PROFILE_KEY] = makeEstablishedProfile(now);
    for (let i = 0; i < MIN_NAVIGATIONS_FOR_ANOMALY + 1; i++) {
      await recordNavigationAnomaly("youtube.com", now + i * 100);
    }

    // Fire a record WITHOUT awaiting, then clear immediately. Both run through
    // the `pending` chain, so clear runs AFTER the record completes and wins —
    // the profile is not resurrected by the record's post-clear save.
    const recordP = recordNavigationAnomaly("binance.com", now + 50000);
    const clearP = clearNavProfile();
    await Promise.all([recordP, clearP]);

    expect(store[NAV_PROFILE_KEY]).toBeNull();

    // Gate + cache were reset by the clear: a subsequent burst is not scored
    // against the cleared profile (only 1 in-session nav → below MIN gate).
    await recordNavigationAnomaly("coinbase.com", now + 51000);
    expect(getAnomalyScoreSync("metamask.io", now + 52000)).toBe(0);
  });
});

// ========================================================================
// NRS integration
// ========================================================================

describe("NRS integration", () => {
  it("nrs_nav_anomaly adds capped score to NRS", async () => {
    const { computeNRS } = await import("../extension/src/shared/nrs");
    const result = computeNRS(
      { cds: 30, reasonCodes: [] },
      {
        isNewTabOrWindow: false,
        isCrossSite: false,
        navAnomalyScore: 15,
      },
    );
    expect(result.nrs).toBe(45); // 30 + 15
    expect(result.nrsFactors).toContain("nrs_nav_anomaly");
  });

  it("nrs_nav_anomaly is capped at 15", async () => {
    const { computeNRS } = await import("../extension/src/shared/nrs");
    const result = computeNRS(
      { cds: 30, reasonCodes: [] },
      {
        isNewTabOrWindow: false,
        isCrossSite: false,
        navAnomalyScore: 100, // way over cap
      },
    );
    expect(result.nrs).toBe(45); // 30 + 15 (capped)
    expect(result.nrsFactors).toContain("nrs_nav_anomaly");
  });

  it("nrs_nav_anomaly does not fire when score is 0", async () => {
    const { computeNRS } = await import("../extension/src/shared/nrs");
    const result = computeNRS(
      { cds: 30, reasonCodes: [] },
      {
        isNewTabOrWindow: false,
        isCrossSite: false,
        navAnomalyScore: 0,
      },
    );
    expect(result.nrs).toBe(30);
    expect(result.nrsFactors).not.toContain("nrs_nav_anomaly");
  });

  it("nrs_nav_anomaly does not fire when undefined", async () => {
    const { computeNRS } = await import("../extension/src/shared/nrs");
    const result = computeNRS(
      { cds: 30, reasonCodes: [] },
      {
        isNewTabOrWindow: false,
        isCrossSite: false,
      },
    );
    expect(result.nrs).toBe(30);
    expect(result.nrsFactors).not.toContain("nrs_nav_anomaly");
  });

  it("nrs_nav_anomaly is NOT applied when NRS <= 20 (threshold gate)", async () => {
    const { computeNRS } = await import("../extension/src/shared/nrs");
    // CDS of 20 means base NRS is exactly at the threshold -- should NOT apply
    const result = computeNRS(
      { cds: 20, reasonCodes: [] },
      {
        isNewTabOrWindow: false,
        isCrossSite: false,
        navAnomalyScore: 15,
      },
    );
    expect(result.nrs).toBe(20);
    expect(result.nrsFactors).not.toContain("nrs_nav_anomaly");
  });

  it("nrs_nav_anomaly is NOT applied when NRS < 20 (below threshold)", async () => {
    const { computeNRS } = await import("../extension/src/shared/nrs");
    const result = computeNRS(
      { cds: 10, reasonCodes: [] },
      {
        isNewTabOrWindow: false,
        isCrossSite: false,
        navAnomalyScore: 15,
      },
    );
    expect(result.nrs).toBe(10);
    expect(result.nrsFactors).not.toContain("nrs_nav_anomaly");
  });

  it("nrs_nav_anomaly IS applied when NRS > 20 (above threshold)", async () => {
    const { computeNRS } = await import("../extension/src/shared/nrs");
    const result = computeNRS(
      { cds: 21, reasonCodes: [] },
      {
        isNewTabOrWindow: false,
        isCrossSite: false,
        navAnomalyScore: 15,
      },
    );
    expect(result.nrs).toBe(36); // 21 + 15
    expect(result.nrsFactors).toContain("nrs_nav_anomaly");
  });
});
