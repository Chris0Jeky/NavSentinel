// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventLogEntry } from "../extension/src/shared/storage";

const EVENT_KEY = "sentinelsuite:event_log_v1";
const now = new Date(2026, 9, 29, 12).getTime();
const row = (id: string, patch: Partial<EventLogEntry> = {}): EventLogEntry => ({
  id, ts: now - 1000, kind: "nav_click_block", site: "fictional.test", ...patch,
});
const text = (id: string) => document.getElementById(id)?.textContent;
const click = (id: string) => document.getElementById(id)?.click();
let store: Record<string, unknown>;

describe("Protection Center from the existing local records", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.setSystemTime(now);
    localStorage.clear();
    document.documentElement.innerHTML = readFileSync("extension/src/evidence/evidence.html", "utf8");
    store = {};
    const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void> = [];
    const area = (values: Record<string, unknown>, name: string) => ({
      get: async (keys?: string | string[]) => keys === undefined ? { ...values }
        : Object.fromEntries((typeof keys === "string" ? [keys] : keys).map(key => [key, values[key]])),
      set: async (writes: Record<string, unknown>) => {
        const changes = Object.fromEntries(Object.entries(writes).map(([key, value]) => [key, { oldValue: values[key], newValue: value }]));
        Object.assign(values, writes);
        listeners.forEach(listener => listener(changes, name));
      },
      remove: async (keys: string | string[]) => { for (const key of typeof keys === "string" ? [keys] : keys) delete values[key]; },
    });
    vi.stubGlobal("chrome", { storage: {
      local: area(store, "local"), session: area({}, "session"),
      onChanged: { addListener: (listener: typeof listeners[number]) => listeners.push(listener) },
    } });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function open(entries: EventLogEntry[]): Promise<void> {
    store[EVENT_KEY] = entries;
    await import("../extension/src/evidence/evidence");
    await vi.waitFor(() => expect(text("status")).toContain("Local snapshot refreshed"));
  }

  it("counts a duplicate overlay/click record once and drills into that category", async () => {
    await open([
      row("same", { kind: "nav_blank_prompt", extra: { overlayAutoDismissed: true } }),
      row("same", { extra: { overlayAutoDismissed: true } }),
      row("click"), row("popup", { kind: "nav_blank_prompt" }),
      row("warning", { kind: "cred_paste_warn" }),
    ]);
    expect(text("total")).toBe("4");
    expect(text("overlaysCount")).toBe("1");
    expect(text("clicksCount")).toBe("1");
    expect(text("redirectsCount")).toBe("1");
    expect(text("warningsCount")).toBe("1");
    click("overlaysFilter");
    expect(document.querySelectorAll("details.event")).toHaveLength(1);
    expect(text("events")).toContain("Overlay cleanup recorded");
    expect(document.activeElement?.id).toBe("journal");
  });

  it("restores counts through the existing backup import, keeps failed Undo honest, and clears without reloading", async () => {
    await open([]);
    const { importAll, exportAll } = await import("../extension/src/shared/storage");
    const entries = [
      row("overlay", { kind: "mutation_alert", reasons: ["overlay_detected"], extra: { overlayAutoDismissed: true, overlayCleanupOutcome: "suppressed" } }),
      row("undo", { kind: "mutation_alert", reasons: ["overlay_cleanup_undo"], extra: { overlayCleanupOutcome: "restored", restored: false } }),
    ];
    await importAll({ eventLog: entries });
    await vi.waitFor(() => expect(text("total")).toBe("2"));
    await vi.waitFor(() => expect(text("overlaysCount")).toBe("1"));
    expect(text("correctionsCount")).toBe("1");
    click("correctionsFilter");
    expect(text("events")).toContain("Restoration was not confirmed");
    expect(text("events")).not.toContain("You restored an overlay");
    expect(document.querySelector('#events a[href="../options/options.html"]')).not.toBeNull();
    const backup = await exportAll();
    expect(backup.eventLog).toEqual(entries);
    const { clearBehaviouralDataDirect } = await import("../extension/src/shared/behavioural_reset");
    expect((await clearBehaviouralDataDirect()).ok).toBe(true);
    await vi.waitFor(() => expect(text("total")).toBe("0"));
    expect(text("milestone")).toBe("No retained activity yet");
    expect(text("overlaysCount")).toBe("0");
    expect(text("correctionsCount")).toBe("0");
    await importAll(backup);
    await vi.waitFor(() => expect(text("correctionsCount")).toBe("1"));
  });

  it("does not describe a failed Undo as a successful restoration", async () => {
    await open([row("undo", { kind: "mutation_alert", reasons: ["overlay_cleanup_undo"], extra: { restored: false } })]);
    expect(text("events")).not.toContain("You restored an overlay");
    expect(text("events")).toContain("Restoration was not confirmed");
  });

  it("removes the displayed history when the existing behavioural reset completes", async () => {
    await open([row("click")]);
    const { clearBehaviouralDataDirect } = await import("../extension/src/shared/behavioural_reset");
    expect((await clearBehaviouralDataDirect()).ok).toBe(true);
    await vi.waitFor(() => expect(text("total")).toBe("0"));
  });
});
