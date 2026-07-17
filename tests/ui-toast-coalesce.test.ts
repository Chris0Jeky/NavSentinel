// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ShowToast = typeof import("../extension/src/content/ui_toast").showToast;

let showToast: ShowToast;

async function loadModule(): Promise<void> {
  const mod = await import("../extension/src/content/ui_toast");
  showToast = mod.showToast;
}

/**
 * Burst coalescing (#351): repeated low-stakes block notices collapse into a
 * single count pill instead of forcing a Dismiss per block on redirect-spam
 * pages. Interactive prompts / critical warnings (no `coalesce` flag) must never
 * collapse and must not affect the burst counter.
 */
describe("ui_toast burst coalescing", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = "";
    document.documentElement.querySelectorAll("#__navsentinel_toast_host").forEach((n) => n.remove());
    await loadModule();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.documentElement.querySelectorAll("#__navsentinel_toast_host").forEach((n) => n.remove());
    document.body.innerHTML = "";
  });

  function getRoot(): ShadowRoot | null {
    return document.documentElement.querySelector("#__navsentinel_toast_host")?.shadowRoot ?? null;
  }
  function wraps(): NodeListOf<Element> {
    return getRoot()?.querySelectorAll(".wrap") ?? ([] as unknown as NodeListOf<Element>);
  }
  function pill(): HTMLElement | null {
    return (getRoot()?.querySelector(".pill") as HTMLElement | null) ?? null;
  }
  function countText(): string {
    return pill()?.querySelector(".pill-count")?.textContent ?? "";
  }
  function block(message = "NavSentinel blocked a suspicious new tab"): void {
    showToast({ message, coalesce: true });
  }

  it("keeps full cards below the threshold (1-2 blocks)", () => {
    block();
    expect(wraps().length).toBe(1);
    expect(pill()).toBeNull();
    block();
    expect(wraps().length).toBe(1);
    expect(pill()).toBeNull();
  });

  it("collapses into a count pill at the threshold (3rd block)", () => {
    block();
    block();
    block();
    expect(pill()).not.toBeNull();
    expect(wraps().length).toBe(0);
    expect(countText()).toContain("3");
  });

  it("increments the pill count on further blocks", () => {
    for (let i = 0; i < 5; i++) block();
    expect(countText()).toContain("5");
    expect(countText()).toContain("navigations");
  });

  it("does not collapse or count non-coalesce toasts", () => {
    block();
    block();
    showToast({ message: "Critical safety warning" });
    expect(pill()).toBeNull();
    block(); // 3rd *coalesce* block — counter ignored the critical toast
    expect(pill()).not.toBeNull();
    expect(countText()).toContain("3");
  });

  it("starts a fresh burst (full card) after the window expires", () => {
    block();
    block();
    block();
    expect(pill()).not.toBeNull();
    vi.advanceTimersByTime(8001);
    block();
    expect(pill()).toBeNull();
    expect(wraps().length).toBe(1);
  });

  it("auto-dismisses the pill after the idle window", () => {
    block();
    block();
    block();
    expect(pill()).not.toBeNull();
    vi.advanceTimersByTime(12000 + 601);
    expect(pill()).toBeNull();
  });

  it("clears the pill on navigation (pagehide)", () => {
    block();
    block();
    block();
    expect(pill()).not.toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(pill()).toBeNull();
  });

  it("renders the pill as an accessible, keyboard-focusable status region", () => {
    block();
    block();
    block();
    const p = pill()!;
    expect(p.getAttribute("role")).toBe("status");
    expect(p.getAttribute("aria-live")).toBe("polite");
    expect(p.tabIndex).toBe(0);
    expect(p.getAttribute("aria-label")).toContain("blocked");
  });

  it("expands to a full card with the earlier-count on click", () => {
    block();
    block();
    block();
    pill()!.click();
    expect(wraps().length).toBe(1);
    expect(getRoot()!.querySelector(".wrap .body")!.textContent).toContain("more blocked");
    expect(pill()).toBeNull(); // the pill is swapped for the full card
  });

  it("preserves the latest prompt's actions when expanded (e.g. Allow once on a blocked popup)", () => {
    const allow = vi.fn();
    showToast({ message: "Blocked popup: a.example", coalesce: true });
    showToast({ message: "Blocked popup: b.example", coalesce: true });
    showToast({
      message: "Blocked popup: c.example",
      coalesce: true,
      actions: [{ label: "Allow once", onClick: allow }],
    });
    // The 3rd blocked-popup prompt collapses the burst into the pill.
    expect(pill()).not.toBeNull();
    pill()!.click();
    const labels = Array.from(getRoot()!.querySelectorAll(".wrap button")).map((b) => b.textContent);
    expect(labels).toContain("Allow once");
    // Acting on the preserved action allows that popup AND clears the burst.
    const allowBtn = Array.from(
      getRoot()!.querySelectorAll<HTMLButtonElement>(".wrap button")
    ).find((b) => b.textContent === "Allow once")!;
    allowBtn.click();
    expect(allow).toHaveBeenCalledTimes(1);
    expect(pill()).toBeNull();
  });

  it("uses a singular label for a single navigation after reset", () => {
    block();
    block();
    block();
    expect(countText()).toContain("navigations");
    // Expire and start a fresh single block, then push to threshold with same message.
    vi.advanceTimersByTime(8001);
    block();
    expect(pill()).toBeNull();
    expect(wraps().length).toBe(1);
  });
});
