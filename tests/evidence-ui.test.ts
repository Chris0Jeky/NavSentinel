// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const mocks = vi.hoisted(() => ({ getEventLog: vi.fn(), getSuiteSettings: vi.fn(), setOverlayReviewLabel: vi.fn(), appendOverlayUserMiss: vi.fn() }));
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
    mocks.setOverlayReviewLabel.mockReset().mockResolvedValue(true);
    mocks.appendOverlayUserMiss.mockReset().mockResolvedValue(undefined);
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
    const routes = Array.from(document.querySelectorAll(".event-route")).map(node => node.textContent);
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
  it("honors the scored-only filter", async () => {
    mocks.getEventLog.mockResolvedValue([
      { id: "private-scored", ts: 1_700_000_000_000, kind: "nav_click_block", site: "source.test", destHost: "target.test", reasons: ["no_accessible_name"], score: 40 },
      { id: "private-plain", ts: 1_700_000_000_001, kind: "nav_click_block", site: "source.test", destHost: "target.test", reasons: ["no_accessible_name"] },
    ]);
    get("refresh").click();
    await vi.waitFor(() => expect(get("total").textContent).toBe("2"));
    expect(document.querySelectorAll("details.event")).toHaveLength(2);
    get<HTMLInputElement>("scoredOnly").checked = true;
    get("scoredOnly").dispatchEvent(new Event("input"));
    expect(document.querySelectorAll("details.event")).toHaveLength(1);
    expect(get("events").textContent).toContain("40");
  });
  it("explains stored credential and blank-tab reasons as text, never raw or unknown codes (#867)", async () => {
    mocks.getEventLog.mockResolvedValue([
      { id: "private-cred", ts: 1_700_000_000_000, kind: "cred_submit_prompt", site: "127.0.0.1", destHost: "localhost", score: 100, reasons: ["NON_HTTPS_PAGE", "IP_HOST", "UNTRUSTED_DOMAIN", "<img src=x onerror=alert(1)>"] },
      { id: "private-blank", ts: 1_700_000_000_001, kind: "nav_blank_prompt", site: "source.test", destHost: "target.test", reasons: ["near_invisible_opacity", "nrs_new_tab_window"] },
      { id: "private-legacy", ts: 1_700_000_000_002, kind: "nav_blank_prompt", site: "source.test", destHost: "target.test", reasons: ["retired_legacy_code"] },
    ]);
    get("refresh").click();
    await vi.waitFor(() => expect(get("total").textContent).toBe("3"));
    const [legacy, blank, credential] = Array.from(document.querySelectorAll("details.event"));
    expect(Array.from(credential!.querySelectorAll(".details li"), li => li.textContent)).toEqual([
      "The sign-in page was not using HTTPS, so a password could be intercepted",
      "The page address is a raw IP number, unusual for a real sign-in page",
      "This site is not on your trusted list",
    ]);
    expect(credential!.querySelector("img")).toBeNull();
    expect(Array.from(blank!.querySelectorAll(".details li"), li => li.textContent)).toEqual([
      "A nearly invisible element is intercepting clicks", "Navigation opens a new tab or window",
    ]);
    expect(legacy!.querySelector(".details li")).toBeNull();
    expect(legacy!.textContent).toContain("No recognized signal explanation is available for this entry.");
    expect(get("events").textContent).not.toMatch(/NON_HTTPS_PAGE|retired_legacy_code|onerror/);
  });
  it("accepts an 8 MiB export and refuses one extra byte", async () => {
    const OriginalBlob = Blob;
    const sizes = [8 * 1024 * 1024, 8 * 1024 * 1024 + 1];
    vi.stubGlobal("Blob", class MockBlob {
      readonly type: string;
      private readonly textValue: string;
      readonly size: number;
      constructor(parts: BlobPart[] = [], options: BlobPropertyBag = {}) {
        this.textValue = String(parts[0] ?? "");
        this.type = options.type ?? "";
        this.size = sizes.shift() ?? new OriginalBlob(parts, options).size;
      }
      text() { return Promise.resolve(this.textValue); }
    });
    get("export").click();
    expect(get<HTMLDialogElement>("exportDialog").open).toBe(true);
    expect(get<HTMLTextAreaElement>("exportPreview").value.length).toBeGreaterThan(0);
    get("cancelExport").click();
    await vi.waitFor(() => expect(get<HTMLTextAreaElement>("exportPreview").value).toBe(""));
    get("export").click();
    expect(get("status").textContent).toContain("exceeds 8 MiB");
    expect(get<HTMLDialogElement>("exportDialog").open).toBe(false);
  });
  it("has labelled native filters, semantic disclosure controls and live status", () => {
    for (const id of ["search", "category", "theme"]) expect(document.querySelector(`label[for="${id}"]`)).not.toBeNull();
    expect(get("scoredOnly").closest("label")).not.toBeNull();
    expect(get("status").getAttribute("role")).toBe("status");
    expect(document.querySelector("details > summary")).not.toBeNull();
    expect(document.querySelector('a[href="#journal"]')).not.toBeNull();
  });
  it("renders every retained overlay outcome locally without identifiers", async () => {
    mocks.getEventLog.mockResolvedValue([
      { id: "private-s", ts: 1_700_000_000_000, kind: "mutation_alert", site: "synthetic.test", url: "https://synthetic.test/private?token=secret", destHost: "destination.test", score: 99, reasons: ["overlay_injected"], extra: { details: "raw details", severity: "high", overlayCleanupOutcome: "suppressed", overlayDiag: { frame: "top", positionBucket: "fixed", coverageBucket: "half_to_full", stackingBucket: "topmost", retryCount: 2, readiness: "ready", error: "none" } } },
      { id: "private-r", ts: 1_700_000_000_001, kind: "mutation_alert", site: "synthetic.test", reasons: ["overlay_injected"], extra: { overlayCleanupOutcome: "reasserted" } },
      { id: "private-h", ts: 1_700_000_000_002, kind: "mutation_alert", site: "synthetic.test", reasons: ["overlay_injected"], extra: { overlayCleanupOutcome: "already_hidden" } },
      { id: "private-b", ts: 1_700_000_000_003, kind: "mutation_alert", site: "synthetic.test", reasons: ["overlay_injected"], extra: { overlayCleanupOutcome: "budget_exhausted" } },
      { id: "private-u", ts: 1_700_000_000_004, kind: "mutation_alert", site: "synthetic.test", reasons: ["overlay_cleanup_undo"], extra: { overlayCleanupOutcome: "restored" } },
      { id: "private-m", ts: 1_700_000_000_005, kind: "mutation_alert", reasons: ["overlay_user_reported_miss"], extra: { overlayCleanupOutcome: "user_reported_miss" } },
      { id: "private-o", ts: 1_700_000_000_006, kind: "mutation_alert", site: "synthetic.test", reasons: ["overlay_detected"] },
      { id: "private-n", ts: 1_700_000_000_007, kind: "nav_click_block", site: "synthetic.test", reasons: ["no_accessible_name"] },
    ]);
    get("refresh").click();
    await vi.waitFor(() => expect(get("reviewResults").textContent).toContain("7 retained"));
    const list = get("reviewList").textContent ?? "";
    for (const name of ["Suppressed", "Reasserted", "Already hidden", "Budget-limited", "Restored", "Reported miss", "Observed"]) {
      expect(list).toContain(name);
    }
    expect(get("reviewList").textContent).not.toMatch(/private-|synthetic\.test|destination\.test|token=secret|raw details/);
    expect(get<HTMLButtonElement>("prepareDiagnostic").disabled).toBe(false);
    for (const button of Array.from(document.querySelectorAll("#reviewList button"))) {
      expect(button.tagName).toBe("BUTTON");
      expect((button as HTMLButtonElement).type).toBe("button");
    }
  });
  it("sends Should block/Should allow through the local label lane and reports misses locally", async () => {
    mocks.getEventLog.mockResolvedValue([
      { id: "r1", ts: 1_700_000_000_000, kind: "mutation_alert", reasons: ["overlay_injected"], extra: { overlayCleanupOutcome: "suppressed" } },
      { id: "r2", ts: 1_700_000_000_001, kind: "mutation_alert", reasons: ["overlay_detected"] },
    ]);
    get("refresh").click();
    await vi.waitFor(() => expect(get("reviewResults").textContent).toContain("2 retained"));
    const first = document.querySelectorAll("#reviewList details")[0]!;
    (first.querySelector("summary") as HTMLElement).click();
    (Array.from(first.querySelectorAll("button")).find(b => b.textContent === "Should block") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mocks.setOverlayReviewLabel).toHaveBeenCalledWith("r2", "should_block"));
    await vi.waitFor(() => expect(get("status").textContent).toContain("Saved the local label"));
    const refreshedFirst = document.querySelectorAll("#reviewList details")[0] as HTMLDetailsElement;
    expect(refreshedFirst.open).toBe(true);
    expect(document.activeElement).toBe(refreshedFirst.querySelector("button"));
    (Array.from(refreshedFirst.querySelectorAll("button")).find(b => b.textContent === "Should allow") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mocks.setOverlayReviewLabel).toHaveBeenCalledWith("r2", "should_allow"));
    get("reportMiss").click();
    await vi.waitFor(() => expect(mocks.appendOverlayUserMiss).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(get("status").textContent).toBe("Recorded a local reported miss. Nothing was uploaded."));
  });
  it("previews the exact diagnostic bytes, downloads them, and cancels without saving", async () => {
    mocks.getEventLog.mockResolvedValue([
      { id: "private-1", ts: 1_700_000_000_000, kind: "mutation_alert", site: "synthetic.test", url: "https://synthetic.test/private?token=secret", destHost: "destination.test", score: 50, reasons: ["overlay_injected", "no_accessible_name"], extra: { details: "raw", severity: "high", overlayReviewLabel: "should_block", overlayCleanupOutcome: "suppressed", overlayDiag: { frame: "top", positionBucket: "fixed", coverageBucket: "half_to_full", stackingBucket: "topmost", retryCount: 2, readiness: "ready", error: "none" } } },
      { id: "private-2", ts: 1_700_000_000_001, kind: "mutation_alert", site: "synthetic.test", reasons: ["overlay_detected"] },
    ]);
    get("refresh").click();
    await vi.waitFor(() => expect(get<HTMLButtonElement>("prepareDiagnostic").disabled).toBe(false));
    let blob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation(value => { blob = value as Blob; return "blob:test"; });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    get("prepareDiagnostic").click();
    const reviewed = get<HTMLTextAreaElement>("diagnosticPreview").value;
    expect(reviewed.length).toBeGreaterThan(0);
    expect(get<HTMLDialogElement>("diagnosticDialog").open).toBe(true);
    expect(blob).toBeUndefined();
    const bundle = JSON.parse(reviewed);
    expect(bundle).toMatchObject({ format: "navsentinel-overlay-diagnostics", schema: 1 });
    expect(reviewed).not.toMatch(/private-|synthetic\.test|destination\.test|token=secret|should_block|overlayReviewLabel|raw|severity/);
    get("downloadDiagnostic").click();
    expect(blob?.type).toBe("application/json");
    expect(await blob!.text()).toBe(reviewed);
    expect(get("status").textContent).toContain("Nothing was uploaded");
    expect(get<HTMLDialogElement>("diagnosticDialog").open).toBe(false);
    get("prepareDiagnostic").click();
    expect(get<HTMLDialogElement>("diagnosticDialog").open).toBe(true);
    get("cancelDiagnostic").click();
    await vi.waitFor(() => expect(get<HTMLTextAreaElement>("diagnosticPreview").value).toBe(""));
    get("downloadDiagnostic").click();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(get("prepareDiagnostic"));
  });
  it("copies the reviewed preview without uploading", async () => {
    mocks.getEventLog.mockResolvedValue([
      { id: "r1", ts: 1_700_000_000_000, kind: "mutation_alert", reasons: ["overlay_injected"], extra: { overlayCleanupOutcome: "suppressed" } },
    ]);
    get("refresh").click();
    await vi.waitFor(() => expect(get<HTMLButtonElement>("prepareDiagnostic").disabled).toBe(false));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    get("prepareDiagnostic").click();
    const reviewed = get<HTMLTextAreaElement>("diagnosticPreview").value;
    get("copyDiagnostic").click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(reviewed));
    await vi.waitFor(() => expect(get("status").textContent).toContain("Nothing was uploaded"));
  });
});
