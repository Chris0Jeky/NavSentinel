import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    }
  };
}

function stubChrome(initial: Store = {}) {
  const { chrome } = createChromeMock(initial);
  vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
}

// Unbounded prompt-outcome scalars must never be accepted or persisted.
// Repro: { domain: "example.com", type: "nav", score: 1e12, outcome: "allow",
// cds: 1e308, thresholdUsed: -1e12 } was accepted by isPromptOutcomeEntry /
// buildPromptOutcomeRecord and persisted via boundPromptOutcomeLog.
describe("prompt outcome scalar bounds", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects the unbounded repro entry at the append gate", async () => {
    stubChrome();
    const { isPromptOutcomeStorageMessage } = await import("../extension/src/shared/storage");
    expect(isPromptOutcomeStorageMessage({
      type: "ns-prompt-outcome-append",
      entry: {
        id: "repro",
        ts: Date.now(),
        domain: "example.com",
        type: "nav",
        score: 1e12,
        outcome: "allow",
        cds: 1e308,
        thresholdUsed: -1e12,
      },
    })).toBe(false);
  });

  it("does not persist the unbounded repro entry via live append", async () => {
    stubChrome();
    const { appendPromptOutcome, getPromptOutcomes } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({
      domain: "example.com",
      type: "nav",
      score: 1e12,
      outcome: "allow",
      cds: 1e308,
      thresholdUsed: -1e12,
    });
    expect(await getPromptOutcomes()).toHaveLength(0);
  });

  it("drops a live append with a huge score", async () => {
    stubChrome();
    const { appendPromptOutcome, getPromptOutcomes } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({ domain: "example.com", type: "nav", score: 1e12, outcome: "allow" });
    expect(await getPromptOutcomes()).toHaveLength(0);
  });

  it("omits a huge cds instead of persisting it", async () => {
    stubChrome();
    const { appendPromptOutcome, getPromptOutcomes } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({
      domain: "example.com",
      type: "nav",
      score: 50,
      outcome: "allow",
      cds: 1e308,
    });
    const outcomes = await getPromptOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.score).toBe(50);
    expect(outcomes[0]!.cds).toBeUndefined();
  });

  it("omits a negative huge thresholdUsed instead of persisting it", async () => {
    stubChrome();
    const { appendPromptOutcome, getPromptOutcomes } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({
      domain: "example.com",
      type: "nav",
      score: 50,
      outcome: "allow",
      thresholdUsed: -1e12,
    });
    const outcomes = await getPromptOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.score).toBe(50);
    expect(outcomes[0]!.thresholdUsed).toBeUndefined();
  });

  it("drops unbounded scalars on the import path", async () => {
    stubChrome();
    const { importAll, getPromptOutcomes } = await import("../extension/src/shared/storage");
    await importAll({
      promptOutcomes: [{
        id: "repro",
        ts: Date.now(),
        domain: "example.com",
        type: "nav",
        score: 1e12,
        outcome: "allow",
        cds: 1e308,
        thresholdUsed: -1e12,
      }],
    });
    expect(await getPromptOutcomes()).toHaveLength(0);
  });

  it("keeps documented in-range replay values on both paths", async () => {
    stubChrome();
    const {
      appendPromptOutcome,
      getPromptOutcomes,
      isPromptOutcomeStorageMessage,
    } = await import("../extension/src/shared/storage");
    const entry = {
      id: "legit",
      ts: Date.now(),
      domain: "example.com",
      type: "nav" as const,
      score: 72,
      outcome: "block" as const,
      cds: 41,
      navAnomalyScore: 15,
      adaptiveAdj: -5,
      thresholdUsed: 65,
    };
    expect(isPromptOutcomeStorageMessage({ type: "ns-prompt-outcome-append", entry })).toBe(true);
    await appendPromptOutcome(entry);
    const outcomes = await getPromptOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.cds).toBe(41);
    expect(outcomes[0]!.navAnomalyScore).toBe(15);
    expect(outcomes[0]!.adaptiveAdj).toBe(-5);
    expect(outcomes[0]!.thresholdUsed).toBe(65);
  });
});
