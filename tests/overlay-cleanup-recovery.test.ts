import { describe, expect, it, vi } from "vitest";
import type { OverlaySuppression } from "../extension/src/content/overlay_cleanup";
import { createOverlayCleanupRecoveryController } from "../extension/src/content/overlay_cleanup_recovery";

function setup() {
  const present = vi.fn<(undo: OverlaySuppression) => void>();
  const onRestore = vi.fn<(restored: boolean) => void>();
  const controller = createOverlayCleanupRecoveryController({ present, onRestore });
  return { controller, present, onRestore };
}

describe("overlay cleanup recovery authority", () => {
  it("presents one retained action for one stable suppression group", () => {
    const { controller, present, onRestore } = setup();
    const suppression = vi.fn(() => true);

    controller.present(suppression);
    controller.present(suppression);

    expect(present).toHaveBeenCalledTimes(1);
    const undo = present.mock.calls[0]![0];
    expect(undo()).toBe(true);
    expect(suppression).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(true);

    controller.present(suppression);
    expect(present).toHaveBeenCalledTimes(2);
  });

  it("routes click-path recovery to the retained surface instead of transient toast actions", () => {
    const { controller, present } = setup();
    const suppression = vi.fn(() => true);

    const controls = controller.toastControls(suppression, true);

    expect(present).toHaveBeenCalledTimes(1);
    expect(controls).toEqual({ coalesce: false });
    expect(controls).not.toHaveProperty("actions");
  });

  it("does not let a stale recovery action clear a newer suppression group", () => {
    const { controller, present } = setup();
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);

    controller.present(first);
    const firstUndo = present.mock.calls[0]![0];
    controller.present(second);
    const secondUndo = present.mock.calls[1]![0];

    firstUndo();
    controller.present(second);
    expect(present).toHaveBeenCalledTimes(2);

    secondUndo();
    controller.present(second);
    expect(present).toHaveBeenCalledTimes(3);
  });

  it("allows explicit feature shutdown to retire the current recovery authority", () => {
    const { controller, present } = setup();
    const suppression = vi.fn(() => false);

    controller.present(suppression);
    controller.clear();
    controller.present(suppression);

    expect(present).toHaveBeenCalledTimes(2);
  });
});
