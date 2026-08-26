// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MutationAlert } from "../extension/src/content/mutation_monitor";
import {
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
