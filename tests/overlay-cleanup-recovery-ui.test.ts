// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ToastModule = typeof import("../extension/src/content/ui_toast");

let showOverlayCleanupToast: ToastModule["showOverlayCleanupToast"];

function getRoot(): ShadowRoot | null {
  return document.documentElement
    .querySelector<HTMLElement>("#__navsentinel_toast_host")
    ?.shadowRoot ?? null;
}

function getRecoveryCard(): HTMLElement | null {
  return getRoot()?.querySelector<HTMLElement>(".wrap.retained-recovery") ?? null;
}

describe("overlay cleanup recovery UI", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    document.documentElement
      .querySelectorAll("#__navsentinel_toast_host")
      .forEach((node) => node.remove());
    ({ showOverlayCleanupToast } = await import("../extension/src/content/ui_toast"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement
      .querySelectorAll("#__navsentinel_toast_host")
      .forEach((node) => node.remove());
  });

  it("docks instead of expiring and retains Undo until explicit activation", () => {
    const undo = vi.fn();

    showOverlayCleanupToast(undo);

    expect(getRecoveryCard()).not.toBeNull();
    expect(getRecoveryCard()?.dataset.recoveryDocked).toBe("false");

    // Page-synthetic input cannot move or retire an extension recovery control.
    document.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(getRecoveryCard()?.dataset.recoveryDocked).toBe("false");

    vi.advanceTimersByTime(2_001);
    expect(getRecoveryCard()).not.toBeNull();
    expect(getRecoveryCard()?.dataset.recoveryDocked).toBe("true");
    expect(getRecoveryCard()?.classList.contains("recovery-docked")).toBe(true);
    expect(undo).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(getRecoveryCard()).not.toBeNull();

    const button = getRecoveryCard()!.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Undo");
    button!.click();

    expect(undo).toHaveBeenCalledTimes(1);
    expect(getRecoveryCard()).toBeNull();
  });
});
