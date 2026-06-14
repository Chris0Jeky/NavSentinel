import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { SuiteSettings, EventLogEntry, PromptOutcomeEntry, EventKind, PromptOutcome, PromptType } from "../extension/src/shared/storage";

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
                keys.filter((key) => key in store).map((key) => [key, store[key]]),
              );
            }
            return Object.fromEntries(
              Object.entries(keys).map(([key, fallback]) => [key, key in store ? store[key] : fallback]),
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
          },
        },
        onChanged: {
          addListener(listener: (changes: Record<string, { oldValue: unknown; newValue: unknown }>, areaName: string) => void) {
            changeListeners.push(listener);
          },
        },
      },
    },
  };
}

const EVENT_KINDS: EventKind[] = [
  "nav_blank_prompt", "nav_click_block", "nav_silent_allow", "nav_rollback",
  "nav_allowlist_add", "nav_allowlist_remove", "cred_submit_prompt",
  "cred_submit_allow_once", "cred_trust_domain", "cred_untrust_domain",
  "cred_paste_warn", "cred_form_evaluated", "suite_config_update",
  "clickfix_detected", "dblclickjack_detected", "nav_reputation_late_warn",
  "mutation_alert", "pushstate_abuse", "bridge_buffer_overflow",
];

const PROMPT_OUTCOMES: PromptOutcome[] = [
  "allow", "allow_once", "always_allow", "block", "trust", "dismiss", "cancel",
];

const PROMPT_TYPES: PromptType[] = ["nav", "cred"];

const arbEventKind = fc.constantFrom(...EVENT_KINDS);
const arbPromptOutcome = fc.constantFrom(...PROMPT_OUTCOMES);
const arbPromptType = fc.constantFrom(...PROMPT_TYPES);

// Optional fields use `requiredKeys` so they are either present with a
// concrete value or omitted entirely — never an explicit `undefined`, which
// would violate the interface under `exactOptionalPropertyTypes`.
const arbEventLogEntry: fc.Arbitrary<EventLogEntry> = fc.record(
  {
    id: fc.string({ minLength: 1, maxLength: 20 }),
    ts: fc.integer({ min: 0, max: 2_000_000_000_000 }),
    kind: arbEventKind,
    site: fc.constantFrom("example.com", "test.org"),
    url: fc.constantFrom("https://example.com/page", "https://test.org/login"),
    destHost: fc.constantFrom("evil.com", "phish.net"),
    score: fc.integer({ min: 0, max: 100 }),
    reasons: fc.array(fc.constantFrom("cross_site", "suspicious_url", "no_referrer"), { minLength: 1, maxLength: 3 }),
  },
  { requiredKeys: ["id", "ts", "kind"] }
);

const arbPromptOutcomeEntry: fc.Arbitrary<PromptOutcomeEntry> = fc.record(
  {
    id: fc.string({ minLength: 1, maxLength: 20 }),
    ts: fc.integer({ min: 0, max: 2_000_000_000_000 }),
    domain: fc.constantFrom("example.com", "test.org", "bank.co.uk", "shop.net"),
    destDomain: fc.constantFrom("evil.com", "phish.net", "scam.org"),
    type: arbPromptType,
    score: fc.integer({ min: 0, max: 100 }),
    outcome: arbPromptOutcome,
    reasons: fc.array(fc.constantFrom("cross_site", "suspicious_url"), { minLength: 1, maxLength: 2 }),
  },
  { requiredKeys: ["id", "ts", "domain", "type", "score", "outcome"] }
);

const arbSuiteSettings: fc.Arbitrary<SuiteSettings> = fc.record({
  nav: fc.record({
    defaultMode: fc.constantFrom("smart" as const, "strict" as const, "off" as const),
    debug: fc.boolean(),
    dnrEnabled: fc.boolean(),
  }),
  credential: fc.record({
    mode: fc.constantFrom("off" as const, "smart" as const, "strict" as const),
    promptOnUntrustedDomain: fc.boolean(),
    promptOnMediumRisk: fc.boolean(),
    mediumRiskThreshold: fc.integer({ min: 0, max: 100 }),
    blockHttpPasswordSubmit: fc.boolean(),
    warnOnPaste: fc.boolean(),
    similarity: fc.record({
      enabled: fc.boolean(),
      maxDistance: fc.integer({ min: 0, max: 8 }),
    }),
  }),
  logLimit: fc.integer({ min: 50, max: 5000 }),
});

