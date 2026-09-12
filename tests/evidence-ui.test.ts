// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const mocks = vi.hoisted(() => ({ getEventLog: vi.fn(), getSuiteSettings: vi.fn() }));
vi.mock("../extension/src/shared/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("../extension/src/shared/storage")>(),
  ...mocks,
}));
const html = readFileSync(resolve("extension/src/evidence/evidence.html"), "utf8");
const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = (id: string, value: string): void => { get<HTMLInputElement>(id).value = value; get(id).dispatchEvent(new Event("input")); };

describe("Protection Center wired UI", () => {
  beforeEach(async () => {
    vi.resetModules();
    document.documentElement.innerHTML = html;
    localStorage.clear();
    mocks.getEventLog.mockReset().mockResolvedValue(Array.from({ length: 28 }, (_, i) => ({ id: `private-${i}`, ts: 1700000000000 + i, kind: i === 0 ? "cred_submit_prompt" : "nav_click_block", site: "source.test", destHost: i === 0 ? "credential.test" : "target.test", reasons: ["no_accessible_name"], score: i })));
    mocks.getSuiteSettings.mockReset().mockResolvedValue({ nav: { defaultMode: "off", autoDismissOverlays: false }, credential: { mode: "strict" } });
    await import("../extension/src/evidence/evidence");
    await vi.waitFor(() => expect(get("total").textContent).toBe("28"));
  });
  afterEach(() => { vi.restoreAllMocks(); });
  it("renders real counts, truthful saved modes, readable details and bounded pages", () => {
    expect(get("modes").textContent).toContain("Navigation: off");
    expect(document.querySelectorAll("details.event")).toHaveLength(25);
    expect(get("events").textContent).toContain("This clickable area has no visible label");
    get("next").click();
    expect(document.querySelectorAll("details.event")).toHaveLength(3);
    expect(get("pageLabel").textContent).toBe("Page 2 of 2");
    expect(get<HTMLButtonElement>("next").disabled).toBe(true);
  });
  it("combines filters and resets page/filters via visible controls", () => {
    get("next").click();
    input("search", "credential.test");
    input("category", "credential");
    expect(document.querySelectorAll("details.event")).toHaveLength(1);
    expect(get("events").textContent).toContain("credential submit prompt");
    expect(get("pageLabel").textContent).toBe("Page 1 of 1");
    input("search", "unknown.test");
    expect(get("events").textContent).toContain("No events match");
    expect(get<HTMLButtonElement>("export").disabled).toBe(true);
    get("resetFilters").click();
    expect(document.querySelectorAll("details.event")).toHaveLength(25);
  });
  it("previews all filtered rows and downloads the exact reviewed snapshot", async () => {
    let blob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation(value => { blob = value as Blob; return "blob:test"; });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    get("export").click();
    const reviewed = get<HTMLTextAreaElement>("exportPreview").value;
    expect(JSON.parse(reviewed).events).toHaveLength(28);
    expect(reviewed).not.toContain("private-");
    expect(get<HTMLDialogElement>("exportDialog").open).toBe(true);
    expect(blob).toBeUndefined();
    // A later refresh must not silently change what the user already reviewed.
    mocks.getEventLog.mockResolvedValue([]);
    get("refresh").click();
    await vi.waitFor(() => expect(get("total").textContent).toBe("0"));
    get("downloadExport").click();
    expect(blob?.type).toBe("application/json");
    expect(await blob!.text()).toBe(reviewed);
    expect(get("status").textContent).toContain("28 reviewed, minimized events");
    expect(get<HTMLDialogElement>("exportDialog").open).toBe(false);
  });
  it("cancel clears the preview without preparing a download", async () => {
    const createUrl = vi.spyOn(URL, "createObjectURL");
    get("export").click();
    get("cancelExport").click();
    await vi.waitFor(() => expect(get<HTMLTextAreaElement>("exportPreview").value).toBe(""));
    get("downloadExport").click();
    expect(createUrl).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(get("export"));
  });
  it("accepts the exact byte boundary in the wired preview and download", async () => {
    const limit = 8 * 1024 * 1024;
    get("export").click();
    const text = get<HTMLTextAreaElement>("exportPreview").value.padEnd(limit, " ");
    get("cancelExport").click();
    await vi.waitFor(() => expect(get<HTMLTextAreaElement>("exportPreview").value).toBe(""));
    vi.spyOn(JSON, "stringify").mockReturnValueOnce(text);
    let blob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation(value => { blob = value as Blob; return "blob:test"; });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    get("export").click();
    expect(get<HTMLDialogElement>("exportDialog").open).toBe(true);
    expect(get<HTMLTextAreaElement>("exportPreview").value).toBe(text);
    get("downloadExport").click();
    expect(blob?.size).toBe(limit);
    expect(await blob!.text()).toBe(text);
  });
  it("refuses one byte over the limit and invalidates an older prepared snapshot", () => {
    const createUrl = vi.spyOn(URL, "createObjectURL");
    get("export").click();
    const text = get<HTMLTextAreaElement>("exportPreview").value.padEnd(8 * 1024 * 1024 + 1, " ");
    vi.spyOn(JSON, "stringify").mockReturnValueOnce(text);
    // Programmatic reentry while the old dialog is open must not preserve its download.
    get("export").click();
    expect(get("status").textContent).toContain("exceeds 8 MiB");
    expect(get<HTMLTextAreaElement>("exportPreview").value).toBe("");
    get("downloadExport").click();
    expect(createUrl).not.toHaveBeenCalled();
  });
  it("shows imported timestamps newest first but previews the same rows oldest first", async () => {
    const row = (ts: number, site: string) => ({ id: site, ts, kind: "nav_click_block", site });
    mocks.getEventLog.mockResolvedValue([row(3000, "late.test"), row(1000, "early.test"), row(NaN, "bad.test"), row(1000, "tie.test")]);
    get("refresh").click();
    await vi.waitFor(() => expect(get("total").textContent).toBe("3"));
    const routes = [...document.querySelectorAll(".event-route")].map(node => node.textContent);
    expect(routes).toEqual(["late.test → Destination unavailable", "tie.test → Destination unavailable", "early.test → Destination unavailable"]);
    get("export").click();
    const payload = JSON.parse(get<HTMLTextAreaElement>("exportPreview").value);
    expect(payload.events.map((row: { sourceSite: string }) => row.sourceSite)).toEqual(["early.test", "tie.test", "late.test"]);
  });
  it("keeps a failed refresh visibly stale and permits retry", async () => {
    mocks.getEventLog.mockRejectedValueOnce(new Error("offline"));
    get("refresh").click();
    await vi.waitFor(() => expect(get("status").textContent).toContain("may be stale"));
    expect(get<HTMLButtonElement>("refresh").disabled).toBe(false);
    get("refresh").click();
    await vi.waitFor(() => expect(get("status").textContent).toContain("Local snapshot refreshed"));
  });
  it("changes only the page appearance preference", () => {
    get<HTMLSelectElement>("theme").value = "paper";
    get("theme").dispatchEvent(new Event("change"));
    expect(document.documentElement.dataset.theme).toBe("paper");
    expect(localStorage.getItem("ns-evidence-theme")).toBe("paper");
    expect(localStorage.length).toBe(1);
  });
  it("has labelled native filters, semantic disclosure controls and live status", () => {
    for (const id of ["search", "category", "theme"]) expect(document.querySelector(`label[for="${id}"]`)).not.toBeNull();
    expect(get("scoredOnly").closest("label")).not.toBeNull();
    expect(get("status").getAttribute("role")).toBe("status");
    expect(document.querySelector("details > summary")).not.toBeNull();
    expect(document.querySelector('a[href="#journal"]')).not.toBeNull();
  });
});
