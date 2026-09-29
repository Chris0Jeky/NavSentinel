// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Behavioral suite for the real onboarding module (#wave2-slice2-B5). The
 * existing onboarding suite asserts on file contents; this one imports the
 * module against the real onboarding.html and drives the real handlers:
 * icon rendering, tab-close on Get started (plus the window.close fallback),
 * and the options-dashboard link.
 */
describe("onboarding behavior (real module)", () => {
  let getCurrent: ReturnType<typeof vi.fn>;
  let removeTab: ReturnType<typeof vi.fn>;
  let openOptionsPage: ReturnType<typeof vi.fn>;
  let closeWindow: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    document.documentElement.innerHTML = readFileSync(
      "extension/src/onboarding/onboarding.html",
      "utf8",
    );
    getCurrent = vi.fn();
    removeTab = vi.fn();
    openOptionsPage = vi.fn();
    closeWindow = vi.fn();
    Object.defineProperty(window, "close", {
      configurable: true,
      writable: true,
      value: closeWindow,
    });
    vi.stubGlobal("chrome", {
      tabs: { getCurrent, remove: removeTab },
      runtime: { openOptionsPage },
    });
    await import("../extension/src/onboarding/onboarding");
    await Promise.resolve();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the shared icons into their slots", () => {
    for (const id of ["logoSlot", "iconCursor", "iconBolt", "iconLock"]) {
      const html = document.getElementById(id)!.innerHTML;
      expect(html).toContain("<svg");
    }
  });

  it("Get started closes the current tab", async () => {
    getCurrent.mockResolvedValueOnce({ id: 12 });
    document.getElementById("getStarted")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(getCurrent).toHaveBeenCalledOnce();
    expect(removeTab).toHaveBeenCalledWith(12);
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("Get started falls back to window.close when the tab query fails", async () => {
    getCurrent.mockRejectedValueOnce(new Error("no tab"));
    document.getElementById("getStarted")!.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(removeTab).not.toHaveBeenCalled();
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it("Get started does nothing further when there is no tab id", async () => {
    getCurrent.mockResolvedValueOnce({});
    document.getElementById("getStarted")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(removeTab).not.toHaveBeenCalled();
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("the options link opens the options page without navigating", () => {
    const link = document.getElementById("openOptions")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(openOptionsPage).toHaveBeenCalledOnce();
  });
});
