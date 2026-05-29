import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  classifyDomain,
  applyDecay,
  normalizeProfile,
  pruneBurstRecords,
  computeAnomalyScore,
  DECAY_INTERVAL_MS,
  MAX_TOTAL_NAVIGATIONS,
  MAX_BURST_RECORDS,
  BURST_RECORD_TTL_MS,
  BASE_ANOMALY_SCORE,
  BURST_3_PLUS_BONUS,
  ANOMALY_SCORE_CAP,
  MIN_NAVIGATIONS_FOR_ANOMALY,
  RARE_CATEGORY_THRESHOLD,
  BURST_MIN_COUNT,
  type NavProfile,
  type NavCategory,
  type BurstRecord,
} from "../extension/src/shared/nav_anomaly";

const ALL_CATEGORIES: NavCategory[] = [
  "crypto", "banking", "social", "email", "shopping", "developer",
  "entertainment", "news", "government", "healthcare", "education",
  "cloud", "vpn_proxy", "unknown",
];

const arbCategory = fc.constantFrom(...ALL_CATEGORIES);
const arbNonUnknownCategory = fc.constantFrom(
  ...ALL_CATEGORIES.filter((c) => c !== "unknown")
);

function makeProfile(overrides: Partial<NavProfile> = {}): NavProfile {
  return {
    categoryCounts: {},
    totalNavigations: 0,
    lastUpdated: Date.now(),
    recentBurst: [],
    ...overrides,
  };
}

const arbDomainChars = fc
  .array(
    fc.constantFrom(
      "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l",
      "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x",
      "y", "z", "0", "1", "2", "3", ".", "-",
    ),
    { minLength: 3, maxLength: 30 },
  )
  .map((chars) => chars.join(""));

const arbLabel = fc
  .array(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
    { minLength: 1, maxLength: 15 },
  )
  .map((chars) => chars.join(""));

const arbValidDomain = fc
  .tuple(arbLabel, fc.constantFrom("com", "org", "net", "io", "co.uk", "gov", "edu"))
  .map(([label, tld]) => `${label}.${tld}`);

// ---------------------------------------------------------------------------
// classifyDomain
// ---------------------------------------------------------------------------

