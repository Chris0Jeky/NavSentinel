// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  isExtensionOwnedOverlayElement,
  registerExtensionOwnedOverlayElement,
} from "../extension/src/content/extension_owned_overlay";

/**
 * Direct suite for the extension-owned overlay registry (#wave2-slice2-B3).
 * The registry is a WeakSet in the isolated world: page-created lookalikes —
 * even ones that clone every attribute of a real host — must never read as
 * owned. Mutation-monitor and credential-modal suites use it indirectly; this
 * one pins the primitive itself, including the attacker negative case.
 */
describe("extension-owned overlay registry", () => {
  it("returns the registered element and reports it owned", () => {
    const host = document.createElement("div");
    expect(registerExtensionOwnedOverlayElement(host)).toBe(host);
    expect(isExtensionOwnedOverlayElement(host)).toBe(true);
  });

  it("reports a fresh element as not owned", () => {
    expect(isExtensionOwnedOverlayElement(document.createElement("div"))).toBe(false);
  });

  it("is identity-based: same tag and attributes do not imply ownership", () => {
    const real = document.createElement("div");
    real.id = "__navsentinel_toast_host";
    real.setAttribute("data-test", "1");
    registerExtensionOwnedOverlayElement(real);

    const lookalike = document.createElement("div");
    lookalike.id = "__navsentinel_toast_host";
    lookalike.setAttribute("data-test", "1");
    expect(isExtensionOwnedOverlayElement(lookalike)).toBe(false);
    expect(isExtensionOwnedOverlayElement(real)).toBe(true);
  });

  it("rejects an attacker node cloned from the real host (copied attributes)", () => {
    const real = document.createElement("div");
    real.id = "__navsentinel_toast_host";
    real.className = "owned-toast-host";
    real.style.all = "initial";
    real.style.position = "fixed";
    real.setAttribute("data-navsentinel-owned", "true");
    document.body.appendChild(real);
    try {
      registerExtensionOwnedOverlayElement(real);

      // The strongest page-side forgery: clone the live node so every
      // attribute, inline style, and child is identical.
      const impostor = real.cloneNode(true) as Element;
      expect(impostor.getAttribute("id")).toBe(real.getAttribute("id"));
      expect(impostor.outerHTML).toBe(real.outerHTML);
      expect(isExtensionOwnedOverlayElement(impostor)).toBe(false);

      // Inserting the impostor next to the real host changes nothing: the
      // registry keys on object identity, not document position or id.
      document.body.appendChild(impostor);
      expect(isExtensionOwnedOverlayElement(impostor)).toBe(false);
      expect(isExtensionOwnedOverlayElement(real)).toBe(true);
      impostor.remove();
    } finally {
      real.remove();
    }
  });

  it("registers any element subtype and is idempotent", () => {
    const button = document.createElement("button");
    registerExtensionOwnedOverlayElement(button);
    registerExtensionOwnedOverlayElement(button);
    expect(isExtensionOwnedOverlayElement(button)).toBe(true);
    expect(isExtensionOwnedOverlayElement(document.createElement("button"))).toBe(false);
  });
});
