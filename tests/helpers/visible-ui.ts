import { beforeEach, afterEach, vi } from "vitest";

export function armVisibleControl(control: HTMLElement): MouseEvent {
  control.focus();
  vi.advanceTimersByTime(1000);
  return new MouseEvent("click", { detail: 0 });
}

/** The service worker's tab-wide Picture-in-Picture answer (#1244); null never answers. */
export const tabPip: { open: boolean | null } = { open: false };

/** happy-dom has no layout, top layer, or hit testing. Model those browser APIs. */
export function stubVisibleUi(): void {
  let popoverDescriptor: PropertyDescriptor | undefined;
  beforeEach(() => {
    // Answered synchronously: fake timers run rAF samples without draining microtasks.
    tabPip.open = false;
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn(() => ({
      then: (answer: (open: boolean) => void) => { if (tabPip.open !== null) answer(tabPip.open); },
    })) } });
    popoverDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "showPopover");
    Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: vi.fn() });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      { x: 20, y: 20, left: 20, top: 20, right: 220, bottom: 60, width: 200, height: 40, toJSON() {} },
    );
    vi.spyOn(Element.prototype, "checkVisibility").mockImplementation(function (this: Element) {
      const css = getComputedStyle(this);
      return css.opacity !== "0" && css.visibility !== "hidden" && css.display !== "none";
    });
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
      return selector === ":popover-open" ? !this.hasAttribute("data-test-closed") : matches.call(this, selector);
    });
    vi.spyOn(document, "elementFromPoint").mockImplementation(() =>
      document.getElementById("__sentinelsuite_cred_modal_host__") ?? document.getElementById("__navsentinel_toast_host"),
    );
    Object.defineProperty(ShadowRoot.prototype, "elementFromPoint", { configurable: true, writable: true, value() { return null; } });
    vi.spyOn(ShadowRoot.prototype, "elementFromPoint").mockImplementation(function (this: ShadowRoot) {
      return this.activeElement ?? this.querySelector("button");
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (popoverDescriptor) Object.defineProperty(HTMLElement.prototype, "showPopover", popoverDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
  });
}
