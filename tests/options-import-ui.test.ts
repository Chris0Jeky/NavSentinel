// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SuiteSettings, SuiteSettingsPatch } from "../extension/src/shared/storage";
const state = vi.hoisted(() => ({
  get: vi.fn(), update: vi.fn(), import: vi.fn(), refreshProfiles: vi.fn(),
  changed: (_settings: SuiteSettings): void => {},
}));
vi.mock("../extension/src/shared/storage", async (original) => ({
  ...await original<typeof import("../extension/src/shared/storage")>(),
  getSuiteSettings: state.get, updateSuiteSettings: state.update, importAll: state.import,
  onSuiteSettingsChange: (fn: typeof state.changed) => { state.changed = fn; },
  getEventLog: async () => [], getPromptOutcomes: async () => [], getTrustedDomains: async () => [],
  appendEvent: async () => {},
}));
vi.mock("../extension/src/shared/allowlist", async original => ({ ...await original<typeof import("../extension/src/shared/allowlist")>(), getAllowlist: async () => ({}) }));
vi.mock("../extension/src/shared/domain_profile", async original => ({ ...await original<typeof import("../extension/src/shared/domain_profile")>(), getTopSuspiciousDomains: state.refreshProfiles }));
import { rebaseOptionsSettingsDraft } from "../extension/src/shared/storage";
const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const shell = () => document.querySelector<HTMLElement>(".shell")!;
let persisted: SuiteSettings;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function flush(): Promise<void> { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function chooseFile(text: () => Promise<string>): void {
  Object.defineProperty(el("importFile"), "files", { configurable: true, value: [{ text }] });
  el("importFile").dispatchEvent(new Event("change", { bubbles: true }));
}
function editLimit(value: string): void {
  el<HTMLInputElement>("logLimit").value = value;
  el("logLimit").dispatchEvent(new Event("input", { bubbles: true }));
}
describe("wired Options import / autosave boundary (#690)", () => {
  beforeEach(async () => {
    vi.resetModules(); vi.useFakeTimers();
    document.documentElement.innerHTML = readFileSync("extension/src/options/options.html", "utf8");
    vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "test" }) } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    persisted = { autoSave: true, nav: { defaultMode: "smart", debug: false, autoDismissOverlays: false }, credential: { mode: "smart", promptOnUntrustedDomain: true, promptOnMediumRisk: false, mediumRiskThreshold: 40, blockHttpPasswordSubmit: true, warnOnPaste: true, similarity: { enabled: true, maxDistance: 2 } }, logLimit: 300 };
    state.get.mockReset().mockImplementation(async () => structuredClone(persisted));
    state.import.mockReset().mockImplementation(async () => {});
    state.refreshProfiles.mockReset().mockResolvedValue([]);
    state.update.mockReset().mockImplementation(async (patch: SuiteSettingsPatch) => {
      const next = structuredClone(persisted);
      // Tests only write top-level fields; all production patch/rebase code is real.
      Object.assign(next, patch); persisted = next; state.changed(next); return next;
    });
    await import("../extension/src/options/options"); await flush();
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("failed JSON import re-arms the dirty autosave and preserves its baseline", async () => {
    editLimit("400"); chooseFile(async () => "{"); await flush();
    expect(el("status").textContent).toBe("Import failed.");
    expect(el<HTMLInputElement>("logLimit").value).toBe("400");
    expect(state.update).not.toHaveBeenCalled(); expect(shell().inert).toBeFalsy();
    await vi.advanceTimersByTimeAsync(250);
    expect(state.update).toHaveBeenCalledWith({ logLimit: 400 }, expect.objectContaining({ logLimit: 300 }));
  });
  it("locks immediately while an earlier auto-save preference write drains", async () => {
    const gate = deferred();
    state.update.mockImplementationOnce(async () => { await gate.promise; persisted.autoSave = false; return structuredClone(persisted); });
    el<HTMLInputElement>("autoSave").checked = false;
    el("autoSave").dispatchEvent(new Event("change", { bubbles: true })); await flush();
    chooseFile(async () => "{}"); await flush();
    expect(shell().inert).toBe(true); expect(state.import).not.toHaveBeenCalled();
    el("save").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    el("autoSave").dispatchEvent(new Event("change", { bubbles: true }));
    expect(state.update).toHaveBeenCalledOnce();
    gate.resolve(); await flush(); expect(state.import).toHaveBeenCalledOnce(); expect(shell().inert).toBeFalsy();
  });
  it("successful import replaces the pending draft, including incomplete numbers", async () => {
    editLimit("");
    state.import.mockImplementation(async () => { persisted.logLimit = 700; persisted.autoSave = false; state.changed(structuredClone(persisted)); });
    chooseFile(async () => "{}"); await flush(); await vi.advanceTimersByTimeAsync(300);
    expect(el<HTMLInputElement>("logLimit").value).toBe("700");
    expect(el<HTMLInputElement>("autoSave").checked).toBe(false); expect(state.update).not.toHaveBeenCalled();
  });
  it.each(["manual", "invalid", "conflict"])("failed import does not auto-save a %s draft", async kind => {
    if (kind === "manual") { persisted.autoSave = false; state.changed(structuredClone(persisted)); }
    editLimit(kind === "invalid" ? "" : "400");
    state.import.mockImplementation(async () => {
      if (kind === "conflict") { persisted.logLimit = 500; state.changed(structuredClone(persisted)); }
      throw Error("storage failed");
    });
    chooseFile(async () => "{}"); await flush(); await vi.advanceTimersByTimeAsync(300);
    expect(state.update).not.toHaveBeenCalled();
    expect(el<HTMLInputElement>("logLimit").value).toBe(kind === "invalid" ? "" : "400");
    if (kind === "conflict") expect(el("settingsConflict").hidden).toBe(false);
  });
  it("retains a settings notification arriving during the later panel refresh", async () => {
    const gate = deferred(); state.refreshProfiles.mockImplementationOnce(() => gate.promise.then(() => []));
    chooseFile(async () => "{}"); await flush();
    persisted.logLimit = 800; state.changed(structuredClone(persisted)); gate.resolve(); await flush();
    expect(el<HTMLInputElement>("logLimit").value).toBe("800"); expect(shell().inert).toBeFalsy();
  });
  it("drains a dispatched Save before importing without reapplying its stale response", async () => {
    const gate = deferred(); editLimit("400");
    state.update.mockImplementationOnce(async () => { await gate.promise; persisted.logLimit = 400; return structuredClone(persisted); });
    el("save").click(); await flush();
    state.import.mockImplementation(async () => { persisted.logLimit = 700; });
    chooseFile(async () => "{}"); await flush(); expect(state.import).not.toHaveBeenCalled();
    gate.resolve(); await flush(); await vi.advanceTimersByTimeAsync(300);
    expect(state.import).toHaveBeenCalledOnce(); expect(el<HTMLInputElement>("logLimit").value).toBe("700");
    expect(state.update).toHaveBeenCalledOnce();
  });
  it("known partial delivery keeps committed import settings authoritative", async () => {
    const { PromptOutcomeDeliveryError } = await import("../extension/src/shared/storage");
    editLimit("400");
    state.import.mockImplementation(async () => { persisted.logLimit = 700; throw new PromptOutcomeDeliveryError("prompt delivery failed"); });
    chooseFile(async () => "{}"); await flush();
    expect(el<HTMLInputElement>("logLimit").value).toBe("700");
    expect(el("status").textContent).toContain("Imported, but");
    await vi.advanceTimersByTimeAsync(300); expect(state.update).not.toHaveBeenCalled();
  });
  it("retains real narrow-field rebasing instead of replacing unrelated fields", () => {
    const draft = structuredClone(persisted); draft.logLimit = 400;
    const incoming = structuredClone(persisted); incoming.nav.debug = true;
    expect(rebaseOptionsSettingsDraft(persisted, draft, incoming)).toMatchObject({ logLimit: 400, nav: { debug: true } });
  });
});
