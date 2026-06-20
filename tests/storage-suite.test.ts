import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = Record<string, unknown>;

function createChromeMock(initial: Store = {}) {
  const store: Store = { ...initial };
  const changeListeners: Array<(changes: Record<string, { oldValue: unknown; newValue: unknown }>, areaName: string) => void> = [];

  function emitChanges(changes: Record<string, { oldValue: unknown; newValue: unknown }>) {
    if (Object.keys(changes).length === 0) return;
    for (const listener of changeListeners) {
      listener(changes, "local");
    }
  }

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
                keys
                  .filter((key) => key in store)
                  .map((key) => [key, store[key]])
              );
            }
            return Object.fromEntries(
              Object.entries(keys).map(([key, fallback]) => [key, key in store ? store[key] : fallback])
            );
          },
          async set(next: Record<string, unknown>) {
            const changes: Record<string, { oldValue: unknown; newValue: unknown }> = {};
            for (const [key, value] of Object.entries(next)) {
              const oldValue = store[key];
              store[key] = value;
              changes[key] = { oldValue, newValue: value };
            }
            emitChanges(changes);
          },
          async remove(keys: string | string[]) {
            const allKeys = Array.isArray(keys) ? keys : [keys];
            const changes: Record<string, { oldValue: unknown; newValue: unknown }> = {};
            for (const key of allKeys) {
              if (!(key in store)) continue;
              const oldValue = store[key];
              delete store[key];
              changes[key] = { oldValue, newValue: undefined };
            }
            emitChanges(changes);
          }
        },
        onChanged: {
          addListener(listener: (changes: Record<string, { oldValue: unknown; newValue: unknown }>, areaName: string) => void) {
            changeListeners.push(listener);
          }
        }
      }
    }
  };
}

