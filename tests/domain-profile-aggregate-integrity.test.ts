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
});
