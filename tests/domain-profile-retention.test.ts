import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOMAIN_PROFILES_KEY, MAX_PROFILES, recordNavigation, _resetSerializationForTests,
} from "../extension/src/shared/domain_profile";

const NOW = 1_790_000_000_000;
let profiles: Record<string, ReturnType<typeof profile>>;

function profile(domain: string, lastSeen: unknown) {
  return { domain, lastSeen, visits: 5, totalNRS: 100, maxNRS: 20,
    triggerCount: 0, nrsHistory: [20], factors: {} };
}

beforeEach(() => {
  _resetSerializationForTests();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  profiles = {};
  vi.stubGlobal("chrome", { storage: { local: {
    get: async () => ({ [DOMAIN_PROFILES_KEY]: structuredClone(profiles) }),
    set: async (value: Record<string, unknown>) => {
      profiles = structuredClone(value[DOMAIN_PROFILES_KEY]) as typeof profiles;
    },
  } } });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function fillValid(count: number) {
  for (let i = 0; i < count; i++) {
    const domain = `valid-${i}.example`;
    profiles[domain] = profile(domain, NOW - 10_000 + i);
  }
}

describe("corrupt profile timestamps cannot claim recency (#834)", () => {
  it.each([undefined, null, NaN, Infinity, -Infinity, "yesterday"])(
    "does not evict a valid profile to preserve timestamp %s", async (lastSeen) => {
      fillValid(MAX_PROFILES - 1);
      profiles["unknown.example"] = profile("unknown.example", lastSeen);
      await recordNavigation("new.example", 25, []);
      expect(Object.keys(profiles)).toHaveLength(MAX_PROFILES);
      expect(Object.hasOwn(profiles, "unknown.example")).toBe(false);
      expect(Object.hasOwn(profiles, "valid-0.example")).toBe(true);
      expect(Object.hasOwn(profiles, "new.example")).toBe(true);
    },
  );

  it("starts a fresh profile when an unknown-age domain is observed again", async () => {
    profiles["unknown.example"] = profile("unknown.example", NaN);
    await recordNavigation("unknown.example", 25, []);
    expect(profiles["unknown.example"]).toMatchObject({ visits: 1, totalNRS: 25, lastSeen: NOW });
  });

  it("preserves ordinary LRU ordering for valid timestamps", async () => {
    fillValid(MAX_PROFILES);
    await recordNavigation("new.example", 25, []);
    expect(Object.hasOwn(profiles, "valid-0.example")).toBe(false);
    expect(Object.hasOwn(profiles, "valid-1.example")).toBe(true);
    expect(Object.keys(profiles)).toHaveLength(MAX_PROFILES);
  });
});
