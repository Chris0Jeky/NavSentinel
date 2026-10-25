import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOMAIN_PROFILES_KEY, getDomainRisk, recordNavigation, _resetSerializationForTests,
} from "../extension/src/shared/domain_profile";

let profiles: Record<string, unknown>;
const fields = ["visits", "totalNRS", "maxNRS", "triggerCount"] as const;
const invalid = [undefined, "5", NaN, Infinity] as const;

function profile() {
  return { domain: "sample.example", visits: 5, totalNRS: 100, maxNRS: 30,
    triggerCount: 4, lastSeen: Date.now(), factors: { old_factor: 4 }, nrsHistory: [10, 30] };
}

beforeEach(() => {
  _resetSerializationForTests();
  profiles = {};
  vi.stubGlobal("chrome", { storage: { local: {
    get: async () => ({ [DOMAIN_PROFILES_KEY]: structuredClone(profiles) }),
    set: async (value: Record<string, unknown>) => {
      profiles = structuredClone(value[DOMAIN_PROFILES_KEY]) as typeof profiles;
    },
  } } });
});
afterEach(() => vi.unstubAllGlobals());

describe("profile counters remain one coherent aggregate (#834)", () => {
  for (const field of fields) {
    it.each(invalid)("discards the aggregate when " + field + " is %s", async (value) => {
      const sibling = { ...profile(), domain: "sibling.example" };
      profiles = { "sample.example": { ...profile(), [field]: value }, "sibling.example": sibling };
      // Reading cannot turn a surviving total into risk from a partial history.
      expect(await getDomainRisk("sample.example")).toEqual({
        avgNRS: 0, consistency: 0, isRepeatOffender: false, topFactors: [],
      });
      const risk = await recordNavigation("sample.example", 30, ["new_factor"]);
      expect(risk).toEqual({ avgNRS: 30, consistency: 0, isRepeatOffender: false, topFactors: ["new_factor"] });
      expect(profiles["sample.example"]).toMatchObject({
        visits: 1, totalNRS: 30, maxNRS: 30, triggerCount: 0,
        nrsHistory: [30], factors: { new_factor: 1 },
      });
      expect(profiles["sibling.example"]).toEqual(sibling);
    });
  }

  it("preserves valid coupled totals and history", async () => {
    profiles = { "sample.example": profile() };
    const risk = await recordNavigation("sample.example", 30, ["new_factor"]);
    expect(risk.avgNRS).toBe(130 / 6);
    expect(risk.isRepeatOffender).toBe(false);
    expect(profiles["sample.example"]).toMatchObject({
      visits: 6, totalNRS: 130, maxNRS: 30, triggerCount: 4,
      nrsHistory: [10, 30, 30], factors: { old_factor: 4, new_factor: 1 },
    });
  });

  it.each([NaN, Infinity, -Infinity])("ignores non-finite navigation NRS %s", async (nrs) => {
    profiles = { "sample.example": profile() };
    const before = structuredClone(profiles);
    const set = vi.spyOn(chrome.storage.local, "set");
    const expected = await getDomainRisk("sample.example");
    const risk = await recordNavigation("sample.example", nrs, ["bad_factor"]);
    expect(Number.isFinite(risk.avgNRS)).toBe(true);
    expect(Number.isFinite(risk.consistency)).toBe(true);
    expect(risk).toEqual(expected);
    expect(profiles).toEqual(before);
    expect(set).not.toHaveBeenCalled();

    const next = await recordNavigation("sample.example", 30, ["new_factor"]);
    expect(next.avgNRS).toBe(130 / 6);
    expect(Number.isFinite(next.consistency)).toBe(true);
    expect(profiles["sample.example"]).toMatchObject({
      visits: 6, totalNRS: 130, maxNRS: 30, triggerCount: 4,
      nrsHistory: [10, 30, 30], factors: { old_factor: 4, new_factor: 1 },
    });
  });

  it.each([NaN, Infinity, -Infinity])("does not create a profile for NRS %s", async (nrs) => {
    const set = vi.spyOn(chrome.storage.local, "set");
    expect(await recordNavigation("sample.example", nrs, ["bad_factor"])).toEqual({
      avgNRS: 0, consistency: 0, isRepeatOffender: false, topFactors: [],
    });
    expect(profiles).toEqual({});
    expect(set).not.toHaveBeenCalled();
  });

  it("keeps invalid navigations ordered between valid records", async () => {
    const first = recordNavigation("sample.example", 20, []);
    const ignored = recordNavigation("sample.example", NaN, []);
    const last = recordNavigation("sample.example", 40, []);
    const [firstRisk, ignoredRisk, lastRisk] = await Promise.all([first, ignored, last]);
    expect(ignoredRisk).toEqual(firstRisk);
    expect(lastRisk.avgNRS).toBe(30);
    expect(profiles["sample.example"]).toMatchObject({
      visits: 2, totalNRS: 60, maxNRS: 40, nrsHistory: [20, 40],
    });
  });
});