describe("suite storage and allowlist migration", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not resurrect a legacy allowlist when the current key is explicitly empty", async () => {
    const { chrome } = createChromeMock({
      "sentinelsuite:nav_allowlist_v1": {},
      "navsentinel:allowlist": {
        "example.com": ["legacy.example"]
      }
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { getAllowlist } = await import("../extension/src/shared/allowlist");
    const allowlist = await getAllowlist();

    expect(allowlist).toEqual({});
  });

  it("exports a normalized migrated allowlist", async () => {
    const { chrome, store } = createChromeMock({
      "navsentinel:allowlist": {
        " Example.com ": [" Login.Example.com ", 7, "login.example.com"]
      }
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { exportAll } = await import("../extension/src/shared/storage");
    const exported = await exportAll();

    expect(exported.allowlist).toEqual({
      "example.com": ["login.example.com"]
    });
    expect(store["sentinelsuite:nav_allowlist_v1"]).toEqual({
      "example.com": ["login.example.com"]
    });
  });

  it("normalizes imported allowlist payloads before storage", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({
      allowlist: {
        " Example.com ": [" Login.Example.com ", 7, "login.example.com", ""],
        "": ["ignored.example"]
      }
    });

    expect(store["sentinelsuite:nav_allowlist_v1"]).toEqual({
      "example.com": ["login.example.com"]
    });
  });

  it("normalizes trusted domains during import to registrable domains", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({
      trustedDomains: [
        " Login.Example.com ",
        "https://api.example.co.uk/login",
        "127.0.0.1",
        "EXAMPLE.COM"
      ]
    });

    expect(store["sentinelsuite:trusted_domains_v1"]).toEqual([
      "127.0.0.1",
      "example.co.uk",
      "example.com"
    ].sort());
  });

  it("normalizes trusted domain additions before storage", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { addTrustedDomain, getTrustedDomains } = await import("../extension/src/shared/storage");
    await addTrustedDomain("https://Login.Example.com/account");
    await addTrustedDomain("api.example.com");
    await addTrustedDomain("127.0.0.1");

    expect(await getTrustedDomains()).toEqual(["127.0.0.1", "example.com"]);
    expect(store["sentinelsuite:trusted_domains_v1"]).toEqual(["127.0.0.1", "example.com"]);
  });

  it("round-trips an IPv6-literal trusted domain (does not drop it on re-read) (#208 R2)", async () => {
    // normalizeHost emits IPv6 unbracketed; normalizeTrustedDomain must re-bracket
    // it for its fallback URL parse, else the stored value vanishes on re-read.
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { addTrustedDomain, getTrustedDomains } = await import("../extension/src/shared/storage");
    await addTrustedDomain("https://[2001:db8::1]/app");

    expect(await getTrustedDomains()).toContain("2001:db8::1"); // survives the re-read
  });

  it("rejects invalid trusted domain inputs during import and add", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { addTrustedDomain, getTrustedDomains, importAll } = await import(
      "../extension/src/shared/storage"
    );

    await importAll({
      trustedDomains: ["nota host/path", "still not a host", "https://login.example.com/account"]
    });
    await addTrustedDomain("definitely not a host/path");

    expect(await getTrustedDomains()).toEqual(["example.com"]);
    expect(store["sentinelsuite:trusted_domains_v1"]).toEqual(["example.com"]);
  });

  it("clamps imported event logs to the configured log limit", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({
      settings: { logLimit: 50 },
      eventLog: Array.from({ length: 120 }, (_, index) => ({
        id: `evt-${index}`,
        ts: index,
        kind: "suite_config_update"
      }))
    });

    const storedLog = store["sentinelsuite:event_log_v1"] as Array<{ id: string }>;
    expect(storedLog).toHaveLength(50);
    expect(storedLog[0]?.id).toBe("evt-70");
    expect(storedLog[49]?.id).toBe("evt-119");
  });

  it("clamps event log limit to minimum 50 when logLimit is below range", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({
      settings: { logLimit: 0 },
      eventLog: Array.from({ length: 80 }, (_, i) => ({
        id: `evt-${i}`,
        ts: i,
        kind: "suite_config_update"
      }))
    });

    const storedLog = store["sentinelsuite:event_log_v1"] as Array<{ id: string }>;
    expect(storedLog).toHaveLength(50);
    expect(storedLog[0]?.id).toBe("evt-30");
  });

  it("caps the imported event log via trimEventLog: evicts silent-decision kinds first, preserves loud (#252)", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    // 40 loud + 30 silent = 70 entries, limit 50 (over by 20). A plain slice(-50) would
    // drop the 20 oldest LOUD entries; trimEventLog evicts the 20 oldest SILENT entries
    // instead, so all 40 loud survive and only the newest 10 silent remain.
    const loud = Array.from({ length: 40 }, (_, i) => ({
      id: `loud-${i}`, ts: i, kind: "nav_click_block" as const,
    }));
    const silent = Array.from({ length: 30 }, (_, i) => ({
      id: `silent-${i}`, ts: 100 + i, kind: "nav_silent_allow" as const,
    }));

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({ settings: { logLimit: 50 }, eventLog: [...loud, ...silent] });

    const storedLog = store["sentinelsuite:event_log_v1"] as Array<{ id: string; kind: string }>;
    expect(storedLog).toHaveLength(50);
    expect(storedLog.filter((e) => e.kind === "nav_click_block")).toHaveLength(40); // all loud kept
    const silentKept = storedLog.filter((e) => e.kind === "nav_silent_allow");
    expect(silentKept).toHaveLength(10);
    expect(silentKept.map((e) => e.id)).toEqual(silent.slice(-10).map((e) => e.id)); // newest 10
  });

  it("caps an all-silent imported event log to the newest N via trimEventLog (#252)", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    // Degenerate-path coverage (NOT a fix discriminator — the mixed loud/silent test above
    // is). For a homogeneous all-silent log, trimEventLog's silent-first eviction is
    // equivalent to the old tail slice, so this passes pre-fix too; its value is exercising
    // the full importAll -> trimEventLog -> normalizeEventLog path on the all-silent shape.
    // logLimit is clamped to a minimum of 50 (clampInt), so overflow needs >50 entries.
    const silent = Array.from({ length: 60 }, (_, i) => ({
      id: `silent-${i}`, ts: i, kind: "nav_silent_allow" as const,
    }));

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({ settings: { logLimit: 50 }, eventLog: silent });

    const storedLog = store["sentinelsuite:event_log_v1"] as Array<{ id: string; kind: string }>;
    expect(storedLog).toHaveLength(50);
    expect(storedLog.map((e) => e.id)).toEqual(silent.slice(-50).map((e) => e.id)); // newest 50
    expect(storedLog.every((e) => e.kind === "nav_silent_allow")).toBe(true);
  });

  it("bounds imported event-log entry content (site/url/destHost/reasons/extra) to prevent quota exhaustion (#299)", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    // A crafted backup with megabyte-scale fields (shape-valid, so isEventLogEntry accepts it).
    const big = (n: number) => "C".repeat(n);
    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({
      eventLog: [
        {
          id: "e-1", ts: 1, kind: "nav_click_block",
          site: "https://evil.test/" + big(10000),
          url: "https://evil.test/" + big(10000),
          destHost: big(10000),
          reasons: Array.from({ length: 10000 }, () => "B".repeat(1000)),
          extra: { x: "A".repeat(5_000_000) },
        },
      ],
    });

    const stored = (store["sentinelsuite:event_log_v1"] as Array<Record<string, unknown>>)[0]!;
    expect(stored.extra).toBeUndefined(); // oversized extra dropped (fail closed)
    const reasons = stored.reasons as string[];
    expect(reasons.length).toBe(32); // exactly MAX_REASON_CODES (catches over- AND under-capping)
    expect(reasons.every((r) => r.length <= 80)).toBe(true); // MAX_REASON_CODE_LEN
    expect((stored.site as string).length).toBeLessThanOrEqual(2048); // MAX_EVENT_STRING_LEN
    expect((stored.url as string).length).toBeLessThanOrEqual(2048);
    expect((stored.destHost as string).length).toBeLessThanOrEqual(2048);
    expect(stored.id).toBe("e-1"); // small id preserved
    // Bound derived from ALL 4 capped strings (id/site/url/destHost) + reasons + overhead (was ~5MB pre-fix).
    expect(JSON.stringify(stored).length).toBeLessThan(4 * 2048 + 32 * 80 + 1000);
  });

  it("preserves a small serializable extra and short fields on import (#299)", async () => {
    // Inverted-condition guard: the oversized-extra DROP must be selective — a small, valid extra
    // (like the structural objects the live path emits) and short fields must survive verbatim.
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({
      eventLog: [
        {
          id: "ok-1", ts: 7, kind: "nav_silent_allow",
          destHost: "good.example", reasons: ["nrs_cross_site"],
          extra: { direction: "isolated_to_main", dropped: 3 },
        },
      ],
    });

    const stored = (store["sentinelsuite:event_log_v1"] as Array<Record<string, unknown>>)[0]!;
    expect(stored.extra).toEqual({ direction: "isolated_to_main", dropped: 3 }); // PRESERVED
    expect(stored.destHost).toBe("good.example");
    expect(stored.reasons).toEqual(["nrs_cross_site"]);
    expect(stored.id).toBe("ok-1");
  });

  it("preserves entry order and identity through import sanitize+trim (#299)", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const entries = [
      { id: "a", ts: 1, kind: "nav_click_block", score: 50, reasons: ["r1"] },
      { id: "b", ts: 2, kind: "nav_blank_prompt", score: 70 },
      { id: "c", ts: 3, kind: "nav_silent_allow" },
    ];
    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({ eventLog: entries });

    const stored = store["sentinelsuite:event_log_v1"] as Array<Record<string, unknown>>;
    expect(stored.map((e) => e.id)).toEqual(["a", "b", "c"]); // order preserved
    expect(stored.map((e) => [e.ts, e.kind, e.score])).toEqual([
      [1, "nav_click_block", 50],
      [2, "nav_blank_prompt", 70],
      [3, "nav_silent_allow", undefined],
    ]);
    expect(stored[0]!.reasons).toEqual(["r1"]); // reasons survive sanitize+trim (not dropped)
  });

  it("keeps extra at the size boundary, drops just over, and caps an oversized id (#299)", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    // Build extra whose JSON length is exactly 4096 (kept) and one at 4097 (dropped). JSON of
    // {"v":"<n A's>"} is the value length + 8 chars of envelope, so n = 4096 - 8 = 4088 keeps it.
    const atCap = { v: "A".repeat(4096 - 8) };       // JSON.stringify length === 4096
    const overCap = { v: "A".repeat(4096 - 8 + 1) }; // 4097
    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({
      eventLog: [
        { id: "X".repeat(10000), ts: 1, kind: "nav_click_block", extra: atCap },
        { id: "over", ts: 2, kind: "nav_click_block", extra: overCap },
      ],
    });

    const stored = store["sentinelsuite:event_log_v1"] as Array<Record<string, unknown>>;
    expect(JSON.stringify(stored[0]!.extra).length).toBe(4096); // exactly-at-cap extra preserved
    expect((stored[0]!.id as string).length).toBe(2048); // oversized id capped to MAX_EVENT_STRING_LEN
    expect(stored[1]!.extra).toBeUndefined(); // just-over-cap extra dropped
  });

  it("imports prompt outcomes and computes non-zero adaptive scores", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    const outcomes = [
      { id: "o-1", ts: 1000, domain: "example.com", destDomain: "evil.com", type: "nav", score: 80, outcome: "block" },
      { id: "o-2", ts: 2000, domain: "example.com", destDomain: "evil.com", type: "nav", score: 85, outcome: "block" },
      { id: "o-3", ts: 3000, domain: "example.com", destDomain: "evil.com", type: "nav", score: 90, outcome: "block" },
    ];
    await importAll({ promptOutcomes: outcomes });

    const storedOutcomes = store["sentinelsuite:prompt_outcomes_v1"] as Array<{ id: string }>;
    expect(storedOutcomes).toHaveLength(3);
    expect(storedOutcomes[0]?.id).toBe("o-1");

    const adaptiveScores = store["sentinelsuite:adaptive_scores_v1"] as Record<string, { adjustment: number }>;
    expect(Object.keys(adaptiveScores).length).toBeGreaterThan(0);
    const domainScore = adaptiveScores["example.com"];
    expect(domainScore).toBeDefined();
    expect(domainScore!.adjustment).toBeLessThan(0);
  });

  it("clears adaptive scores when no prompt outcomes are imported", async () => {
    const { chrome, store } = createChromeMock({
      "sentinelsuite:adaptive_scores_v1": { "evil.com": { adjustment: 5, sampleCount: 3, lastUpdated: 1000 } },
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({ settings: { logLimit: 300 } });

    const adaptiveScores = store["sentinelsuite:adaptive_scores_v1"] as Record<string, unknown>;
    expect(adaptiveScores).toEqual({});
  });

  it("caps imported prompt outcomes at 500", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    const outcomes = Array.from({ length: 600 }, (_, i) => ({
      id: `o-${i}`, ts: i, domain: "a.com", type: "nav", score: 50, outcome: "allow",
    }));
    await importAll({ promptOutcomes: outcomes });

    const storedOutcomes = store["sentinelsuite:prompt_outcomes_v1"] as Array<{ id: string }>;
    expect(storedOutcomes).toHaveLength(500);
    expect(storedOutcomes[0]?.id).toBe("o-100");
  });

  it("rejects non-object import payloads", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await expect(importAll(null)).rejects.toThrow("Invalid import payload");
    await expect(importAll(undefined)).rejects.toThrow("Invalid import payload");
    await expect(importAll("string")).rejects.toThrow("Invalid import payload");
    await expect(importAll(42)).rejects.toThrow("Invalid import payload");
  });

  it("leaves the core config unchanged when a section write fails mid-import (#203)", async () => {
    // Pre-existing config the import must NOT partially overwrite.
    const { chrome, store } = createChromeMock({
      "sentinelsuite:nav_allowlist_v1": { "old.com": ["a.old.com"] },
      "sentinelsuite:trusted_domains_v1": ["old.example"],
    });
    // Simulate a storage failure (e.g. quota) that hits the event-log section. Under
    // the old sequential-write importAll, settings/allowlist/trustedDomains were
    // already committed before this rejected, leaving a partial config. The atomic
    // single-set commit must instead leave ALL core sections untouched.
    const realSet = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = (async (next: Record<string, unknown>) => {
      if ("sentinelsuite:event_log_v1" in next) {
        throw new Error("QUOTA_BYTES quota exceeded");
      }
      return realSet(next);
    }) as typeof chrome.storage.local.set;
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await expect(
      importAll({
        settings: { logLimit: 1234 },
        allowlist: { "new.com": ["b.new.com"] },
        trustedDomains: ["new.example"],
        eventLog: [{ id: "e-1", ts: 1, kind: "nav_click_block" }],
      })
    ).rejects.toThrow(/quota/i);

    // No partial application: every core section retains its original value.
    expect(store["sentinelsuite:nav_allowlist_v1"]).toEqual({ "old.com": ["a.old.com"] });
    expect(store["sentinelsuite:trusted_domains_v1"]).toEqual(["old.example"]);
    expect(store["sentinelsuite:settings_v1"]).toBeUndefined();
    expect(store["sentinelsuite:event_log_v1"]).toBeUndefined();
  });

  it("commits every core section in a single atomic set (#203)", async () => {
    const { chrome, store } = createChromeMock();
    const setSpy = vi.spyOn(chrome.storage.local, "set");
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({
      settings: { logLimit: 300 },
      allowlist: { "example.com": ["login.example.com"] },
      trustedDomains: ["example.com"],
      eventLog: [{ id: "e-1", ts: 1, kind: "nav_click_block" }],
    });

    // One write for all core sections (no promptOutcomes -> no separate delegate).
    expect(setSpy).toHaveBeenCalledTimes(1);
    const written = setSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(
      [
        "sentinelsuite:adaptive_scores_v1",
        "sentinelsuite:event_log_v1",
        "sentinelsuite:nav_allowlist_v1",
        "sentinelsuite:settings_v1",
        "sentinelsuite:trusted_domains_v1",
      ].sort()
    );
    // Adaptive scores reset folded into the same atomic write (no promptOutcomes).
    expect(store["sentinelsuite:adaptive_scores_v1"]).toEqual({});
    expect(store["sentinelsuite:trusted_domains_v1"]).toEqual(["example.com"]);
  });

  it("uses default logLimit (300) when no settings are provided in import", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({
      eventLog: Array.from({ length: 400 }, (_, i) => ({
        id: `evt-${i}`, ts: i, kind: "suite_config_update"
      }))
    });

    const storedLog = store["sentinelsuite:event_log_v1"] as Array<{ id: string }>;
    expect(storedLog).toHaveLength(300);
    expect(storedLog[0]?.id).toBe("evt-100");
  });

  it("clears adaptive scores when promptOutcomes is present but not an array", async () => {
    const { chrome, store } = createChromeMock({
      "sentinelsuite:adaptive_scores_v1": { "evil.com": { adjustment: 5, sampleCount: 3, lastUpdated: 1000 } },
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({ promptOutcomes: "not-an-array" });

    const adaptiveScores = store["sentinelsuite:adaptive_scores_v1"] as Record<string, unknown>;
    expect(adaptiveScores).toEqual({});
  });

  it("imports eventLog and promptOutcomes together", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({
      eventLog: [
        { id: "e-1", ts: 1, kind: "nav_click_block" },
        { id: "e-2", ts: 2, kind: "nav_rollback" },
      ],
      promptOutcomes: [
        { id: "o-1", ts: 1, domain: "a.com", type: "nav", score: 50, outcome: "allow" },
      ],
    });

    const storedLog = store["sentinelsuite:event_log_v1"] as Array<{ id: string }>;
    expect(storedLog).toHaveLength(2);
    const storedOutcomes = store["sentinelsuite:prompt_outcomes_v1"] as Array<{ id: string }>;
    expect(storedOutcomes).toHaveLength(1);
  });

  it("handles empty arrays for eventLog and promptOutcomes", async () => {
    const { chrome, store } = createChromeMock({
      "sentinelsuite:event_log_v1": [{ id: "old", ts: 1, kind: "nav_click_block" }],
      "sentinelsuite:prompt_outcomes_v1": [{ id: "old-o", ts: 1, domain: "a.com", type: "nav", score: 10, outcome: "allow" }],
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({ eventLog: [], promptOutcomes: [] });

    const storedLog = store["sentinelsuite:event_log_v1"] as Array<unknown>;
    expect(storedLog).toEqual([]);
    const storedOutcomes = store["sentinelsuite:prompt_outcomes_v1"] as Array<unknown>;
    expect(storedOutcomes).toEqual([]);
  });
});
