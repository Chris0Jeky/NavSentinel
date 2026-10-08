// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type {
  EventLogEntry,
  SuiteSettings,
  SuiteSettingsPatch,
} from "../extension/src/shared/storage";

/**
 * Stale popup trust UI on a failed trust save.
 *
 * `trustCurrentSite`/`untrustCurrentSite` awaited `addTrustedDomain` /
 * `removeTrustedDomain` bare: a quota/transient rejection skipped `refreshUi`
 * and escaped the click listener as an unhandled rejection, stranding the UI
 * away from persisted truth. Each handler must contain ONLY the storage write
 * in try/catch (console.warn, recordConfig/appendEvent pattern) and still run
 * `refreshUi` afterwards so the UI resyncs from persisted truth.
 *
 * Behavioral suite in the popup-save-dispatch style: the real popup module is
 * imported against the real popup.html with mocked storage/chrome, the trust
 * write is stubbed to reject, the real button is clicked, and the resync is
 * asserted. Fails against the pre-fix source (no warn, no resync read, and an
 * unhandled rejection).
 */

const state = vi.hoisted(() => ({
  persisted: null as unknown as SuiteSettings,
  tabUrl: "https://example.com/page",
  trusted: [] as string[],
  trustedReads: 0,
  trustBehavior: "ok" as "ok" | "reject",
  untrustBehavior: "ok" as "ok" | "reject",
  log: [] as EventLogEntry[],
  openOptionsPage: vi.fn(),
}));

function freshSettings(): SuiteSettings {
  return {
    autoSave: true,
    nav: { defaultMode: "smart", debug: false, autoDismissOverlays: false },
    credential: {
      mode: "smart",
      promptOnUntrustedDomain: true,
      promptOnMediumRisk: false,
      mediumRiskThreshold: 40,
      blockHttpPasswordSubmit: true,
      warnOnPaste: true,
      similarity: { enabled: true, maxDistance: 2 },
    },
    logLimit: 300,
  };
}

vi.mock("../extension/src/shared/storage", async (original) => {
  const mod = await original<typeof import("../extension/src/shared/storage")>();
  return {
    ...mod,
    getSuiteSettings: async (): Promise<SuiteSettings> => structuredClone(state.persisted),
    updateSuiteSettings: async (patch: SuiteSettingsPatch): Promise<SuiteSettings> => {
      const next = structuredClone(state.persisted);
      if (patch.nav) Object.assign(next.nav, patch.nav);
      if (patch.credential) Object.assign(next.credential, patch.credential);
      if (patch.logLimit !== undefined) next.logLimit = patch.logLimit;
      if (patch.autoSave !== undefined) next.autoSave = patch.autoSave;
      state.persisted = next;
      return structuredClone(next);
    },
    onSuiteSettingsChange: () => {},
    getTrustedDomains: async (): Promise<string[]> => {
      state.trustedReads += 1;
      return [...state.trusted];
    },
    addTrustedDomain: async (domain: string): Promise<void> => {
      if (state.trustBehavior === "reject") throw new Error("quota exceeded");
      state.trusted.push(domain);
    },
    removeTrustedDomain: async (domain: string): Promise<void> => {
      if (state.untrustBehavior === "reject") throw new Error("transient failure");
      state.trusted = state.trusted.filter((d) => d !== domain);
    },
    getEventLog: async (): Promise<EventLogEntry[]> => [...state.log],
    appendEvent: async (): Promise<void> => {},
  };
});

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

async function flush(rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

describe("popup trust saves resync from persisted truth on failure", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    document.documentElement.innerHTML = readFileSync("extension/src/popup/popup.html", "utf8");
    state.persisted = freshSettings();
    state.tabUrl = "https://example.com/page";
    state.trusted = [];
    state.trustedReads = 0;
    state.trustBehavior = "ok";
    state.untrustBehavior = "ok";
    state.log = [];
    state.openOptionsPage.mockReset();
    vi.stubGlobal("chrome", {
      tabs: { query: async () => [{ url: state.tabUrl }] },
      runtime: {
        getManifest: () => ({ version: "test" }),
        onMessage: { addListener: () => {} },
        openOptionsPage: state.openOptionsPage,
        sendMessage: async () => ({ ok: true, operation: "list", status: "missing", decisions: [] }),
        getURL: (path: string) => `chrome-extension://test/${path}`,
        id: "test-id",
      },
    });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("../extension/src/popup/popup");
    await flush();
    warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a rejected addTrustedDomain still refreshes UI state and leaves no unhandled rejection", async () => {
    expect(el("trustStatus").textContent?.trim()).toBe("observing");
    const baselineReads = state.trustedReads;
    expect(baselineReads).toBeGreaterThan(0);

    state.trustBehavior = "reject";
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      el("trustBtn").click();
      await flush();
      // Let any unhandled rejection surface.
      await new Promise((resolve) => setTimeout(resolve, 25));

      // Persisted truth is unchanged and the UI resyncs to it (still
      // observing, Trust still offered) instead of stranding.
      expect(state.trusted).toEqual([]);
      expect(el("trustStatus").textContent?.trim()).toBe("observing");
      expect(el<HTMLButtonElement>("trustBtn").hidden).toBe(false);
      // The failed write warns (recordConfig/appendEvent pattern) …
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[NavSentinel]"), expect.any(Error));
      // … and refreshUi still ran (fresh persisted read after the failure).
      expect(state.trustedReads).toBeGreaterThan(baselineReads);
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });

  it("a rejected removeTrustedDomain still refreshes UI state and leaves no unhandled rejection", async () => {
    state.trusted = ["example.com"];
    el("refreshBtn").click();
    await flush();
    expect(el("trustStatus").textContent?.trim()).toBe("trusted");
    warn.mockClear();
    const baselineReads = state.trustedReads;

    state.untrustBehavior = "reject";
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      el("untrustBtn").click();
      await flush();
      // Let any unhandled rejection surface.
      await new Promise((resolve) => setTimeout(resolve, 25));

      // Persisted truth is unchanged and the UI resyncs to it (still
      // trusted, Untrust still offered) instead of stranding.
      expect(state.trusted).toEqual(["example.com"]);
      expect(el("trustStatus").textContent?.trim()).toBe("trusted");
      expect(el<HTMLButtonElement>("untrustBtn").hidden).toBe(false);
      // The failed write warns (recordConfig/appendEvent pattern) …
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[NavSentinel]"), expect.any(Error));
      // … and refreshUi still ran (fresh persisted read after the failure).
      expect(state.trustedReads).toBeGreaterThan(baselineReads);
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });
});
