// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MutationAlert } from "../extension/src/content/mutation_monitor";
import {
  _resetOverlaySuppressionGroupForTest,
  MAX_ACTIVE_OVERLAY_SUPPRESSIONS,
  reconcileDetectedOverlay,
  restoreActiveOverlaySuppressions,
  suppressDetectedOverlay,
  suppressHighSeverityOverlayInPath,
  suppressOverlayElement,
} from "../extension/src/content/overlay_cleanup";

function makeOverlay(options: { role?: string } = {}): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.zIndex = "10000";
  overlay.style.display = "flex";
  overlay.style.color = "red";
  if (options.role) overlay.setAttribute("role", options.role);
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 800, 600),
  );
  document.body.appendChild(overlay);
  return overlay;
}

function mutationAlert(
  element: Element,
  severity: MutationAlert["severity"] = "high",
): MutationAlert {
  return {
    type: "overlay_injected",
    severity,
    element,
    details: "test overlay",
    timestamp: 1,
  };
}

describe("overlay cleanup", () => {
  afterEach(() => {
    _resetOverlaySuppressionGroupForTest();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("suppresses a detected high-severity overlay and restores only changed properties", () => {
    const overlay = makeOverlay();
    const suppression = suppressDetectedOverlay(mutationAlert(overlay), true);

    expect(suppression).not.toBeNull();
    expect(overlay.hidden).toBe(false);
    expect(overlay.hasAttribute("aria-hidden")).toBe(false);
    expect(overlay.style.getPropertyValue("display")).toBe("none");
    expect(overlay.style.getPropertyPriority("display")).toBe("important");
    expect(overlay.style.color).toBe("red");

    expect(suppression?.()).toBe(true);
    expect(overlay.hidden).toBe(false);
    expect(overlay.hasAttribute("aria-hidden")).toBe(false);
    expect(overlay.style.display).toBe("flex");
    expect(overlay.style.color).toBe("red");
    expect(suppression?.()).toBe(false);
  });

  it("does not overwrite a page-owned display change made before Undo", () => {
    const overlay = makeOverlay();
    const suppression = suppressDetectedOverlay(mutationAlert(overlay), true);

    // Simulate the page closing its own overlay while NavSentinel has it hidden.
    overlay.style.setProperty("display", "none");

    expect(suppression?.()).toBe(false);
    expect(overlay.style.getPropertyValue("display")).toBe("none");
    expect(overlay.style.getPropertyPriority("display")).toBe("");
  });

  it("preserves a page-owned hidden state made while cleanup is active", () => {
    const overlay = makeOverlay();
    const suppression = suppressDetectedOverlay(mutationAlert(overlay), true);
    overlay.hidden = true;

    expect(suppression?.()).toBe(true);
    expect(overlay.hidden).toBe(true);
    expect(overlay.style.getPropertyValue("display")).toBe("flex");
  });

  it("does not mutate a detached overlay during Undo", () => {
    const overlay = makeOverlay();
    const suppression = suppressDetectedOverlay(mutationAlert(overlay), true);
    overlay.remove();

    expect(suppression?.()).toBe(false);
    expect(overlay.style.getPropertyValue("display")).toBe("none");
    expect(overlay.style.getPropertyPriority("display")).toBe("important");
  });

  it("stays inert when disabled or when the existing classifier downgraded the alert", () => {
    const overlay = makeOverlay();

    expect(suppressDetectedOverlay(mutationAlert(overlay), false)).toBeNull();
    expect(suppressDetectedOverlay(mutationAlert(overlay, "low"), true)).toBeNull();
    expect(overlay.hidden).toBe(false);
    expect(overlay.style.display).toBe("flex");
  });

  it("suppresses a high-severity overlay found during the page-load baseline scan", () => {
    const overlay = makeOverlay();
    const alert = { ...mutationAlert(overlay), type: "overlay_detected" as const };

    expect(suppressDetectedOverlay(alert, true)).not.toBeNull();
    expect(overlay.style.getPropertyValue("display")).toBe("none");
  });

  it("suppresses and restores a bounded initial overlay batch with one Undo", () => {
    const first = makeOverlay();
    const second = makeOverlay();
    const alert = {
      ...mutationAlert(first),
      type: "overlay_detected" as const,
      elements: [first, second],
    };

    const undo = suppressDetectedOverlay(alert, true);
    expect(first.style.getPropertyValue("display")).toBe("none");
    expect(second.style.getPropertyValue("display")).toBe("none");
    expect(undo?.()).toBe(true);
    expect(first.style.getPropertyValue("display")).toBe("flex");
    expect(second.style.getPropertyValue("display")).toBe("flex");
    expect(undo?.()).toBe(false);
  });

  it("reasserts a page-overwritten suppression without stacking stale Undo state", () => {
    const overlay = makeOverlay();
    const initial = reconcileDetectedOverlay(mutationAlert(overlay), true)!;

    overlay.style.setProperty("display", "block", "important");
    const reconciled = reconcileDetectedOverlay(mutationAlert(overlay), true)!;

    expect(reconciled.action).toBe("reasserted");
    expect(reconciled.undo).toBe(initial.undo);
    expect(reconciled.activeCount).toBe(1);
    expect(overlay.style.getPropertyValue("display")).toBe("none");
    expect(reconciled.undo()).toBe(true);
    expect(overlay.style.display).toBe("flex");
  });

  it("groups replacement layers under one reverse-order Undo", () => {
    const first = makeOverlay();
    const second = makeOverlay();
    const firstCleanup = reconcileDetectedOverlay(mutationAlert(first), true)!;
    const secondCleanup = reconcileDetectedOverlay(mutationAlert(second), true)!;

    expect(secondCleanup.undo).toBe(firstCleanup.undo);
    expect(secondCleanup.activeCount).toBe(2);
    expect(secondCleanup.undo()).toBe(true);
    expect(first.style.display).toBe("flex");
    expect(second.style.display).toBe("flex");
  });

  it("restores the active group when the feature is switched off", () => {
    const first = makeOverlay();
    const second = makeOverlay();
    reconcileDetectedOverlay(mutationAlert(first), true);
    reconcileDetectedOverlay(mutationAlert(second), true);

    expect(restoreActiveOverlaySuppressions()).toBe(true);
    expect(first.style.display).toBe("flex");
    expect(second.style.display).toBe("flex");
    expect(restoreActiveOverlaySuppressions()).toBe(false);
  });

  it("honors Undo against stale automatic alerts but lets a later click hide the node again", () => {
    const overlay = makeOverlay();
    const cleanup = reconcileDetectedOverlay(mutationAlert(overlay), true)!;
    expect(cleanup.undo()).toBe(true);

    expect(reconcileDetectedOverlay(mutationAlert(overlay), true)).toBeNull();
    expect(overlay.style.display).toBe("flex");

    expect(suppressHighSeverityOverlayInPath([overlay], true)).not.toBeNull();
    expect(overlay.style.getPropertyValue("display")).toBe("none");
  });

  it("fails visibly instead of growing the page-local Undo ledger without bound", () => {
    let last: ReturnType<typeof reconcileDetectedOverlay> = null;
    for (let index = 0; index <= MAX_ACTIVE_OVERLAY_SUPPRESSIONS; index += 1) {
      last = reconcileDetectedOverlay(mutationAlert(makeOverlay()), true);
    }

    expect(last?.action).toBe("budget_exhausted");
    expect(last?.activeCount).toBe(MAX_ACTIVE_OVERLAY_SUPPRESSIONS);
    expect((document.body.lastElementChild as HTMLElement).style.display).toBe("flex");
  });

  it("finds the high-severity overlay ancestor behind an already-blocked click", () => {
    const overlay = makeOverlay();
    const child = document.createElement("button");
    overlay.appendChild(child);

    const suppression = suppressHighSeverityOverlayInPath([child, overlay], true);

    expect(suppression).not.toBeNull();
    expect(overlay.style.getPropertyValue("display")).toBe("none");
    expect(overlay.style.getPropertyPriority("display")).toBe("important");
  });

  it("uses a resolved shadow target when the isolated-world path omits it", () => {
    const overlay = makeOverlay();

    const suppression = suppressHighSeverityOverlayInPath([], true, overlay);

    expect(suppression).not.toBeNull();
    expect(overlay.style.getPropertyValue("display")).toBe("none");
  });

  it("preserves an ARIA dialog that the existing classifier marks benign", () => {
    const dialog = makeOverlay({ role: "dialog" });

    expect(suppressHighSeverityOverlayInPath([dialog], true)).toBeNull();
    expect(dialog.hidden).toBe(false);
  });

  it("preserves a high-z-index wrapper around an accessible dialog", () => {
    const wrapper = makeOverlay();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    wrapper.appendChild(dialog);

    expect(suppressHighSeverityOverlayInPath([wrapper], true)).toBeNull();
    expect(wrapper.style.display).toBe("flex");
  });

  it("will never suppress the page root but does not trust a page-controlled ID", () => {
    const impostor = makeOverlay();
    impostor.id = "__navsentinel_attack";

    expect(suppressOverlayElement(document.documentElement)).toBeNull();
    expect(suppressOverlayElement(document.body)).toBeNull();
    expect(suppressOverlayElement(impostor)).not.toBeNull();
  });
});
