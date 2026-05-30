import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  recordNavigation,
  getDomainRisk,
  getTopSuspiciousDomains,
  clearDomainProfiles,
  _resetSerializationForTests,
  DOMAIN_PROFILES_KEY,
  MAX_PROFILES,
  DECAY_AGE_MS,
  REPEAT_OFFENDER_TRIGGER_MIN,
  type DomainProfile,
  type DomainRiskAssessment,
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

function getStoredProfiles(): Record<string, DomainProfile> {
  return (store[DOMAIN_PROFILES_KEY] as Record<string, DomainProfile>) ?? {};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  // Reset the module-level serialization chain so fire-and-forget operations
  // queued by one test cannot leak into the next (R1 test-isolation finding).
  _resetSerializationForTests();
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

  it("halves factor counts and prunes zeroes on decay", async () => {
    const staleTs = Date.now() - DECAY_AGE_MS - 1000;
    store[DOMAIN_PROFILES_KEY] = {
      "factors-decay.com": {
        domain: "factors-decay.com",
        visits: 10,
        totalNRS: 500,
        maxNRS: 80,
        triggerCount: 6,
        lastSeen: staleTs,
        factors: { nrs_cross_site: 8, nrs_new_tab_window: 1 },
        nrsHistory: [50, 50, 50, 50, 50],
      },
    };

    await recordNavigation("factors-decay.com", 30, ["nrs_cross_site"]);
    const p = getStoredProfiles()["factors-decay.com"]!;
    // nrs_cross_site: floor(8*0.5)=4, then +1 from new recording = 5
    expect(p.factors["nrs_cross_site"]).toBe(5);
    // nrs_new_tab_window: floor(1*0.5)=0, pruned
    expect(p.factors["nrs_new_tab_window"]).toBeUndefined();
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

describe("recordNavigation return value", () => {
  it("returns a DomainRiskAssessment after recording", async () => {
    const risk: DomainRiskAssessment = await recordNavigation("ret.com", 50, ["nrs_cross_site"]);
    expect(risk.avgNRS).toBe(50);
    expect(risk.isRepeatOffender).toBe(false);
    expect(risk.topFactors).toContain("nrs_cross_site");
  });

  it("returns updated assessment after multiple recordings", async () => {
    await recordNavigation("multi.com", 80, [], 70);
    await recordNavigation("multi.com", 80, [], 70);
    await recordNavigation("multi.com", 80, [], 70);
    const risk = await recordNavigation("multi.com", 80, [], 70);
    expect(risk.avgNRS).toBe(80);
    expect(risk.isRepeatOffender).toBe(true);
  });
});

describe("async mutex (serialization)", () => {
  it("concurrent writes are serialized and all data is preserved", async () => {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(recordNavigation("race.com", 40, [`reason_${i}`]));
    }
    await Promise.all(promises);
    const p = getStoredProfiles()["race.com"]!;
    expect(p.visits).toBe(5);
    expect(p.totalNRS).toBe(200);
    for (let i = 0; i < 5; i++) {
      expect(p.factors[`reason_${i}`]).toBe(1);
    }
  });
});

describe("prototype pollution resistance", () => {
  it("Object.prototype keys used as reason codes are stored as own properties", async () => {
    const protoKeys = ["toString", "valueOf", "constructor", "hasOwnProperty", "isPrototypeOf"];
    await recordNavigation("proto.com", 50, protoKeys);
    const p = getStoredProfiles()["proto.com"]!;
    for (const key of protoKeys) {
      expect(Object.hasOwn(p.factors, key)).toBe(true);
      expect(p.factors[key]).toBe(1);
    }
    expect(p.visits).toBe(1);
  });

  it("__proto__ as reason code does not corrupt the factors object", async () => {
    await recordNavigation("proto-dunder.com", 50, ["__proto__", "nrs_cross_site"]);
    const p = getStoredProfiles()["proto-dunder.com"]!;
    expect(p.factors["nrs_cross_site"]).toBe(1);
    expect(Object.getPrototypeOf(p.factors)).toBe(Object.prototype);
    // V8's __proto__ setter swallows non-object assignments — no own property created
    expect(Object.hasOwn(p.factors, "__proto__")).toBe(false);
  });

  it("prototype key factors accumulate correctly across multiple recordings", async () => {
    await recordNavigation("proto2.com", 30, ["toString"]);
    await recordNavigation("proto2.com", 40, ["toString"]);
    const p = getStoredProfiles()["proto2.com"]!;
    expect(Object.hasOwn(p.factors, "toString")).toBe(true);
    expect(p.factors["toString"]).toBe(2);
  });

  it("factors object has no inherited prototype keys as own properties by default", async () => {
    await recordNavigation("clean-factors.com", 20, ["nrs_cross_site"]);
    const p = getStoredProfiles()["clean-factors.com"]!;
    const ownKeys = Object.keys(p.factors);
    expect(ownKeys).toEqual(["nrs_cross_site"]);
  });
});

describe("loadProfiles forward-compat", () => {
  it("missing factors field is initialized to empty object", async () => {
    store[DOMAIN_PROFILES_KEY] = {
      "old-schema.com": {
        domain: "old-schema.com",
        visits: 5,
        totalNRS: 100,
        maxNRS: 30,
        triggerCount: 0,
        lastSeen: Date.now(),
        nrsHistory: [20, 20, 20, 20, 20],
      },
    };
    await recordNavigation("old-schema.com", 25, ["nrs_cross_site"]);
    const p = getStoredProfiles()["old-schema.com"]!;
    expect(p.factors["nrs_cross_site"]).toBe(1);
    expect(p.visits).toBe(6);
  });

  it("null factors field is replaced with empty object", async () => {
    store[DOMAIN_PROFILES_KEY] = {
      "null-factors.com": {
        domain: "null-factors.com",
        visits: 1,
        totalNRS: 10,
        maxNRS: 10,
        triggerCount: 0,
        lastSeen: Date.now(),
        factors: null,
        nrsHistory: [10],
      },
    };
    const risk = await getDomainRisk("null-factors.com");
    expect(risk.topFactors).toEqual([]);
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

describe("read-modify-write serialization (regression: discovery D-PROF wf_c7d868c7-3b1)", () => {
  it("getDomainRisk observes writes queued just before it (reads chain through pending)", async () => {
    // Fire navigations WITHOUT awaiting, then read immediately. getDomainRisk
    // now shares recordNavigation's pending chain, so the read runs only after
    // the writes complete. Before the fix the reader raced loadProfiles and
    // returned zeros.
    for (let i = 0; i < 4; i++) void recordNavigation("serial.test", 50, ["nrs_cross_site"]);
    const risk = await getDomainRisk("serial.test");
    expect(risk.avgNRS).toBe(50);
    expect(risk.topFactors).toContain("nrs_cross_site");
  });

  it("getTopSuspiciousDomains observes writes queued just before it", async () => {
    for (let i = 0; i < 3; i++) void recordNavigation("serial2.test", 60, []);
    const top = await getTopSuspiciousDomains(10);
    const entry = top.find((p) => p.domain === "serial2.test");
    expect(entry).toBeDefined();
    expect(entry!.visits).toBe(3);
  });

  it("serializes a reader and a writer (no interleaving) — deterministic via storage-call ordering", async () => {
    // R1 finding: the previous "last writer wins" assertion could pass with the
    // OLD code by timing luck. Instead assert the *invariant* the fix provides:
    // a reader and a concurrently-issued writer never interleave their
    // load/save pairs. We instrument the storage mock to record an ordered log
    // of get/set calls; serialized operations must appear as complete,
    // non-overlapping [get...set] segments.
    const callLog: string[] = [];
    const origGet = chrome.storage.local.get as ReturnType<typeof vi.fn>;
    const origSet = chrome.storage.local.set as ReturnType<typeof vi.fn>;
    origGet.mockImplementation((keys: string | string[]) => {
      callLog.push("get");
      return mockGet(keys);
    });
    origSet.mockImplementation((items: Record<string, unknown>) => {
      callLog.push("set");
      return mockSet(items);
    });

    // Seed a stale profile so the reader actually performs a save (decay path).
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

    const reader = getTopSuspiciousDomains(10);
    const writer = recordNavigation("fresh.com", 40, ["nrs_new_tab_window"]);
    await Promise.all([reader, writer]);

    // Both operations ran; both writes survive (the real-world payoff).
    const profiles = getStoredProfiles();
    expect(profiles["fresh.com"]!.visits).toBe(1);
    expect(profiles["stale.com"]!.visits).toBeLessThan(10);

    // Invariant: no overlap. Walking the call log, every "get" must be followed
    // by its own operation's "set" before the next "get" appears — i.e. the
    // sequence is a series of [get, set] pairs, never [get, get, ...].
    let openGets = 0;
    for (const c of callLog) {
      if (c === "get") {
        openGets += 1;
        expect(openGets).toBe(1); // never two concurrent reads-in-flight
      } else {
        openGets -= 1;
      }
    }
  });

  it("getDomainRisk and a same-domain writer queued before it do not lose the write", async () => {
    // R1 gap: explicit same-domain reader-after-writer coverage.
    void recordNavigation("same.test", 80, ["nrs_cross_site"], 70);
    void recordNavigation("same.test", 80, ["nrs_cross_site"], 70);
    const risk = await getDomainRisk("same.test");
    expect(risk.avgNRS).toBe(80);
    const stored = getStoredProfiles()["same.test"]!;
    expect(stored.visits).toBe(2);
    expect(stored.factors["nrs_cross_site"]).toBe(2);
  });

  it("clearDomainProfiles is serialized: a navigation queued before it is cleared, not resurrected", async () => {
    // clearDomainProfiles now runs through the pending chain, so a navigation
    // queued before it completes first, then the clear wins deterministically.
    void recordNavigation("doomed.test", 50, []);
    await clearDomainProfiles();
    expect(Object.keys(getStoredProfiles()).length).toBe(0);
  });
});
