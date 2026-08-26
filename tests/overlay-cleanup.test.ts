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

    expect(suppression?.restore()).toBe(true);
    expect(overlay.hidden).toBe(false);
    expect(overlay.hasAttribute("aria-hidden")).toBe(false);
    expect(overlay.style.display).toBe("flex");
    expect(overlay.style.color).toBe("red");
    expect(suppression?.restore()).toBe(false);
  });

  it("does not overwrite a page-owned display change made before Undo", () => {
    const overlay = makeOverlay();
    const suppression = suppressDetectedOverlay(mutationAlert(overlay), true);

    // Simulate the page closing its own overlay while NavSentinel has it hidden.
    overlay.style.setProperty("display", "none");

    expect(suppression?.restore()).toBe(false);
    expect(overlay.style.getPropertyValue("display")).toBe("none");
    expect(overlay.style.getPropertyPriority("display")).toBe("");
  });

  it("preserves a page-owned hidden state made while cleanup is active", () => {
    const overlay = makeOverlay();
    const suppression = suppressDetectedOverlay(mutationAlert(overlay), true);
    overlay.hidden = true;

    expect(suppression?.restore()).toBe(true);
    expect(overlay.hidden).toBe(true);
    expect(overlay.style.getPropertyValue("display")).toBe("flex");
  });

  it("does not mutate a detached overlay during Undo", () => {
    const overlay = makeOverlay();
    const suppression = suppressDetectedOverlay(mutationAlert(overlay), true);
    overlay.remove();

    expect(suppression?.restore()).toBe(false);
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

    expect(suppression?.element).toBe(overlay);
    expect(overlay.style.getPropertyValue("display")).toBe("none");
    expect(overlay.style.getPropertyPriority("display")).toBe("important");
  });

  it("preserves an ARIA dialog that the existing classifier marks benign", () => {
    const dialog = makeOverlay({ role: "dialog" });

    expect(suppressHighSeverityOverlayInPath([dialog], true)).toBeNull();
    expect(dialog.hidden).toBe(false);
  });

  it("will never suppress the page root or NavSentinel's own UI host", () => {
    const host = document.createElement("div");
    host.id = "__navsentinel_toast_host";
    document.body.appendChild(host);

    expect(suppressOverlayElement(document.documentElement)).toBeNull();
    expect(suppressOverlayElement(document.body)).toBeNull();
    expect(suppressOverlayElement(host)).toBeNull();
  });
});
