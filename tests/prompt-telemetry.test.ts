import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("prompt telemetry storage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("appendPromptOutcome stores entries correctly", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome, getPromptOutcomes } = await import(
      "../extension/src/shared/storage"
    );

    await appendPromptOutcome({
      domain: "example.com",
      type: "nav",
      score: 45,
      outcome: "allow_once"
    });

    const outcomes = await getPromptOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.domain).toBe("example.com");
    expect(outcomes[0]!.type).toBe("nav");
    expect(outcomes[0]!.score).toBe(45);
    expect(outcomes[0]!.outcome).toBe("allow_once");
    expect(outcomes[0]!.id).toBeTruthy();
    expect(outcomes[0]!.ts).toBeGreaterThan(0);
  });

  it("bounds entries to 500", async () => {
    const key = "sentinelsuite:prompt_outcomes_v1";
    const existing = Array.from({ length: 500 }, (_, i) => ({
      id: `old-${i}`,
      ts: i,
      domain: "test.com",
      type: "nav",
      score: 10,
      outcome: "block"
    }));
    const { chrome } = createChromeMock({ [key]: existing });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome, getPromptOutcomes } = await import(
      "../extension/src/shared/storage"
    );

    await appendPromptOutcome({
      domain: "new.com",
      type: "cred",
      score: 80,
      outcome: "cancel"
    });

    const outcomes = await getPromptOutcomes();
    expect(outcomes).toHaveLength(500);
    expect(outcomes[outcomes.length - 1]!.domain).toBe("new.com");
    expect(outcomes[0]!.id).toBe("old-1");
  });

  it("clearPromptOutcomes empties the store", async () => {
    const key = "sentinelsuite:prompt_outcomes_v1";
    const { chrome } = createChromeMock({
      [key]: [{ id: "x", ts: 1, domain: "a.com", type: "nav", score: 0, outcome: "block" }]
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { clearPromptOutcomes, getPromptOutcomes } = await import(
      "../extension/src/shared/storage"
    );

    await clearPromptOutcomes();
    const outcomes = await getPromptOutcomes();
    expect(outcomes).toHaveLength(0);
  });

  it("exportAll includes promptOutcomes", async () => {
    const key = "sentinelsuite:prompt_outcomes_v1";
    const entry = { id: "e1", ts: 100, domain: "foo.com", type: "nav", score: 30, outcome: "dismiss" };
    const { chrome } = createChromeMock({ [key]: [entry] });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { exportAll } = await import("../extension/src/shared/storage");
    const exported = await exportAll();

    expect(exported.promptOutcomes).toHaveLength(1);
    expect(exported.promptOutcomes[0]!.id).toBe("e1");
  });

  it("importAll restores promptOutcomes", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll, getPromptOutcomes } = await import("../extension/src/shared/storage");

    await importAll({
      promptOutcomes: [
        { id: "imp1", ts: 200, domain: "bar.com", type: "cred", score: 60, outcome: "trust" }
      ]
    });

    const outcomes = await getPromptOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.domain).toBe("bar.com");
  });

  it("importAll without promptOutcomes does not clear existing data", async () => {
    const key = "sentinelsuite:prompt_outcomes_v1";
    const { chrome } = createChromeMock({
      [key]: [{ id: "keep", ts: 1, domain: "a.com", type: "nav", score: 0, outcome: "block" }]
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll, getPromptOutcomes } = await import("../extension/src/shared/storage");
    await importAll({});

    const outcomes = await getPromptOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.id).toBe("keep");
  });

  it("importAll bounds promptOutcomes to 500", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll, getPromptOutcomes } = await import("../extension/src/shared/storage");
    const big = Array.from({ length: 600 }, (_, i) => ({
      id: `i-${i}`,
      ts: i,
      domain: "x.com",
      type: "nav",
      score: 0,
      outcome: "block"
    }));

    await importAll({ promptOutcomes: big });
    const outcomes = await getPromptOutcomes();
    expect(outcomes).toHaveLength(500);
    expect(outcomes[0]!.id).toBe("i-100");
  });
});