describe("classifyDomain properties", () => {
  it("is deterministic", () => {
    fc.assert(
      fc.property(arbDomainChars, (hostname) => {
        expect(classifyDomain(hostname)).toBe(classifyDomain(hostname));
      }),
    );
  });

  it("always returns a valid NavCategory", () => {
    fc.assert(
      fc.property(fc.string(), (hostname) => {
        const result = classifyDomain(hostname);
        expect(ALL_CATEGORIES).toContain(result);
      }),
    );
  });

  it("empty string returns 'unknown'", () => {
    expect(classifyDomain("")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    fc.assert(
      fc.property(arbDomainChars, (hostname) => {
        expect(classifyDomain(hostname.toUpperCase())).toBe(
          classifyDomain(hostname.toLowerCase()),
        );
      }),
    );
  });

  it("known domains always return a non-unknown category", () => {
    const knownDomains = [
      "binance.com", "chase.com", "facebook.com", "gmail.com",
      "amazon.com", "github.com", "youtube.com", "bbc.com",
      "irs.gov", "webmd.com", "wikipedia.org", "google.com",
      "nordvpn.com",
    ];
    for (const d of knownDomains) {
      expect(classifyDomain(d)).not.toBe("unknown");
    }
  });

  it("keyword patterns classify structurally valid domains", () => {
    const keywordDomains: Array<[string, NavCategory]> = [
      ["my-wallet-app.com", "crypto"],
      ["secure-banking.net", "banking"],
      ["social-network.io", "social"],
      ["webmail-service.org", "email"],
      ["online-shop.co.uk", "shopping"],
      ["github-mirror.dev", "developer"],
      ["video-stream.net", "entertainment"],
      ["daily-news.com", "news"],
      ["portal.gov", "government"],
      ["health-clinic.org", "healthcare"],
      ["my-school.edu", "education"],
      ["cloud-storage.io", "cloud"],
      ["fast-vpn.com", "vpn_proxy"],
    ];
    for (const [domain, expected] of keywordDomains) {
      expect(classifyDomain(domain)).toBe(expected);
    }
  });

  it("structurally valid domains always produce consistent classification", () => {
    fc.assert(
      fc.property(arbValidDomain, (domain) => {
        const r1 = classifyDomain(domain);
        const r2 = classifyDomain(domain.toUpperCase());
        expect(r1).toBe(r2);
        if (domain.endsWith(".gov") || domain.endsWith(".edu")) {
          expect(r1).not.toBe("unknown");
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// computeAnomalyScore
// ---------------------------------------------------------------------------

describe("computeAnomalyScore properties", () => {
  it("output is always bounded [0, ANOMALY_SCORE_CAP]", () => {
    fc.assert(
      fc.property(
        arbCategory,
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 20 }),
        (category, totalNav, catCount, recentCount) => {
          const profile = makeProfile({
            categoryCounts: { [category]: catCount },
            totalNavigations: totalNav,
          });
          const score = computeAnomalyScore(profile, category, recentCount);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(ANOMALY_SCORE_CAP);
        },
      ),
    );
  });

  it("returns 0 for unknown category", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_NAVIGATIONS_FOR_ANOMALY, max: 1000 }),
        fc.integer({ min: BURST_MIN_COUNT, max: 10 }),
        (totalNav, recentCount) => {
          const profile = makeProfile({ totalNavigations: totalNav });
          expect(computeAnomalyScore(profile, "unknown", recentCount)).toBe(0);
        },
      ),
    );
  });

  it("returns 0 when totalNavigations < MIN_NAVIGATIONS_FOR_ANOMALY", () => {
    fc.assert(
      fc.property(
        arbNonUnknownCategory,
        fc.integer({ min: 0, max: MIN_NAVIGATIONS_FOR_ANOMALY - 1 }),
        fc.integer({ min: BURST_MIN_COUNT, max: 10 }),
        (category, totalNav, recentCount) => {
          const profile = makeProfile({ totalNavigations: totalNav });
          expect(computeAnomalyScore(profile, category, recentCount)).toBe(0);
        },
      ),
    );
  });

  it("returns 0 when recentCategoryCount < BURST_MIN_COUNT", () => {
    fc.assert(
      fc.property(
        arbNonUnknownCategory,
        fc.integer({ min: MIN_NAVIGATIONS_FOR_ANOMALY, max: 1000 }),
        fc.integer({ min: 0, max: BURST_MIN_COUNT - 1 }),
        (category, totalNav, recentCount) => {
          const profile = makeProfile({ totalNavigations: totalNav });
          expect(computeAnomalyScore(profile, category, recentCount)).toBe(0);
        },
      ),
    );
  });

  it("score is BASE when burst count is exactly BURST_MIN_COUNT (and category is rare)", () => {
    fc.assert(
      fc.property(
        arbNonUnknownCategory,
        fc.integer({ min: MIN_NAVIGATIONS_FOR_ANOMALY, max: 10000 }),
        (category, totalNav) => {
          const profile = makeProfile({
            categoryCounts: {},
            totalNavigations: totalNav,
          });
          const score = computeAnomalyScore(profile, category, BURST_MIN_COUNT);
          expect(score).toBe(BASE_ANOMALY_SCORE);
        },
      ),
    );
  });

  it("score includes bonus when recentCategoryCount >= 3", () => {
    fc.assert(
      fc.property(
        arbNonUnknownCategory,
        fc.integer({ min: 3, max: 20 }),
        (category, recentCount) => {
          const profile = makeProfile({
            categoryCounts: {},
            totalNavigations: MIN_NAVIGATIONS_FOR_ANOMALY + 100,
          });
          const score = computeAnomalyScore(profile, category, recentCount);
          expect(score).toBe(
            Math.min(BASE_ANOMALY_SCORE + BURST_3_PLUS_BONUS, ANOMALY_SCORE_CAP),
          );
        },
      ),
    );
  });

  it("score is monotonically non-decreasing with recentCategoryCount", () => {
    fc.assert(
      fc.property(
        arbNonUnknownCategory,
        fc.integer({ min: MIN_NAVIGATIONS_FOR_ANOMALY, max: 1000 }),
        fc.integer({ min: 0, max: 9 }),
        (category, totalNav, recentLow) => {
          const profile = makeProfile({
            categoryCounts: {},
            totalNavigations: totalNav,
          });
          const scoreLow = computeAnomalyScore(profile, category, recentLow);
          const scoreHigh = computeAnomalyScore(profile, category, recentLow + 1);
          expect(scoreHigh).toBeGreaterThanOrEqual(scoreLow);
        },
      ),
    );
  });

  it("returns 0 when pre-burst category frequency >= RARE_CATEGORY_THRESHOLD", () => {
    fc.assert(
      fc.property(
        arbNonUnknownCategory,
        fc.integer({ min: MIN_NAVIGATIONS_FOR_ANOMALY, max: 500 }),
        fc.integer({ min: BURST_MIN_COUNT, max: 5 }),
        (category, totalNav, recentCount) => {
          const burstInflation = Math.max(0, recentCount - 1);
          const preBurstTotal = Math.max(1, totalNav - burstInflation);
          const neededPreBurstCount = Math.ceil(preBurstTotal * RARE_CATEGORY_THRESHOLD);
          const catCount = neededPreBurstCount + burstInflation;
          const profile = makeProfile({
            categoryCounts: { [category]: catCount },
            totalNavigations: totalNav,
          });
          expect(computeAnomalyScore(profile, category, recentCount)).toBe(0);
        },
      ),
    );
  });

  it("output is always an integer", () => {
    fc.assert(
      fc.property(
        arbCategory,
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 10 }),
        (category, totalNav, catCount, recentCount) => {
          const profile = makeProfile({
            categoryCounts: { [category]: catCount },
            totalNavigations: totalNav,
          });
          const score = computeAnomalyScore(profile, category, recentCount);
          expect(Number.isInteger(score)).toBe(true);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// applyDecay
// ---------------------------------------------------------------------------

describe("applyDecay properties", () => {
  it("returns false when elapsed time < DECAY_INTERVAL_MS", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: DECAY_INTERVAL_MS - 1 }),
        arbNonUnknownCategory,
        fc.integer({ min: 1, max: 1000 }),
        (base, delta, category, count) => {
          const profile = makeProfile({
            categoryCounts: { [category]: count },
            totalNavigations: count,
            lastUpdated: base,
          });
          expect(applyDecay(profile, base + delta)).toBe(false);
          expect(profile.categoryCounts[category]).toBe(count);
        },
      ),
    );
  });

  it("returns true when elapsed time >= DECAY_INTERVAL_MS", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 52 }),
        arbNonUnknownCategory,
        fc.integer({ min: 10, max: 10000 }),
        (base, weeks, category, count) => {
          const profile = makeProfile({
            categoryCounts: { [category]: count },
            totalNavigations: count,
            lastUpdated: base,
          });
          const result = applyDecay(profile, base + weeks * DECAY_INTERVAL_MS);
          expect(result).toBe(true);
        },
      ),
    );
  });

  it("category counts monotonically decrease after decay", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 10 }),
        arbNonUnknownCategory,
        fc.integer({ min: 1, max: 10000 }),
        (base, weeks, category, count) => {
          const profile = makeProfile({
            categoryCounts: { [category]: count },
            totalNavigations: count,
            lastUpdated: base,
          });
          applyDecay(profile, base + weeks * DECAY_INTERVAL_MS);
          const afterCount = profile.categoryCounts[category] ?? 0;
          expect(afterCount).toBeLessThanOrEqual(count);
        },
      ),
    );
  });

  it("totalNavigations equals sum of categoryCounts after decay", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 10 }),
        fc.record({
          crypto: fc.integer({ min: 0, max: 500 }),
          banking: fc.integer({ min: 0, max: 500 }),
          social: fc.integer({ min: 0, max: 500 }),
          email: fc.integer({ min: 0, max: 500 }),
        }),
        (base, weeks, counts) => {
          const categoryCounts: Record<string, number> = {};
          let total = 0;
          for (const [k, v] of Object.entries(counts)) {
            if (v > 0) {
              categoryCounts[k] = v;
              total += v;
            }
          }
          if (total === 0) return;
          const profile = makeProfile({
            categoryCounts,
            totalNavigations: total,
            lastUpdated: base,
          });
          applyDecay(profile, base + weeks * DECAY_INTERVAL_MS);
          const sum = Object.values(profile.categoryCounts).reduce((s, c) => s + c, 0);
          expect(profile.totalNavigations).toBe(sum);
        },
      ),
    );
  });

  it("zero counts are removed from categoryCounts after decay", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        arbNonUnknownCategory,
        (base, category) => {
          const profile = makeProfile({
            categoryCounts: { [category]: 1 },
            totalNavigations: 1,
            lastUpdated: base,
          });
          applyDecay(profile, base + DECAY_INTERVAL_MS);
          for (const v of Object.values(profile.categoryCounts)) {
            expect(v).toBeGreaterThan(0);
          }
        },
      ),
    );
  });

  it("caps iterations and sets lastUpdated = now when exceeding MAX_DECAY_ITERATIONS", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        arbNonUnknownCategory,
        fc.integer({ min: 100, max: 10000 }),
        (base, category, count) => {
          const profile = makeProfile({
            categoryCounts: { [category]: count },
            totalNavigations: count,
            lastUpdated: base,
          });
          const now = base + 100 * DECAY_INTERVAL_MS;
          applyDecay(profile, now);
          expect(profile.lastUpdated).toBe(now);
        },
      ),
    );
  });

  it("is idempotent on second call with same timestamp", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 10 }),
        arbNonUnknownCategory,
        fc.integer({ min: 10, max: 10000 }),
        (base, weeks, category, count) => {
          const profile = makeProfile({
            categoryCounts: { [category]: count },
            totalNavigations: count,
            lastUpdated: base,
          });
          const now = base + weeks * DECAY_INTERVAL_MS;
          applyDecay(profile, now);
          const snapshot = structuredClone(profile);
          expect(applyDecay(profile, now)).toBe(false);
          expect(profile).toEqual(snapshot);
        },
      ),
    );
  });

  it("returns false for non-finite inputs", () => {
    const profile = makeProfile({ lastUpdated: NaN });
    expect(applyDecay(profile, 1000)).toBe(false);
    const profile2 = makeProfile({ lastUpdated: 0 });
    expect(applyDecay(profile2, Infinity)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeProfile
// ---------------------------------------------------------------------------

describe("normalizeProfile properties", () => {
  it("does nothing when totalNavigations <= MAX_TOTAL_NAVIGATIONS", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_TOTAL_NAVIGATIONS }),
        arbNonUnknownCategory,
        (total, category) => {
          if (total === 0) return;
          const profile = makeProfile({
            categoryCounts: { [category]: total },
            totalNavigations: total,
          });
          const origCount = total;
          normalizeProfile(profile);
          expect(profile.categoryCounts[category]).toBe(origCount);
        },
      ),
    );
  });

  it("after normalization, totalNavigations <= MAX_TOTAL_NAVIGATIONS", () => {
    fc.assert(
      fc.property(
        fc.record({
          crypto: fc.integer({ min: 3400, max: 20000 }),
          banking: fc.integer({ min: 3400, max: 20000 }),
          social: fc.integer({ min: 3400, max: 20000 }),
        }),
        (counts) => {
          const categoryCounts: Record<string, number> = { ...counts };
          const total = Object.values(categoryCounts).reduce((s, c) => s + c, 0);
          if (total <= MAX_TOTAL_NAVIGATIONS) return;
          const profile = makeProfile({ categoryCounts, totalNavigations: total });
          normalizeProfile(profile);
          expect(profile.totalNavigations).toBeLessThanOrEqual(MAX_TOTAL_NAVIGATIONS);
        },
      ),
    );
  });

  it("all category counts are >= 1 after normalization (floor preserves minimum)", () => {
    fc.assert(
      fc.property(
        fc.record({
          crypto: fc.integer({ min: 1, max: 20000 }),
          banking: fc.integer({ min: 1, max: 20000 }),
          social: fc.integer({ min: 1, max: 20000 }),
        }),
        (counts) => {
          const categoryCounts: Record<string, number> = { ...counts };
          const total = Object.values(categoryCounts).reduce((s, c) => s + c, 0);
          const profile = makeProfile({ categoryCounts, totalNavigations: total });
          normalizeProfile(profile);
          for (const v of Object.values(profile.categoryCounts)) {
            expect(v).toBeGreaterThanOrEqual(1);
          }
        },
      ),
    );
  });

  it("totalNavigations equals sum of categoryCounts after normalization", () => {
    fc.assert(
      fc.property(
        fc.record({
          crypto: fc.integer({ min: 1, max: 20000 }),
          banking: fc.integer({ min: 1, max: 20000 }),
          email: fc.integer({ min: 1, max: 20000 }),
        }),
        (counts) => {
          const categoryCounts: Record<string, number> = { ...counts };
          const total = Object.values(categoryCounts).reduce((s, c) => s + c, 0);
          const profile = makeProfile({ categoryCounts, totalNavigations: total });
          normalizeProfile(profile);
          const sum = Object.values(profile.categoryCounts).reduce((s, c) => s + c, 0);
          expect(profile.totalNavigations).toBe(sum);
        },
      ),
    );
  });

  it("preserves relative order of category counts", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5000, max: 20000 }),
        fc.integer({ min: 1000, max: 4999 }),
        fc.integer({ min: 1, max: 999 }),
        (high, mid, low) => {
          const categoryCounts: Record<string, number> = {
            crypto: high,
            banking: mid,
            social: low,
          };
          const total = high + mid + low;
          if (total <= MAX_TOTAL_NAVIGATIONS) return;
          const profile = makeProfile({ categoryCounts, totalNavigations: total });
          normalizeProfile(profile);
          expect(profile.categoryCounts["crypto"]!).toBeGreaterThanOrEqual(
            profile.categoryCounts["banking"]!,
          );
          expect(profile.categoryCounts["banking"]!).toBeGreaterThanOrEqual(
            profile.categoryCounts["social"]!,
          );
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// pruneBurstRecords
// ---------------------------------------------------------------------------

describe("pruneBurstRecords properties", () => {
  const arbBurstRecord = fc.record({
    category: arbCategory,
    ts: fc.integer({ min: 0, max: 2_000_000_000 }),
    count: fc.integer({ min: 1, max: 10 }),
  }) as fc.Arbitrary<BurstRecord>;

  it("removes records older than BURST_RECORD_TTL_MS", () => {
    fc.assert(
      fc.property(
        fc.array(arbBurstRecord, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: BURST_RECORD_TTL_MS, max: 2_000_000_000 }),
        (bursts, now) => {
          const profile = makeProfile({ recentBurst: structuredClone(bursts) });
          pruneBurstRecords(profile, now);
          const cutoff = now - BURST_RECORD_TTL_MS;
          for (const b of profile.recentBurst) {
            expect(b.ts).toBeGreaterThanOrEqual(cutoff);
          }
        },
      ),
    );
  });

  it("output length <= MAX_BURST_RECORDS", () => {
    fc.assert(
      fc.property(
        fc.array(arbBurstRecord, { minLength: 0, maxLength: 40 }),
        fc.integer({ min: 0, max: 2_000_000_000 }),
        (bursts, now) => {
          const profile = makeProfile({ recentBurst: structuredClone(bursts) });
          pruneBurstRecords(profile, now);
          expect(profile.recentBurst.length).toBeLessThanOrEqual(MAX_BURST_RECORDS);
        },
      ),
    );
  });

  it("output is a suffix of the filtered input", () => {
    fc.assert(
      fc.property(
        fc.array(arbBurstRecord, { minLength: MAX_BURST_RECORDS + 1, maxLength: 40 }),
        (bursts) => {
          const now = Math.max(...bursts.map((b) => b.ts)) + 1;
          const cutoff = now - BURST_RECORD_TTL_MS;
          const filtered = bursts.filter((b) => b.ts >= cutoff);
          const expectedSlice = filtered.slice(-MAX_BURST_RECORDS);
          const profile = makeProfile({ recentBurst: structuredClone(bursts) });
          pruneBurstRecords(profile, now);
          expect(profile.recentBurst).toEqual(expectedSlice);
        },
      ),
    );
  });

  it("empty burst array stays empty", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), (now) => {
        const profile = makeProfile({ recentBurst: [] });
        pruneBurstRecords(profile, now);
        expect(profile.recentBurst).toHaveLength(0);
      }),
    );
  });
});
