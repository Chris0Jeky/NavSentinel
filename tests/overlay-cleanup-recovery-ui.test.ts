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
  return getRoot()?.querySelector<HTMLElement>(".wrap.brief-recovery") ?? null;
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

  it("retains Undo until explicit activation instead of passively dismissing it", () => {
    const addEventListener = vi.spyOn(document, "addEventListener");
    const undo = vi.fn();

    showOverlayCleanupToast(undo);

    expect(getRecoveryCard()).not.toBeNull();
    expect(addEventListener).not.toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function),
      true,
    );

    vi.advanceTimersByTime(60_000);
    expect(getRecoveryCard()).not.toBeNull();
    expect(undo).not.toHaveBeenCalled();

    const button = getRecoveryCard()!.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Undo");
    button!.click();

    expect(undo).toHaveBeenCalledTimes(1);
    expect(getRecoveryCard()).toBeNull();
  });
});
