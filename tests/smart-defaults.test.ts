import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptOutcomeEntry } from "../extension/src/shared/storage";

// Import pure functions directly (no chrome dependency)
import {
  analyzeOutcomesForPair,
  pairKey,
  isPairOnCooldownPure,
  SMART_DEFAULT_THRESHOLD,
  SMART_DEFAULT_COOLDOWN_MS,
  SMART_DEFAULT_COOLDOWNS_KEY,
} from "../extension/src/shared/smart_defaults";

function makeOutcome(
  overrides: Partial<PromptOutcomeEntry> & { domain: string; destDomain?: string }
): PromptOutcomeEntry {
  return {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    type: "nav",
    score: 30,
    outcome: "allow_once",
    ...overrides,
  };
}

describe("smart defaults – pattern detection", () => {
  it("returns null when there are fewer outcomes than the threshold", () => {
    const outcomes = [
      makeOutcome({ domain: "a.com", destDomain: "b.com", ts: 1 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", ts: 2 }),
    ];
    expect(analyzeOutcomesForPair(outcomes, "a.com", "b.com")).toBeNull();
  });

  it("returns a suggestion when 3 consecutive allows exist", () => {
    const outcomes = [
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 1 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 2 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 3 }),
    ];
    const result = analyzeOutcomesForPair(outcomes, "a.com", "b.com");
    expect(result).not.toBeNull();
    expect(result!.suggestion).toBe("add_to_allowlist");
    expect(result!.allowCount).toBe(3);
    expect(result!.sourceDomain).toBe("a.com");
    expect(result!.destDomain).toBe("b.com");
  });

  it("counts 'allow' outcome as well as 'allow_once'", () => {
    const outcomes = [
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow", ts: 1 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 2 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow", ts: 3 }),
    ];
    const result = analyzeOutcomesForPair(outcomes, "a.com", "b.com");
    expect(result).not.toBeNull();
    expect(result!.allowCount).toBe(3);
  });

  it("returns suggestion for more than threshold consecutive allows", () => {
    const outcomes = Array.from({ length: 5 }, (_, i) =>
      makeOutcome({ domain: "x.com", destDomain: "y.com", outcome: "allow_once", ts: i + 1 })
    );
    const result = analyzeOutcomesForPair(outcomes, "x.com", "y.com");
    expect(result).not.toBeNull();
    expect(result!.allowCount).toBe(5);
  });

  it("a block in the middle resets the consecutive count", () => {
    const outcomes = [
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 1 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 2 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "block", ts: 3 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 4 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 5 }),
    ];
    // Most recent two are allows, then a block -- only 2 consecutive
    expect(analyzeOutcomesForPair(outcomes, "a.com", "b.com")).toBeNull();
  });

  it("a dismiss in the middle resets the consecutive count", () => {
    const outcomes = [
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 1 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "dismiss", ts: 2 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 3 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 4 }),
    ];
    // Most recent two are allows, then a dismiss -- only 2 consecutive
    expect(analyzeOutcomesForPair(outcomes, "a.com", "b.com")).toBeNull();
  });

  it("only counts nav-type outcomes, not cred", () => {
    const outcomes = [
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", type: "cred", ts: 1 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", type: "cred", ts: 2 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", type: "cred", ts: 3 }),
    ];
    expect(analyzeOutcomesForPair(outcomes, "a.com", "b.com")).toBeNull();
  });

  it("ignores outcomes for different domain pairs", () => {
    const outcomes = [
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 1 }),
      makeOutcome({ domain: "a.com", destDomain: "c.com", outcome: "allow_once", ts: 2 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 3 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 4 }),
    ];
    // Only 3 outcomes match a.com -> b.com, all are allows
    const result = analyzeOutcomesForPair(outcomes, "a.com", "b.com");
    expect(result).not.toBeNull();
    expect(result!.allowCount).toBe(3);
  });

  it("is case-insensitive for domain matching", () => {
    const outcomes = [
      makeOutcome({ domain: "A.COM", destDomain: "B.COM", outcome: "allow_once", ts: 1 }),
      makeOutcome({ domain: "a.com", destDomain: "b.com", outcome: "allow_once", ts: 2 }),
      makeOutcome({ domain: "A.com", destDomain: "B.Com", outcome: "allow_once", ts: 3 }),
    ];
    const result = analyzeOutcomesForPair(outcomes, "a.com", "b.com");
    expect(result).not.toBeNull();
    expect(result!.allowCount).toBe(3);
  });

  it("returns null for empty outcomes array", () => {
    expect(analyzeOutcomesForPair([], "a.com", "b.com")).toBeNull();
  });

  it("handles outcomes without destDomain (legacy entries)", () => {
    const outcomes = [
      makeOutcome({ domain: "a.com", outcome: "allow_once", ts: 1 }),
      makeOutcome({ domain: "a.com", outcome: "allow_once", ts: 2 }),
      makeOutcome({ domain: "a.com", outcome: "allow_once", ts: 3 }),
    ];
    // destDomain is undefined, so these won't match "b.com"
    expect(analyzeOutcomesForPair(outcomes, "a.com", "b.com")).toBeNull();
  });
});

describe("smart defaults – pairKey", () => {
  it("generates a stable key from source and dest", () => {
    expect(pairKey("a.com", "b.com")).toBe("a.com|b.com");
  });

  it("lowercases both domains", () => {
    expect(pairKey("A.COM", "B.COM")).toBe("a.com|b.com");
  });
});

