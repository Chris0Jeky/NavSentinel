// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubVisibleUi } from "./helpers/visible-ui";

/** IntersectionObserver v2 stand-in: tests decide what the browser "painted". */
class FakeVisibilityObserver {
  static instances: FakeVisibilityObserver[] = [];
  static supported = true;
  readonly targets = new Set<Element>();
  readonly trackVisibility: boolean | undefined;
  constructor(readonly callback: IntersectionObserverCallback, options?: { trackVisibility?: boolean; delay?: number }) {
    this.trackVisibility = FakeVisibilityObserver.supported ? options?.trackVisibility : undefined;
    if (this.trackVisibility) expect(options?.delay).toBeGreaterThanOrEqual(100);
    FakeVisibilityObserver.instances.push(this);
  }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  takeRecords() { return []; }
  emit(isVisible: boolean, only?: (target: Element) => boolean) {
    const entries = Array.from(this.targets).filter((target) => !only || only(target))
      .map((target) => ({ target, isVisible, isIntersecting: true, time: performance.now() }));
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

const painted = (isVisible: boolean, only?: (target: Element) => boolean) =>
  FakeVisibilityObserver.instances.forEach((io) => io.emit(isVisible, only));

describe("visible approval painted-visibility signal (#1142)", () => {
  stubVisibleUi();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    FakeVisibilityObserver.instances = [];
    FakeVisibilityObserver.supported = true;
    vi.stubGlobal("IntersectionObserver", FakeVisibilityObserver);
  });
  afterEach(() => {
    const escape = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(escape, "isTrusted", { value: true });
    window.dispatchEvent(escape);
    vi.clearAllTimers(); vi.useRealTimers();
    vi.unstubAllGlobals();
    document.getElementById("__sentinelsuite_cred_modal_host__")?.remove();
  });

  async function prompt() {
    const modal = await import("../extension/src/content/credential_modal");
    const settled = vi.fn();
    void modal.showCredentialModal({ title: "Credentials", actions: [{ id: "proceed", label: "Proceed once" }] }).then(settled);
    const host = document.getElementById("__sentinelsuite_cred_modal_host__")!;
    const button = modal.credentialModalRoot()!.querySelector("button")!;
    button.focus();
    const click = async (detail = 1) => {
      const allowed = modal.activateOwnedModalControl(host, [button], new MouseEvent("click", { detail, clientX: 120, clientY: 40 }));
      await Promise.resolve();
      return allowed;
    };
    return { host, button, settled, click };
  }

  it("refuses an armed approval the browser never reported as painted-visible", async () => {
    const p = await prompt();
    vi.advanceTimersByTime(1000);
    expect(await p.click()).toBe(false);
    expect(p.settled).not.toHaveBeenCalled();
  });

  it("arms once the browser reports the button painted-visible for 800 ms", async () => {
    const p = await prompt();
    vi.advanceTimersByTime(1000);
    painted(true);
    vi.advanceTimersByTime(700);
    expect(await p.click()).toBe(false);
    vi.advanceTimersByTime(900);
    expect(await p.click()).toBe(true);
    expect(p.settled).toHaveBeenCalledWith("proceed");
  });

  it("restarts the 800 ms window when painted visibility flips off, by mouse and keyboard", async () => {
    const p = await prompt();
    painted(true);
    vi.advanceTimersByTime(500);
    painted(false, (target) => target === p.button);
    painted(true);
    vi.advanceTimersByTime(500);
    expect(await p.click(0)).toBe(false);
    vi.advanceTimersByTime(850);
    expect(await p.click(0)).toBe(true);
    expect(p.settled).toHaveBeenCalledWith("proceed");
  });

  it("falls back to the explicit checks when trackVisibility is unsupported", async () => {
    FakeVisibilityObserver.supported = false;
    const p = await prompt();
    vi.advanceTimersByTime(1000);
    expect(await p.click()).toBe(true);
    expect(p.settled).toHaveBeenCalledWith("proceed");
  });

  it("refuses a shrunken button in the fallback path", async () => {
    FakeVisibilityObserver.supported = false;
    const p = await prompt();
    vi.spyOn(p.button, "getBoundingClientRect").mockReturnValue(
      { x: 119, y: 39, left: 119, top: 39, right: 121, bottom: 41, width: 2, height: 2, toJSON() {} },
    );
    vi.advanceTimersByTime(1000);
    expect(await p.click()).toBe(false);
    expect(p.settled).not.toHaveBeenCalled();
  });

  it("refuses a blended host in the fallback path", async () => {
    FakeVisibilityObserver.supported = false;
    const p = await prompt();
    p.host.style.mixBlendMode = "screen";
    vi.advanceTimersByTime(1000);
    expect(await p.click()).toBe(false);
    expect(p.settled).not.toHaveBeenCalled();
  });
});
