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

const SETTINGS_KEY = "sentinelsuite:settings_v1";
const ALLOWLIST_KEY = "sentinelsuite:nav_allowlist_v1";
const TRUSTED_DOMAINS_KEY = "sentinelsuite:trusted_domains_v1";
const EVENT_LOG_KEY = "sentinelsuite:event_log_v1";
const ADAPTIVE_SCORES_KEY = "sentinelsuite:adaptive_scores_v1";

const DIVERGENT_SETTINGS = {
  autoSave: false,
  nav: { defaultMode: "off", debug: true, autoDismissOverlays: true },
  credential: {
    mode: "strict",
    promptOnUntrustedDomain: false,
    promptOnMediumRisk: false,
    mediumRiskThreshold: 10,
    blockHttpPasswordSubmit: false,
    warnOnPaste: false,
    similarity: { enabled: false, maxDistance: 5 },
  },
  logLimit: 120,
};

const DEFAULT_NAV = { defaultMode: "smart", debug: false, autoDismissOverlays: false };

const DEFAULT_CREDENTIAL = {
  mode: "smart",
  promptOnUntrustedDomain: true,
  promptOnMediumRisk: true,
  mediumRiskThreshold: 40,
  blockHttpPasswordSubmit: true,
  warnOnPaste: true,
  similarity: { enabled: true, maxDistance: 2 },
};

describe("suite settings per-section reset (#563 slice A)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("nav reset restores nav leaves to defaults and preserves credential leaves, logLimit, autoSave", async () => {
    const { chrome } = createChromeMock({
      [SETTINGS_KEY]: structuredClone(DIVERGENT_SETTINGS),
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { getSuiteSettings, resetSuiteSettingsSection } = await import("../extension/src/shared/storage");
    const response = await resetSuiteSettingsSection("nav");

    expect(response.conflict).toBeUndefined();
    expect(response.nav).toEqual(DEFAULT_NAV);
    const settings = await getSuiteSettings();
    expect(settings.nav).toEqual(DEFAULT_NAV);
    expect(settings.credential).toEqual(DIVERGENT_SETTINGS.credential);
    expect(settings.logLimit).toBe(120);
    expect(settings.autoSave).toBe(false);
  });

  it("credential reset restores credential leaves and preserves nav leaves", async () => {
    const { chrome } = createChromeMock({
      [SETTINGS_KEY]: structuredClone(DIVERGENT_SETTINGS),
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { getSuiteSettings, resetSuiteSettingsSection } = await import("../extension/src/shared/storage");
    const response = await resetSuiteSettingsSection("credential");

    expect(response.conflict).toBeUndefined();
    expect(response.credential).toEqual(DEFAULT_CREDENTIAL);
    const settings = await getSuiteSettings();
    expect(settings.credential).toEqual(DEFAULT_CREDENTIAL);
    expect(settings.nav).toEqual(DIVERGENT_SETTINGS.nav);
    expect(settings.logLimit).toBe(120);
    expect(settings.autoSave).toBe(false);
  });

  it("double reset is a stable no-op", async () => {
    const { chrome } = createChromeMock({
      [SETTINGS_KEY]: structuredClone(DIVERGENT_SETTINGS),
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { getSuiteSettings, resetSuiteSettingsSection } = await import("../extension/src/shared/storage");
    const first = await resetSuiteSettingsSection("nav");
    const second = await resetSuiteSettingsSection("nav");

    expect(second.conflict).toBeUndefined();
    expect(second).toEqual(first);
    expect((await getSuiteSettings()).nav).toEqual(DEFAULT_NAV);
  });

  it("leaves allowlist, trusted domains, event log and adaptive scores byte-identical", async () => {
    const { chrome, store } = createChromeMock({
      [SETTINGS_KEY]: structuredClone(DIVERGENT_SETTINGS),
      [ALLOWLIST_KEY]: { "example.com": ["login.example.com"] },
      [TRUSTED_DOMAINS_KEY]: ["example.com"],
      [EVENT_LOG_KEY]: [
        { id: "evt-1", ts: 100, kind: "suite_config_update", site: "example.com" },
      ],
      [ADAPTIVE_SCORES_KEY]: {
        "example.com": { domain: "example.com", adjustment: 5, allowCount: 3, blockCount: 0, lastUpdated: 123 },
      },
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const storage = await import("../extension/src/shared/storage");
    const { getAllowlist } = await import("../extension/src/shared/allowlist");
    const { getAdaptiveScores } = await import("../extension/src/shared/adaptive_scoring");

    const snapshot = async () =>
      JSON.stringify({
        allowlist: await getAllowlist(),
        trustedDomains: await storage.getTrustedDomains(),
        eventLog: await storage.getEventLog(),
        adaptiveScores: await getAdaptiveScores(),
        rawAllowlist: store[ALLOWLIST_KEY],
        rawTrustedDomains: store[TRUSTED_DOMAINS_KEY],
        rawEventLog: store[EVENT_LOG_KEY],
        rawAdaptiveScores: store[ADAPTIVE_SCORES_KEY],
      });

    const before = await snapshot();
    await storage.resetSuiteSettingsSection("nav");
    await storage.resetSuiteSettingsSection("credential");
    const after = await snapshot();

    expect(after).toBe(before);
    expect((await storage.getSuiteSettings()).nav).toEqual(DEFAULT_NAV);
    expect((await storage.getSuiteSettings()).credential).toEqual(DEFAULT_CREDENTIAL);
  });

  // No expected-mismatch conflict case: the suite-settings write lane
  // (updateSuiteSettingsDirect) is module-private and resetSuiteSettingsSection
  // takes no `expected` argument, so no conflict path is reachable from it.
});
