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

  async function update(entries: EventLogEntry[]): Promise<void> {
    await chrome.storage.local.set({ [EVENT_KEY]: entries });
    await vi.waitFor(() => expect((document.getElementById("refresh") as HTMLButtonElement).disabled).toBe(false));
  }

  function journalRow(site: string): HTMLDetailsElement {
    const match = Array.from(document.querySelectorAll<HTMLDetailsElement>("details.event"))
      .find(node => node.querySelector(".event-route")?.textContent?.includes(site));
    expect(match, `journal row for ${site}`).toBeDefined();
    return match!;
  }

  const history = (count: number) => Array.from({ length: count }, (_, i) => row(`private-entry-${i}`, {
    ts: now - (100 - i) * 1000, site: `record-${i}.test`,
  }));

  it.each(["append", "prepend"])("keeps the same expanded row and focused recovery control on %s", async direction => {
    const reading = row("private-reading", {
      kind: "mutation_alert", reasons: ["overlay_cleanup_undo"], extra: { restored: false },
    });
    await open([reading]);
    const details = journalRow("fictional.test");
    details.open = true;
    const recovery = details.querySelector("a")!;
    recovery.focus();
    const newer = row("private-new", { site: "new.test", ts: now - 500 });
    await update(direction === "append" ? [reading, newer] : [newer, reading]);
    expect(journalRow("fictional.test")).toBe(details);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(recovery);
    expect(text("total")).toBe("2");
    expect((document.getElementById("showLatest") as HTMLButtonElement)?.hidden).toBe(false);
  });

  it("keeps the reviewed page across new arrivals while exporting the current minimized match set", async () => {
    const entries = history(25);
    await open(entries);
    const oldest = journalRow("record-0.test");
    oldest.open = true;
    oldest.querySelector("summary")!.focus();
    const arrivals = history(55).slice(25);
    await update([...entries, ...arrivals]);
    expect(journalRow("record-0.test")).toBe(oldest);
    expect(oldest.open).toBe(true);
    expect(document.activeElement).toBe(oldest.querySelector("summary"));
    expect(document.querySelectorAll("details.event")).toHaveLength(25);
    expect(text("total")).toBe("55");
    click("export");
    const exported = JSON.parse((document.getElementById("exportPreview") as HTMLTextAreaElement).value);
    expect(exported.events).toHaveLength(55);
    expect(exported.events[0].id).toBe("event-1");
    expect(JSON.stringify(exported)).not.toContain("private-entry");
    expect(Object.keys(exported.events[0]).sort()).toEqual(["destinationSite", "id", "kind", "outcome", "reasons", "sourceSite", "timestamp"]);
    click("cancelExport");
    click("showLatest");
    expect(oldest.isConnected).toBe(false);
    expect(text("events")).toContain("record-54.test");
    expect(document.activeElement?.id).toBe("journal");
  });

  it("does not transfer reading state to a replacement with the same stored ID and minimized text", async () => {
    const original = row("reused", { url: "https://fictional.test/original?private=one" });
    await open([original]);
    const old = journalRow("fictional.test");
    old.open = true;
    old.querySelector("summary")!.focus();
    await update([original, { ...original, url: "https://fictional.test/replaced?private=two" }]);
    expect(old.isConnected).toBe(false);
    expect(journalRow("fictional.test").open).toBe(false);
    expect(document.activeElement?.id).toBe("journal");
    expect(text("status")).toContain("no longer");
    expect(text("total")).toBe("1");
  });

  it("removes an evicted reviewed record and sends its focus to the journal", async () => {
    const entries = history(25);
    await open(entries);
    const evicted = journalRow("record-0.test");
    evicted.open = true;
    evicted.querySelector("summary")!.focus();
    await update([...entries.slice(1), ...history(26).slice(25)]);
    expect(evicted.isConnected).toBe(false);
    expect(text("events")).not.toContain("record-0.test");
    expect(document.activeElement?.id).toBe("journal");
    expect(text("status")).toContain("no longer");
  });

  it("clears an expanded record immediately and never restores its old reading state on import", async () => {
    const entries = [row("restore")];
    await open(entries);
    const old = journalRow("fictional.test");
    old.open = true;
    old.querySelector("summary")!.focus();
    const { clearBehaviouralDataDirect } = await import("../extension/src/shared/behavioural_reset");
    expect((await clearBehaviouralDataDirect()).ok).toBe(true);
    await vi.waitFor(() => expect(text("total")).toBe("0"));
    expect(old.isConnected).toBe(false);
    expect(text("events")).not.toContain("fictional.test");
    expect(document.activeElement?.id).toBe("journal");
    expect(text("status")).toContain("no longer");
    await update(entries);
    expect(journalRow("fictional.test").open).toBe(false);
    expect(journalRow("fictional.test")).not.toBe(old);
  });

  it("forgets a cleared record even when an older read is pending and the same record is immediately imported", async () => {
    const entries = [row("same-again")];
    await open(entries);
    const old = journalRow("fictional.test");
    old.open = true;
    old.querySelector("summary")!.focus();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(chrome.storage.local, "get").mockImplementationOnce(async () => {
      await held;
      return { [EVENT_KEY]: entries };
    });
    click("refresh");
    await chrome.storage.local.set({ [EVENT_KEY]: [] });
    const removedBeforeReadFinished = !old.isConnected;
    await chrome.storage.local.set({ [EVENT_KEY]: entries });
    release();
    await vi.waitFor(() => expect((document.getElementById("refresh") as HTMLButtonElement).disabled).toBe(false));
    expect(removedBeforeReadFinished).toBe(true);
    expect(old.isConnected).toBe(false);
    expect(journalRow("fictional.test").open).toBe(false);
    expect(document.activeElement?.id).toBe("journal");
  });

  it("lets explicit filters and page navigation leave the held reading window", async () => {
    const entries = history(30);
    await open(entries);
    const reading = journalRow("record-5.test");
    reading.open = true;
    reading.querySelector("summary")!.focus();
    await update([...entries, ...history(31).slice(30)]);
    const search = document.getElementById("search") as HTMLInputElement;
    search.focus();
    search.value = "record-1.test";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelectorAll("details.event")).toHaveLength(1);
    expect(text("events")).toContain("record-1.test");
    expect(reading.isConnected).toBe(false);
    expect(document.activeElement).toBe(search);
    expect((document.getElementById("showLatest") as HTMLButtonElement)?.hidden).toBe(true);
    click("resetFilters");
    click("next");
    expect(text("pageLabel")).toContain("Page 2");
    expect(journalRow("record-5.test").open).toBe(false);
    expect(document.querySelectorAll("details.event")).toHaveLength(6);
  });

  it("updates a retained row's clock explanation without collapsing it", async () => {
    await open([row("future", { ts: now + 5000 })]);
    const reading = journalRow("fictional.test");
    reading.open = true;
    reading.querySelector("summary")!.focus();
    vi.setSystemTime(now + 10000);
    click("refresh");
    await vi.waitFor(() => expect(text("clicksCount")).toBe("1"));
    expect(journalRow("fictional.test")).toBe(reading);
    expect(reading.open).toBe(true);
    const visibleText = Array.from(reading.querySelectorAll<HTMLElement>("p")).filter(node => !node.hidden).map(node => node.textContent).join(" ");
    expect(visibleText).not.toContain("ahead of this device");
  });

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