describe("smart defaults – cooldown (pure)", () => {
  it("returns false when pair has no cooldown entry", () => {
    expect(isPairOnCooldownPure({}, "a.com", "b.com", Date.now())).toBe(false);
  });

  it("returns true when pair cooldown has not expired", () => {
    const now = Date.now();
    const cooldowns = { [pairKey("a.com", "b.com")]: now + 60_000 };
    expect(isPairOnCooldownPure(cooldowns, "a.com", "b.com", now)).toBe(true);
  });

  it("returns false when pair cooldown has expired", () => {
    const now = Date.now();
    const cooldowns = { [pairKey("a.com", "b.com")]: now - 1 };
    expect(isPairOnCooldownPure(cooldowns, "a.com", "b.com", now)).toBe(false);
  });

  it("uses correct cooldown duration constant", () => {
    expect(SMART_DEFAULT_COOLDOWN_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("uses correct threshold constant", () => {
    expect(SMART_DEFAULT_THRESHOLD).toBe(3);
  });
});

describe("smart defaults – storage integration", () => {
  type Store = Record<string, unknown>;

  function createChromeMock(initial: Store = {}) {
    const store: Store = { ...initial };
    return {
      store,
      chrome: {
        storage: {
          local: {
            async get(keys?: string | string[] | Record<string, unknown>) {
              if (keys === undefined) return { ...store };
              if (typeof keys === "string") {
                return keys in store ? { [keys]: store[keys] } : {};
              }
              if (Array.isArray(keys)) {
                return Object.fromEntries(
                  keys.filter((key) => key in store).map((key) => [key, store[key]])
                );
              }
              return Object.fromEntries(
                Object.entries(keys).map(([key, fallback]) => [key, key in store ? store[key] : fallback])
              );
            },
            async set(next: Record<string, unknown>) {
              for (const [key, value] of Object.entries(next)) {
                store[key] = value;
              }
            },
            async remove(keys: string | string[]) {
              const allKeys = Array.isArray(keys) ? keys : [keys];
              for (const key of allKeys) {
                delete store[key];
              }
            },
          },
          onChanged: {
            addListener() {},
          },
        },
      },
    };
  }

  beforeEach(() => {
    vi.resetModules();
  });

  it("setCooldown stores a future expiry timestamp", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { setCooldown } = await import("../extension/src/shared/smart_defaults");
    const before = Date.now();
    await setCooldown("a.com", "b.com");
    const after = Date.now();

    const cooldowns = store[SMART_DEFAULT_COOLDOWNS_KEY] as Record<string, number>;
    const key = "a.com|b.com";
    expect(cooldowns[key]).toBeGreaterThanOrEqual(before + SMART_DEFAULT_COOLDOWN_MS);
    expect(cooldowns[key]).toBeLessThanOrEqual(after + SMART_DEFAULT_COOLDOWN_MS);
  });

  it("isPairOnCooldown returns true for active cooldown", async () => {
    const future = Date.now() + SMART_DEFAULT_COOLDOWN_MS;
    const { chrome } = createChromeMock({
      [SMART_DEFAULT_COOLDOWNS_KEY]: { "a.com|b.com": future },
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { isPairOnCooldown } = await import("../extension/src/shared/smart_defaults");
    expect(await isPairOnCooldown("a.com", "b.com")).toBe(true);
  });

  it("isPairOnCooldown returns false for expired cooldown", async () => {
    const past = Date.now() - 1000;
    const { chrome } = createChromeMock({
      [SMART_DEFAULT_COOLDOWNS_KEY]: { "a.com|b.com": past },
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { isPairOnCooldown } = await import("../extension/src/shared/smart_defaults");
    expect(await isPairOnCooldown("a.com", "b.com")).toBe(false);
  });

  it("clearCooldown removes a pair's cooldown entry", async () => {
    const future = Date.now() + SMART_DEFAULT_COOLDOWN_MS;
    const { chrome } = createChromeMock({
      [SMART_DEFAULT_COOLDOWNS_KEY]: { "a.com|b.com": future, "c.com|d.com": future },
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { clearCooldown, isPairOnCooldown } = await import(
      "../extension/src/shared/smart_defaults"
    );
    await clearCooldown("a.com", "b.com");

    expect(await isPairOnCooldown("a.com", "b.com")).toBe(false);
    // Other pair should be unaffected
    expect(await isPairOnCooldown("c.com", "d.com")).toBe(true);
  });

  it("getCooldowns prunes expired entries from storage", async () => {
    const past = Date.now() - 1000;
    const future = Date.now() + SMART_DEFAULT_COOLDOWN_MS;
    const { chrome, store } = createChromeMock({
      [SMART_DEFAULT_COOLDOWNS_KEY]: {
        "expired.com|b.com": past,
        "active.com|b.com": future,
      },
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { getCooldowns } = await import("../extension/src/shared/smart_defaults");
    const result = await getCooldowns();

    expect(result).toEqual({ "active.com|b.com": future });
    // Verify storage was pruned
    const stored = store[SMART_DEFAULT_COOLDOWNS_KEY] as Record<string, number>;
    expect(stored).toEqual({ "active.com|b.com": future });
  });

  it("appendPromptOutcome stores destDomain field", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome, getPromptOutcomes } = await import(
      "../extension/src/shared/storage"
    );

    await appendPromptOutcome({
      domain: "source.com",
      destDomain: "dest.com",
      type: "nav",
      score: 45,
      outcome: "allow_once",
    });

    const outcomes = await getPromptOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.domain).toBe("source.com");
    expect(outcomes[0]!.destDomain).toBe("dest.com");
  });

  it("appendPromptOutcome omits destDomain when not provided", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome, getPromptOutcomes } = await import(
      "../extension/src/shared/storage"
    );

    await appendPromptOutcome({
      domain: "source.com",
      type: "nav",
      score: 45,
      outcome: "allow_once",
    });

    const outcomes = await getPromptOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.domain).toBe("source.com");
    expect(outcomes[0]!.destDomain).toBeUndefined();
  });
});
