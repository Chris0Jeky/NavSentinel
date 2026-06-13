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

describe("prompt telemetry replay-grade enrichment (P5-C1 / #238)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("stores and round-trips the enriched feature fields", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { appendPromptOutcome, getPromptOutcomes } = await import("../extension/src/shared/storage");

    await appendPromptOutcome({
      domain: "src.example",
      destDomain: "dest.example",
      type: "nav",
      score: 72,
      outcome: "block",
      reasons: ["nrs_cross_site", "overlay_large_interactive"],
      cds: 41,
      nrsFactors: ["nrs_cross_site", "nrs_new_tab_window"],
      navAnomalyScore: 15,
      adaptiveAdj: -5,
      thresholdUsed: 65,
      elementContext: {
        viewport: { w: 1280, h: 720 },
        input: "pointer",
        top: { tag: "A", role: "link", targetBlank: true, textLength: 4, opacity: 0.5 },
        underlying: { tag: "DIV" },
        retargeted: true
      }
    });

    const [entry] = await getPromptOutcomes();
    expect(entry!.reasons).toEqual(["nrs_cross_site", "overlay_large_interactive"]);
    expect(entry!.cds).toBe(41);
    expect(entry!.nrsFactors).toEqual(["nrs_cross_site", "nrs_new_tab_window"]);
    expect(entry!.navAnomalyScore).toBe(15);
    expect(entry!.adaptiveAdj).toBe(-5);
    expect(entry!.thresholdUsed).toBe(65);
    expect(entry!.elementContext?.top.tag).toBe("A");
    expect(entry!.elementContext?.top.targetBlank).toBe(true);
    expect(entry!.elementContext?.underlying?.tag).toBe("DIV");
    expect(entry!.elementContext?.retargeted).toBe(true);
  });

  it("keeps thin legacy records valid (enrichment is optional)", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { appendPromptOutcome, getPromptOutcomes } = await import("../extension/src/shared/storage");

    await appendPromptOutcome({ domain: "thin.example", type: "nav", score: 10, outcome: "dismiss" });
    const [entry] = await getPromptOutcomes();
    expect(entry!.domain).toBe("thin.example");
    expect(entry!.cds).toBeUndefined();
    expect(entry!.nrsFactors).toBeUndefined();
    expect(entry!.elementContext).toBeUndefined();
  });

  it("caps reason/factor lists by count and length", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { appendPromptOutcome, getPromptOutcomes } = await import("../extension/src/shared/storage");

    const longCode = "X".repeat(200);
    await appendPromptOutcome({
      domain: "bloat.example",
      type: "nav",
      score: 50,
      outcome: "block",
      reasons: Array.from({ length: 64 }, () => longCode),
      nrsFactors: Array.from({ length: 64 }, () => longCode)
    });

    const [entry] = await getPromptOutcomes();
    expect(entry!.reasons!.length).toBe(32);
    expect(entry!.reasons!.every((r) => r.length <= 80)).toBe(true);
    expect(entry!.nrsFactors!.length).toBe(32);
    expect(entry!.nrsFactors!.every((r) => r.length <= 80)).toBe(true);
  });

  it("drops non-finite numeric enrichment but keeps the record", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { appendPromptOutcome, getPromptOutcomes } = await import("../extension/src/shared/storage");

    const append = (p: unknown) => appendPromptOutcome(p as Parameters<typeof appendPromptOutcome>[0]);
    await append({
      domain: "nan.example",
      type: "nav",
      score: 30,
      outcome: "block",
      cds: Number.NaN,
      navAnomalyScore: Number.POSITIVE_INFINITY,
      adaptiveAdj: 7
    });

    const [entry] = await getPromptOutcomes();
    expect(entry!.score).toBe(30);
    expect(entry!.cds).toBeUndefined();
    expect(entry!.navAnomalyScore).toBeUndefined();
    expect(entry!.adaptiveAdj).toBe(7);
  });

  it("whitelists elementContext fields and drops unknown keys", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { appendPromptOutcome, getPromptOutcomes } = await import("../extension/src/shared/storage");

    const append = (p: unknown) => appendPromptOutcome(p as Parameters<typeof appendPromptOutcome>[0]);
    await append({
      domain: "junk.example",
      type: "nav",
      score: 30,
      outcome: "block",
      elementContext: {
        viewport: { w: 100, h: 100 },
        input: "pointer",
        top: { tag: "BUTTON", junkField: "DROP_ME", textLength: 3 },
        bogusTopLevel: 999
      }
    });

    const [entry] = await getPromptOutcomes();
    const ctx = entry!.elementContext as Record<string, unknown> | undefined;
    const top = ctx?.top as Record<string, unknown> | undefined;
    expect(top?.tag).toBe("BUTTON");
    expect(top?.textLength).toBe(3);
    expect(top && "junkField" in top).toBe(false);
    expect(ctx && "bogusTopLevel" in ctx).toBe(false);
  });

  it("bounds elementContext dimensions (drops extreme rect, zeroes extreme viewport)", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { appendPromptOutcome, getPromptOutcomes } = await import("../extension/src/shared/storage");

    const append = (p: unknown) => appendPromptOutcome(p as Parameters<typeof appendPromptOutcome>[0]);
    await append({
      domain: "dims.example",
      type: "nav",
      score: 30,
      outcome: "block",
      elementContext: {
        viewport: { w: Number.MAX_VALUE, h: -10 },
        input: "pointer",
        top: { tag: "A", rect: { w: 1e9, h: 50 } }
      }
    });

    const [entry] = await getPromptOutcomes();
    // extreme/negative viewport dims fall back to 0
    expect(entry!.elementContext?.viewport).toEqual({ w: 0, h: 0 });
    // a rect with an out-of-range dimension is dropped entirely
    expect(entry!.elementContext?.top.rect).toBeUndefined();
    expect(entry!.elementContext?.top.tag).toBe("A");
  });

  it("omits elementContext when there is no usable top element", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { appendPromptOutcome, getPromptOutcomes } = await import("../extension/src/shared/storage");

    const append = (p: unknown) => appendPromptOutcome(p as Parameters<typeof appendPromptOutcome>[0]);
    await append({
      domain: "notop.example",
      type: "nav",
      score: 30,
      outcome: "block",
      elementContext: { viewport: { w: 1, h: 1 }, input: "pointer", top: {} }
    });

    const [entry] = await getPromptOutcomes();
    expect(entry!.elementContext).toBeUndefined();
  });

  it("export/import round-trips enriched fields", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { appendPromptOutcome, exportAll, importAll, getPromptOutcomes, clearPromptOutcomes } = await import(
      "../extension/src/shared/storage"
    );

    await appendPromptOutcome({
      domain: "round.example",
      destDomain: "trip.example",
      type: "cred",
      score: 88,
      outcome: "cancel",
      reasons: ["LOOKALIKE_DOMAIN"],
      cds: 12,
      thresholdUsed: 70,
      elementContext: { viewport: { w: 800, h: 600 }, input: "pointer", top: { tag: "FORM" } }
    });

    const exported = await exportAll();
    expect(exported.promptOutcomes[0]!.cds).toBe(12);
    expect(exported.promptOutcomes[0]!.elementContext?.top.tag).toBe("FORM");

    await clearPromptOutcomes();
    expect(await getPromptOutcomes()).toHaveLength(0);

    await importAll({ promptOutcomes: exported.promptOutcomes });
    const [restored] = await getPromptOutcomes();
    expect(restored!.cds).toBe(12);
    expect(restored!.thresholdUsed).toBe(70);
    expect(restored!.destDomain).toBe("trip.example");
    expect(restored!.elementContext?.top.tag).toBe("FORM");
  });
});
