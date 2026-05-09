import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  recordNavigation,
  getDomainRisk,
  getTopSuspiciousDomains,
  clearDomainProfiles,
  DOMAIN_PROFILES_KEY,
  MAX_PROFILES,
  DECAY_AGE_MS,
  REPEAT_OFFENDER_TRIGGER_MIN,
  REPEAT_OFFENDER_AVG_NRS_MIN,
  type DomainProfile,
} from "../extension/src/shared/domain_profile";

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

(globalThis as any).chrome = {
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

function getStoredProfiles(): Record<string, DomainProfile> {
  return (store[DOMAIN_PROFILES_KEY] as Record<string, DomainProfile>) ?? {};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe("recordNavigation", () => {
  it("creates a new profile for an unknown domain", async () => {
    await recordNavigation("evil.com", 45, ["nrs_cross_site", "nrs_new_tab_window"]);
    const profiles = getStoredProfiles();
    expect(profiles["evil.com"]).toBeDefined();
    expect(profiles["evil.com"]!.visits).toBe(1);
    expect(profiles["evil.com"]!.totalNRS).toBe(45);
    expect(profiles["evil.com"]!.maxNRS).toBe(45);
    expect(profiles["evil.com"]!.factors["nrs_cross_site"]).toBe(1);
    expect(profiles["evil.com"]!.factors["nrs_new_tab_window"]).toBe(1);
  });

  it("updates an existing profile", async () => {
    await recordNavigation("evil.com", 40, ["nrs_cross_site"]);
    await recordNavigation("evil.com", 60, ["nrs_cross_site", "nrs_fast_attempt"]);
    const profiles = getStoredProfiles();
    const p = profiles["evil.com"]!;
    expect(p.visits).toBe(2);
    expect(p.totalNRS).toBe(100);
    expect(p.maxNRS).toBe(60);
    expect(p.factors["nrs_cross_site"]).toBe(2);
    expect(p.factors["nrs_fast_attempt"]).toBe(1);
  });

  it("increments triggerCount when NRS >= threshold", async () => {
    await recordNavigation("bad.com", 80, [], 70);
    await recordNavigation("bad.com", 50, [], 70);
    await recordNavigation("bad.com", 75, [], 70);
    const p = getStoredProfiles()["bad.com"]!;
    expect(p.triggerCount).toBe(2);
  });

  it("keeps nrsHistory bounded to 50 entries", async () => {
    for (let i = 0; i < 60; i++) {
      await recordNavigation("busy.com", i, []);
    }
    const p = getStoredProfiles()["busy.com"]!;
    expect(p.nrsHistory.length).toBe(50);
    // Should contain the last 50 values (10..59)
    expect(p.nrsHistory[0]).toBe(10);
    expect(p.nrsHistory[49]).toBe(59);
  });
});

describe("LRU eviction", () => {
  it("evicts oldest profiles when exceeding MAX_PROFILES", async () => {
    // Pre-populate with MAX_PROFILES entries
    const bulk: Record<string, DomainProfile> = {};
    for (let i = 0; i < MAX_PROFILES; i++) {
      bulk[`domain-${i}.com`] = {
        domain: `domain-${i}.com`,
        visits: 1,
        totalNRS: 10,
        maxNRS: 10,
        triggerCount: 0,
        lastSeen: 1000 + i, // older = smaller ts
        factors: {},
        nrsHistory: [10],
      };
    }
    store[DOMAIN_PROFILES_KEY] = bulk;

    // Add one more -- should evict domain-0.com (oldest lastSeen=1000)
    await recordNavigation("newcomer.com", 20, []);
    const profiles = getStoredProfiles();
    expect(Object.keys(profiles).length).toBe(MAX_PROFILES);
    expect(profiles["domain-0.com"]).toBeUndefined();
    expect(profiles["newcomer.com"]).toBeDefined();
  });
});

describe("decay logic", () => {
  it("halves visits and triggerCount for stale profiles", async () => {
    const staleTs = Date.now() - DECAY_AGE_MS - 1000;
    store[DOMAIN_PROFILES_KEY] = {
      "stale.com": {
        domain: "stale.com",
        visits: 10,
        totalNRS: 500,
        maxNRS: 80,
        triggerCount: 6,
        lastSeen: staleTs,
        factors: { nrs_cross_site: 5 },
        nrsHistory: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
      },
    };

    // Recording updates the profile AND applies decay first
    await recordNavigation("stale.com", 30, ["nrs_cross_site"]);
    const p = getStoredProfiles()["stale.com"]!;

    // After decay: visits floor(10*0.5)=5, then +1 = 6
    expect(p.visits).toBe(6);
    // After decay: triggerCount floor(6*0.5)=3, then NRS 30 < 70 so no increment = 3
    expect(p.triggerCount).toBe(3);
  });

  it("decay applies when reading risk assessment for stale profiles", async () => {
    const staleTs = Date.now() - DECAY_AGE_MS - 1000;
    store[DOMAIN_PROFILES_KEY] = {
      "old.com": {
        domain: "old.com",
        visits: 20,
        totalNRS: 800,
        maxNRS: 80,
        triggerCount: 8,
        lastSeen: staleTs,
        factors: {},
        nrsHistory: [40, 40, 40, 40, 40],
      },
    };

    const risk = await getDomainRisk("old.com");
    // After decay: visits floor(20*0.5)=10, triggerCount floor(8*0.5)=4
    // totalNRS floor(800*0.5)=400, avgNRS = 400/10 = 40
    // triggerCount 4 > 3 AND avgNRS 40 > 30
    expect(risk.isRepeatOffender).toBe(true);
    expect(risk.avgNRS).toBe(40);
  });
});

describe("getDomainRisk", () => {
  it("returns zeros for unknown domain", async () => {
    const risk = await getDomainRisk("unknown.com");
    expect(risk.avgNRS).toBe(0);
    expect(risk.consistency).toBe(0);
    expect(risk.isRepeatOffender).toBe(false);
    expect(risk.topFactors).toEqual([]);
  });

  it("computes avgNRS correctly", async () => {
    await recordNavigation("test.com", 40, []);
    await recordNavigation("test.com", 60, []);
    const risk = await getDomainRisk("test.com");
    expect(risk.avgNRS).toBe(50);
  });

  it("computes consistency (stddev) from nrsHistory", async () => {
    // Values: 10, 10, 10 => stddev = 0
    store[DOMAIN_PROFILES_KEY] = {
      "consistent.com": {
        domain: "consistent.com",
        visits: 3,
        totalNRS: 30,
        maxNRS: 10,
        triggerCount: 0,
        lastSeen: Date.now(),
        factors: {},
        nrsHistory: [10, 10, 10],
      },
    };
    const risk = await getDomainRisk("consistent.com");
    expect(risk.consistency).toBe(0);

    // Values: 0, 100 => stddev = 50
    store[DOMAIN_PROFILES_KEY] = {
      "varied.com": {
        domain: "varied.com",
        visits: 2,
        totalNRS: 100,
        maxNRS: 100,
        triggerCount: 1,
        lastSeen: Date.now(),
        factors: {},
        nrsHistory: [0, 100],
      },
    };
    const risk2 = await getDomainRisk("varied.com");
    expect(risk2.consistency).toBe(50);
  });

  it("marks repeat offender when triggerCount > 3 AND avgNRS > 30", async () => {
    store[DOMAIN_PROFILES_KEY] = {
      "offender.com": {
        domain: "offender.com",
        visits: 10,
        totalNRS: 500,
        maxNRS: 80,
        triggerCount: REPEAT_OFFENDER_TRIGGER_MIN + 1,
        lastSeen: Date.now(),
        factors: { nrs_cross_site: 6 },
        nrsHistory: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
      },
    };
    const risk = await getDomainRisk("offender.com");
    expect(risk.isRepeatOffender).toBe(true);
  });

  it("does not mark repeat offender when triggerCount <= 3", async () => {
    store[DOMAIN_PROFILES_KEY] = {
      "borderline.com": {
        domain: "borderline.com",
        visits: 10,
        totalNRS: 500,
        maxNRS: 80,
        triggerCount: REPEAT_OFFENDER_TRIGGER_MIN,
        lastSeen: Date.now(),
        factors: {},
        nrsHistory: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
      },
    };
    const risk = await getDomainRisk("borderline.com");
    expect(risk.isRepeatOffender).toBe(false);
  });

  it("does not mark repeat offender when avgNRS <= 30", async () => {
    store[DOMAIN_PROFILES_KEY] = {
      "lowavg.com": {
        domain: "lowavg.com",
        visits: 10,
        totalNRS: 250,
        maxNRS: 80,
        triggerCount: REPEAT_OFFENDER_TRIGGER_MIN + 1,
        lastSeen: Date.now(),
        factors: {},
        nrsHistory: [25, 25, 25, 25, 25, 25, 25, 25, 25, 25],
      },
    };
    const risk = await getDomainRisk("lowavg.com");
    // avgNRS = 250/10 = 25 <= 30
    expect(risk.isRepeatOffender).toBe(false);
  });

  it("returns top factors sorted by count", async () => {
    store[DOMAIN_PROFILES_KEY] = {
      "factors.com": {
        domain: "factors.com",
        visits: 5,
        totalNRS: 200,
        maxNRS: 60,
        triggerCount: 0,
        lastSeen: Date.now(),
        factors: {
          nrs_cross_site: 5,
          nrs_new_tab_window: 3,
          nrs_fast_attempt: 1,
        },
        nrsHistory: [40, 40, 40, 40, 40],
      },
    };
    const risk = await getDomainRisk("factors.com");
    expect(risk.topFactors[0]).toBe("nrs_cross_site");
    expect(risk.topFactors[1]).toBe("nrs_new_tab_window");
    expect(risk.topFactors[2]).toBe("nrs_fast_attempt");
  });
});

describe("getTopSuspiciousDomains", () => {
  it("returns profiles sorted by avgNRS descending", async () => {
    store[DOMAIN_PROFILES_KEY] = {
      "low.com": {
        domain: "low.com",
        visits: 5,
        totalNRS: 50,
        maxNRS: 20,
        triggerCount: 0,
        lastSeen: Date.now(),
        factors: {},
        nrsHistory: [10, 10, 10, 10, 10],
      },
      "high.com": {
        domain: "high.com",
        visits: 5,
        totalNRS: 400,
        maxNRS: 90,
        triggerCount: 4,
        lastSeen: Date.now(),
        factors: {},
        nrsHistory: [80, 80, 80, 80, 80],
      },
      "mid.com": {
        domain: "mid.com",
        visits: 5,
        totalNRS: 200,
        maxNRS: 50,
        triggerCount: 1,
        lastSeen: Date.now(),
        factors: {},
        nrsHistory: [40, 40, 40, 40, 40],
      },
    };
    const top = await getTopSuspiciousDomains(3);
    expect(top[0]!.domain).toBe("high.com");
    expect(top[1]!.domain).toBe("mid.com");
    expect(top[2]!.domain).toBe("low.com");
  });

  it("respects the limit parameter", async () => {
    store[DOMAIN_PROFILES_KEY] = {
      "a.com": { domain: "a.com", visits: 1, totalNRS: 10, maxNRS: 10, triggerCount: 0, lastSeen: Date.now(), factors: {}, nrsHistory: [10] },
      "b.com": { domain: "b.com", visits: 1, totalNRS: 20, maxNRS: 20, triggerCount: 0, lastSeen: Date.now(), factors: {}, nrsHistory: [20] },
      "c.com": { domain: "c.com", visits: 1, totalNRS: 30, maxNRS: 30, triggerCount: 0, lastSeen: Date.now(), factors: {}, nrsHistory: [30] },
    };
    const top = await getTopSuspiciousDomains(2);
    expect(top.length).toBe(2);
  });
});

describe("clearDomainProfiles", () => {
  it("removes all stored profiles", async () => {
    await recordNavigation("clean.com", 20, []);
    await clearDomainProfiles();
    const profiles = getStoredProfiles();
    expect(Object.keys(profiles).length).toBe(0);
  });
});

describe("storage format", () => {
  it("stores profiles as a plain object keyed by domain", async () => {
    await recordNavigation("format.com", 25, ["reason_a"]);
    const raw = store[DOMAIN_PROFILES_KEY];
    expect(typeof raw).toBe("object");
    expect(raw).not.toBeInstanceOf(Array);
    const p = (raw as Record<string, DomainProfile>)["format.com"];
    expect(p).toBeDefined();
    expect(p!.domain).toBe("format.com");
    expect(p!.nrsHistory).toEqual([25]);
  });
});

describe("NRS integration", () => {
  it("domain_repeat_offender adds +10 to NRS", async () => {
    // This tests the NRS factor in isolation
    const { computeNRS } = await import("../extension/src/shared/nrs");
    const result = computeNRS(
      { cds: 30, reasonCodes: [] },
      {
        isNewTabOrWindow: false,
        isCrossSite: false,
        domainRepeatOffender: true,
      },
    );
    expect(result.nrs).toBe(40);
    expect(result.nrsFactors).toContain("nrs_domain_repeat_offender");
  });

  it("domain_repeat_offender does not fire when false", async () => {
    const { computeNRS } = await import("../extension/src/shared/nrs");
    const result = computeNRS(
      { cds: 30, reasonCodes: [] },
      {
        isNewTabOrWindow: false,
        isCrossSite: false,
        domainRepeatOffender: false,
      },
    );
    expect(result.nrs).toBe(30);
    expect(result.nrsFactors).not.toContain("nrs_domain_repeat_offender");
  });
});