describe("storage property tests", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("getSuiteSettings idempotence", () => {
    it("returns valid SuiteSettings for any stored partial", async () => {
      await fc.assert(
        fc.asyncProperty(arbSuiteSettings, async (settings) => {
          vi.resetModules();
          const { chrome } = createChromeMock({
            "sentinelsuite:settings_v1": settings,
          });
          vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

          const { getSuiteSettings } = await import("../extension/src/shared/storage");
          const result = await getSuiteSettings();

          expect(result.logLimit).toBeGreaterThanOrEqual(50);
          expect(result.logLimit).toBeLessThanOrEqual(5000);
          expect(result.credential.mediumRiskThreshold).toBeGreaterThanOrEqual(0);
          expect(result.credential.mediumRiskThreshold).toBeLessThanOrEqual(100);
          expect(result.credential.similarity.maxDistance).toBeGreaterThanOrEqual(0);
          expect(result.credential.similarity.maxDistance).toBeLessThanOrEqual(8);
          expect(["smart", "strict", "off"]).toContain(result.nav.defaultMode);
          expect(typeof result.nav.debug).toBe("boolean");
          expect(typeof result.nav.dnrEnabled).toBe("boolean");

          vi.unstubAllGlobals();
        }),
        { numRuns: 30 },
      );
    });

    it("is idempotent: get→update→get produces same result", async () => {
      await fc.assert(
        fc.asyncProperty(arbSuiteSettings, async (settings) => {
          vi.resetModules();
          const { chrome } = createChromeMock();
          vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

          const { updateSuiteSettings, getSuiteSettings } = await import("../extension/src/shared/storage");
          const first = await updateSuiteSettings(settings);
          const second = await getSuiteSettings();

          expect(second).toEqual(first);

          vi.unstubAllGlobals();
        }),
        { numRuns: 30 },
      );
    });

    it("clamped values stay clamped after round-trip", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -1000, max: 10000 }),
          fc.integer({ min: -100, max: 200 }),
          fc.integer({ min: -10, max: 20 }),
          async (logLimit, mediumRisk, maxDistance) => {
            vi.resetModules();
            const { chrome } = createChromeMock();
            vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

            const { updateSuiteSettings } = await import("../extension/src/shared/storage");
            const result = await updateSuiteSettings({
              logLimit,
              credential: { mediumRiskThreshold: mediumRisk, similarity: { maxDistance } },
            });

            expect(result.logLimit).toBeGreaterThanOrEqual(50);
            expect(result.logLimit).toBeLessThanOrEqual(5000);
            expect(result.credential.mediumRiskThreshold).toBeGreaterThanOrEqual(0);
            expect(result.credential.mediumRiskThreshold).toBeLessThanOrEqual(100);
            expect(result.credential.similarity.maxDistance).toBeGreaterThanOrEqual(0);
            expect(result.credential.similarity.maxDistance).toBeLessThanOrEqual(8);

            vi.unstubAllGlobals();
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe("trusted domains normalization", () => {
    it("addTrustedDomain produces sorted unique registrable domains", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.constantFrom(
              "example.com", "test.org", "bank.co.uk", "Example.COM",
              "https://login.example.com", "sub.test.org", "127.0.0.1",
            ),
            { minLength: 1, maxLength: 8 },
          ),
          async (domains) => {
            vi.resetModules();
            const { chrome } = createChromeMock();
            vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

            const { addTrustedDomain, getTrustedDomains } = await import("../extension/src/shared/storage");
            for (const d of domains) {
              await addTrustedDomain(d);
            }

            const result = await getTrustedDomains();
            const sorted = [...result].sort();
            expect(result).toEqual(sorted);

            const unique = new Set(result);
            expect(unique.size).toBe(result.length);

            for (const d of result) {
              expect(d).toBe(d.toLowerCase());
            }

            vi.unstubAllGlobals();
          },
        ),
        { numRuns: 20 },
      );
    });

    it("removeTrustedDomain is inverse of addTrustedDomain", async () => {
      vi.resetModules();
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

      const { addTrustedDomain, removeTrustedDomain, getTrustedDomains } = await import("../extension/src/shared/storage");
      await addTrustedDomain("example.com");
      await addTrustedDomain("test.org");

      let domains = await getTrustedDomains();
      expect(domains).toContain("example.com");
      expect(domains).toContain("test.org");

      await removeTrustedDomain("example.com");
      domains = await getTrustedDomains();
      expect(domains).not.toContain("example.com");
      expect(domains).toContain("test.org");
    });

    it("addTrustedDomain is idempotent", async () => {
      vi.resetModules();
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

      const { addTrustedDomain, getTrustedDomains } = await import("../extension/src/shared/storage");
      await addTrustedDomain("example.com");
      const after1 = await getTrustedDomains();
      await addTrustedDomain("example.com");
      const after2 = await getTrustedDomains();

      expect(after1).toEqual(after2);
    });

    it("clearTrustedDomains removes all", async () => {
      vi.resetModules();
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

      const { addTrustedDomain, clearTrustedDomains, getTrustedDomains } = await import("../extension/src/shared/storage");
      await addTrustedDomain("example.com");
      await addTrustedDomain("test.org");
      await clearTrustedDomains();

      expect(await getTrustedDomains()).toEqual([]);
    });
  });

  describe("exportAll / importAll round-trip", () => {
    it("settings survive round-trip with correct clamping", async () => {
      await fc.assert(
        fc.asyncProperty(arbSuiteSettings, async (settings) => {
          vi.resetModules();
          const { chrome } = createChromeMock();
          vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

          const { updateSuiteSettings, exportAll, getSuiteSettings } = await import("../extension/src/shared/storage");
          await updateSuiteSettings(settings);
          const exported = await exportAll();
          const original = await getSuiteSettings();

          vi.resetModules();
          const { chrome: chrome2 } = createChromeMock();
          vi.stubGlobal("chrome", chrome2 as unknown as typeof globalThis.chrome);

          const mod2 = await import("../extension/src/shared/storage");
          await mod2.importAll(exported);
          const restored = await mod2.getSuiteSettings();

          expect(restored).toEqual(original);

          vi.unstubAllGlobals();
        }),
        { numRuns: 20 },
      );
    });

    it("event log entries survive round-trip within limit", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(arbEventLogEntry, { minLength: 1, maxLength: 20 }),
          async (events) => {
            const deduped = events.filter((e, i) => events.findIndex((x) => x.id === e.id) === i);
            vi.resetModules();
            const { chrome } = createChromeMock();
            vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

            const { importAll, exportAll } = await import("../extension/src/shared/storage");
            await importAll({ eventLog: deduped });
            const exported = await exportAll();

            expect(exported.eventLog.length).toBe(Math.min(deduped.length, 300));
            for (const e of exported.eventLog) {
              expect(deduped.some((orig) => orig.id === e.id)).toBe(true);
            }

            vi.unstubAllGlobals();
          },
        ),
        { numRuns: 20 },
      );
    });

    it("prompt outcomes survive round-trip within limit", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(arbPromptOutcomeEntry, { minLength: 1, maxLength: 20 }),
          async (outcomes) => {
            const deduped = outcomes.filter((o, i) => outcomes.findIndex((x) => x.id === o.id) === i);
            vi.resetModules();
            const { chrome } = createChromeMock();
            vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

            const { importAll, exportAll } = await import("../extension/src/shared/storage");
            await importAll({ promptOutcomes: deduped });
            const exported = await exportAll();

            expect(exported.promptOutcomes.length).toBe(Math.min(deduped.length, 500));
            for (const o of exported.promptOutcomes) {
              expect(deduped.some((orig) => orig.id === o.id)).toBe(true);
            }

            vi.unstubAllGlobals();
          },
        ),
        { numRuns: 20 },
      );
    });

    it("trusted domains survive round-trip as registrable domains", async () => {
      vi.resetModules();
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

      const { addTrustedDomain, exportAll } = await import("../extension/src/shared/storage");
      await addTrustedDomain("example.com");
      await addTrustedDomain("test.org");
      await addTrustedDomain("bank.co.uk");

      const exported = await exportAll();
      expect(exported.trustedDomains).toEqual(["bank.co.uk", "example.com", "test.org"]);

      vi.resetModules();
      const { chrome: chrome2 } = createChromeMock();
      vi.stubGlobal("chrome", chrome2 as unknown as typeof globalThis.chrome);

      const mod2 = await import("../extension/src/shared/storage");
      await mod2.importAll(exported);
      const restored = await mod2.getTrustedDomains();
      expect(restored).toEqual(["bank.co.uk", "example.com", "test.org"]);
    });

    it("full round-trip preserves all data categories", async () => {
      vi.resetModules();
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

      const { updateSuiteSettings, addTrustedDomain, appendEvent, appendPromptOutcome, exportAll } = await import("../extension/src/shared/storage");

      await updateSuiteSettings({ logLimit: 200, nav: { debug: true } });
      await addTrustedDomain("example.com");
      await appendEvent({ kind: "nav_click_block", site: "example.com" });
      await appendPromptOutcome({ domain: "example.com", type: "nav", score: 50, outcome: "allow" });

      const exported = await exportAll();
      expect(exported.settings.logLimit).toBe(200);
      expect(exported.settings.nav.debug).toBe(true);
      expect(exported.trustedDomains).toContain("example.com");
      expect(exported.eventLog.length).toBe(1);
      expect(exported.promptOutcomes.length).toBe(1);

      vi.resetModules();
      const { chrome: chrome2 } = createChromeMock();
      vi.stubGlobal("chrome", chrome2 as unknown as typeof globalThis.chrome);

      const mod2 = await import("../extension/src/shared/storage");
      await mod2.importAll(exported);

      const settings2 = await mod2.getSuiteSettings();
      expect(settings2.logLimit).toBe(200);
      expect(settings2.nav.debug).toBe(true);
      const domains2 = await mod2.getTrustedDomains();
      expect(domains2).toContain("example.com");
      const events2 = await mod2.getEventLog();
      expect(events2.length).toBe(1);
      const outcomes2 = await mod2.getPromptOutcomes();
      expect(outcomes2.length).toBe(1);
    });
  });

  describe("event log limit enforcement", () => {
    it("appendEvent never exceeds configured logLimit", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 50, max: 80 }),
          fc.integer({ min: 1, max: 20 }),
          async (limit, appendCount) => {
            vi.resetModules();
            const { chrome, store } = createChromeMock({
              "sentinelsuite:settings_v1": { logLimit: limit },
            });
            vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

            const { appendEvent } = await import("../extension/src/shared/storage");
            for (let i = 0; i < appendCount + limit; i++) {
              await appendEvent({ id: `e-${i}`, kind: "nav_click_block", ts: i });
            }

            const log = store["sentinelsuite:event_log_v1"] as Array<{ id: string }>;
            expect(log.length).toBeLessThanOrEqual(limit);

            vi.unstubAllGlobals();
          },
        ),
        { numRuns: 10 },
      );
    });

    it("appendEvent preserves FIFO ordering", async () => {
      vi.resetModules();
      const { chrome, store } = createChromeMock({
        "sentinelsuite:settings_v1": { logLimit: 50 },
      });
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

      const { appendEvent } = await import("../extension/src/shared/storage");
      for (let i = 0; i < 60; i++) {
        await appendEvent({ id: `e-${i}`, kind: "nav_click_block", ts: i });
      }

      const log = store["sentinelsuite:event_log_v1"] as Array<{ id: string; ts: number }>;
      expect(log).toHaveLength(50);
      expect(log[0]!.id).toBe("e-10");
      expect(log[49]!.id).toBe("e-59");

      for (let i = 1; i < log.length; i++) {
        expect(log[i]!.ts).toBeGreaterThan(log[i - 1]!.ts);
      }
    });
  });

  describe("addTrustedDomainWithResult", () => {
    it("returns added=true on first add, added=false on duplicate", async () => {
      vi.resetModules();
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

      const { addTrustedDomainWithResult } = await import("../extension/src/shared/storage");
      const first = await addTrustedDomainWithResult("example.com");
      expect(first).not.toBeNull();
      expect(first!.added).toBe(true);
      expect(first!.normalized).toBe("example.com");

      const second = await addTrustedDomainWithResult("example.com");
      expect(second).not.toBeNull();
      expect(second!.added).toBe(false);
    });

    it("returns null for invalid domains", async () => {
      vi.resetModules();
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

      const { addTrustedDomainWithResult } = await import("../extension/src/shared/storage");
      expect(await addTrustedDomainWithResult("")).toBeNull();
      expect(await addTrustedDomainWithResult("   ")).toBeNull();
      expect(await addTrustedDomainWithResult("not a valid host/at/all")).toBeNull();
    });

    it("normalizes subdomains to registrable domain", async () => {
      vi.resetModules();
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

      const { addTrustedDomainWithResult } = await import("../extension/src/shared/storage");
      const result = await addTrustedDomainWithResult("https://login.sub.example.com/path");
      expect(result).not.toBeNull();
      expect(result!.normalized).toBe("example.com");
    });
  });

  describe("onSuiteSettingsChange", () => {
    it("fires callback with merged settings when storage changes", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

      const { onSuiteSettingsChange, updateSuiteSettings } = await import("../extension/src/shared/storage");
      const received: SuiteSettings[] = [];
      onSuiteSettingsChange((s) => received.push(s));

      await updateSuiteSettings({ logLimit: 500, nav: { debug: true } });

      expect(received.length).toBeGreaterThanOrEqual(1);
      const last = received[received.length - 1]!;
      expect(last.logLimit).toBe(500);
      expect(last.nav.debug).toBe(true);
      expect(last.credential.mode).toBe("smart");
    });

    it("ignores changes to non-settings keys", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

      const { onSuiteSettingsChange, addTrustedDomain } = await import("../extension/src/shared/storage");
      const received: SuiteSettings[] = [];
      onSuiteSettingsChange((s) => received.push(s));

      await addTrustedDomain("example.com");
      expect(received).toHaveLength(0);
    });
  });
});
