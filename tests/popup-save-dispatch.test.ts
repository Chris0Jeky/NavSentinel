// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type {
  EventLogEntry,
  SuiteSettings,
  SuiteSettingsPatch,
} from "../extension/src/shared/storage";
import { getSegValue } from "../extension/src/shared/seg_control";

/**
 * Behavioral dispatch suite for the real popup module (#wave2-slice2-B4).
 * popup.ts was never imported (only popup_model was); the save-rejection and
 * resync-failure paths were covered by source-structure suites only. This suite
 * imports the real module against the real popup.html with mocked storage and
 * chrome, clicks the real controls, and asserts the real UI resync behavior:
 * a rejected save warns and resyncs from persisted truth, and a failing resync
 * is contained (warned, no unhandled rejection, no crash).
 */

const state = vi.hoisted(() => ({
  persisted: null as unknown as SuiteSettings,
  updateCalls: [] as SuiteSettingsPatch[],
  updateBehavior: "ok" as "ok" | "reject",
  getBehavior: "ok" as "ok" | "reject",
  tabUrl: "https://example.com/page",
  trusted: [] as string[],
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
    getSuiteSettings: async (): Promise<SuiteSettings> => {
      if (state.getBehavior === "reject") throw new Error("storage offline");
      return structuredClone(state.persisted);
    },
    updateSuiteSettings: async (patch: SuiteSettingsPatch): Promise<SuiteSettings> => {
      state.updateCalls.push(patch);
      if (state.updateBehavior === "reject") throw new Error("worker unreachable");
      const next = structuredClone(state.persisted);
      if (patch.nav) Object.assign(next.nav, patch.nav);
      if (patch.credential) Object.assign(next.credential, patch.credential);
      if (patch.logLimit !== undefined) next.logLimit = patch.logLimit;
      if (patch.autoSave !== undefined) next.autoSave = patch.autoSave;
      state.persisted = next;
      return structuredClone(next);
    },
    onSuiteSettingsChange: () => {},
    getTrustedDomains: async (): Promise<string[]> => [...state.trusted],
    addTrustedDomain: async (domain: string): Promise<void> => {
      state.trusted.push(domain);
    },
    removeTrustedDomain: async (domain: string): Promise<void> => {
      state.trusted = state.trusted.filter((d) => d !== domain);
    },
    getEventLog: async (): Promise<EventLogEntry[]> => [...state.log],
    appendEvent: async (): Promise<void> => {},
  };
});

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const segButton = (segId: string, value: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`#${segId} .seg-btn[data-value="${value}"]`)!;

async function flush(rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

describe("popup save dispatch (real module)", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    document.documentElement.innerHTML = readFileSync("extension/src/popup/popup.html", "utf8");
    state.persisted = freshSettings();
    state.updateCalls = [];
    state.updateBehavior = "ok";
    state.getBehavior = "ok";
    state.tabUrl = "https://example.com/page";
    state.trusted = [];
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

  it("persists a nav-mode click on the happy path (harness sanity)", async () => {
    segButton("navSeg", "strict").click();
    await flush();
    expect(state.updateCalls).toEqual([{ nav: { defaultMode: "strict" } }]);
    expect(state.persisted.nav.defaultMode).toBe("strict");
    expect(getSegValue(el("navSeg"))).toBe("strict");
    expect(warn).not.toHaveBeenCalled();
  });

  it("a rejected nav-mode save warns and resyncs the seg from persisted truth", async () => {
    state.updateBehavior = "reject";
    segButton("navSeg", "strict").click();
    await flush();
    expect(state.updateCalls).toEqual([{ nav: { defaultMode: "strict" } }]);
    expect(warn).toHaveBeenCalledWith("[NavSentinel] nav mode save failed:", expect.any(Error));
    // The optimistic "strict" is rolled back to the persisted "smart".
    expect(getSegValue(el("navSeg"))).toBe("smart");
    expect(state.persisted.nav.defaultMode).toBe("smart");
  });

  it("a rejected cred-mode save warns and resyncs the seg from persisted truth", async () => {
    state.updateBehavior = "reject";
    segButton("credSeg", "off").click();
    await flush();
    expect(state.updateCalls).toEqual([{ credential: { mode: "off" } }]);
    expect(warn).toHaveBeenCalledWith("[NavSentinel] cred mode save failed:", expect.any(Error));
    expect(getSegValue(el("credSeg"))).toBe("smart");
    expect(state.persisted.credential.mode).toBe("smart");
  });

  it("a rejected auto-dismiss save warns and resyncs the checkbox", async () => {
    state.updateBehavior = "reject";
    el<HTMLInputElement>("autoDismiss").checked = true;
    el("autoDismiss").dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(state.updateCalls).toEqual([{ nav: { autoDismissOverlays: true } }]);
    expect(warn).toHaveBeenCalledWith("[NavSentinel] auto-dismiss save failed:", expect.any(Error));
    expect(el<HTMLInputElement>("autoDismiss").checked).toBe(false);
    expect(state.persisted.nav.autoDismissOverlays).toBe(false);
  });

  it("a failing resync is contained: warned, no unhandled rejection, UI stays up", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      state.updateBehavior = "reject";
      state.getBehavior = "reject";
      segButton("navSeg", "strict").click();
      await flush();
      // Let any unhandled rejection surface.
      await new Promise((resolve) => setTimeout(resolve, 25));
      // One warn for the save, one for the failed resync — the recovery path
      // consumes its own refresh rejection instead of leaking it.
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenNthCalledWith(
        1,
        "[NavSentinel] nav mode save failed:",
        expect.any(Error),
      );
      expect(unhandled).toEqual([]);
      // The popup is still interactive: a later successful save applies. (The
      // aborted resync left the optimistic "strict" selected, so recovery
      // clicks a different value — clicking "strict" would be a no-op.)
      state.updateBehavior = "ok";
      state.getBehavior = "ok";
      segButton("navSeg", "off").click();
      await flush();
      expect(state.persisted.nav.defaultMode).toBe("off");
      expect(getSegValue(el("navSeg"))).toBe("off");
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });
});
