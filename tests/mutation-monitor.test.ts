import { describe, expect, it, beforeEach } from "vitest";
import {
  describeElement,
  classifyFormActionChange,
  classifyAddedNode,
  classifyIframe,
  isLargeOverlay,
  looksLikeLegitOverlay,
  getMutationSignals,
  clearMutationSignals,
  _resetMutationMonitor,
  _setPageLoadedAt,
  _pushSignal,
  type MutationSignal,
} from "../extension/src/content/mutation_monitor";

// ---------------------------------------------------------------------------
// NRS integration (mutation signals factor)
// ---------------------------------------------------------------------------

import { computeNRS } from "../extension/src/shared/nrs";
import type { NavigationContext } from "../extension/src/shared/nrs";
import type { ScoreResult } from "../extension/src/shared/scoring";

function baseCds(cds = 0, reasonCodes: string[] = []): ScoreResult {
  return { cds, reasonCodes };
}
function baseNav(overrides: Partial<NavigationContext> = {}): NavigationContext {
  return { isNewTabOrWindow: false, isCrossSite: false, ...overrides };
}

// ---------------------------------------------------------------------------
// describeElement (pure helper, works with minimal Element stubs)
// ---------------------------------------------------------------------------

describe("describeElement", () => {
  it("formats tag + id + class", () => {
    const el = {
      tagName: "DIV",
      id: "overlay",
      className: "modal popup",
    } as unknown as Element;
    expect(describeElement(el)).toBe("div#overlay.modal.popup");
  });

  it("handles missing id and className", () => {
    const el = { tagName: "SPAN", id: "", className: "" } as unknown as Element;
    expect(describeElement(el)).toBe("span");
  });

  it("truncates to 120 chars", () => {
    const el = {
      tagName: "DIV",
      id: "a".repeat(200),
      className: "",
    } as unknown as Element;
    const result = describeElement(el);
    expect(result.length).toBeLessThanOrEqual(120);
  });

  it("handles non-string className gracefully", () => {
    // SVG elements may have className as SVGAnimatedString
    const el = { tagName: "SVG", id: "", className: {} } as unknown as Element;
    expect(describeElement(el)).toBe("svg");
  });
});

// ---------------------------------------------------------------------------
// classifyFormActionChange (pure function)
// ---------------------------------------------------------------------------

describe("classifyFormActionChange", () => {
  const form = { tagName: "FORM", getAttribute: () => null } as unknown as Element;
  const now = Date.now();
  const origLocation = globalThis.location;

  beforeEach(() => {
    Object.defineProperty(globalThis, "location", {
      value: { origin: "https://example.com", href: "https://example.com/page" },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "location", {
      value: origLocation,
      writable: true,
      configurable: true,
    });
  });

  it("returns null for non-FORM elements", () => {
    const div = { tagName: "DIV" } as unknown as Element;
    expect(classifyFormActionChange(div, "/old", "/new", now)).toBeNull();
  });

  it("returns null when newValue is empty", () => {
    expect(classifyFormActionChange(form, "/old", null, now)).toBeNull();
    expect(classifyFormActionChange(form, "/old", "", now)).toBeNull();
  });

  it("returns null when old and new values are the same", () => {
    expect(classifyFormActionChange(form, "/same", "/same", now)).toBeNull();
  });

  it("returns medium severity for same-origin change", () => {
    // Same-origin: relative URL
    const result = classifyFormActionChange(form, "/login", "/other-endpoint", now);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("form_action_change");
    expect(result!.severity).toBe("medium");
  });

  it("returns high severity for cross-origin change", () => {
    const result = classifyFormActionChange(
      form,
      "/login",
      "https://evil.example.com/steal",
      now
    );
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("high");
  });

  it("returns high severity for malformed URL", () => {
    const result = classifyFormActionChange(form, "/login", "http://[invalid", now);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("high");
  });

  it("includes correct type and timestamp", () => {
    const ts = 1700000000000;
    const result = classifyFormActionChange(form, "/a", "/b", ts);
    expect(result!.timestamp).toBe(ts);
    expect(result!.type).toBe("form_action_change");
  });
});

// ---------------------------------------------------------------------------
// Signal accumulation and clearing
// ---------------------------------------------------------------------------

describe("signal accumulation", () => {
  beforeEach(() => {
    _resetMutationMonitor();
  });

  it("starts with no signals", () => {
    expect(getMutationSignals()).toEqual([]);
  });

  it("accumulates pushed signals", () => {
    const sig: MutationSignal = {
      type: "test",
      severity: "low",
      element: "div",
      timestamp: Date.now(),
    };
    _pushSignal(sig);
    _pushSignal({ ...sig, severity: "high" });
    const signals = getMutationSignals();
    expect(signals).toHaveLength(2);
    expect(signals[0]!.severity).toBe("low");
    expect(signals[1]!.severity).toBe("high");
  });

  it("clears signals", () => {
    _pushSignal({
      type: "test",
      severity: "low",
      element: "div",
      timestamp: Date.now(),
    });
    clearMutationSignals();
    expect(getMutationSignals()).toEqual([]);
  });

  it("caps at MAX_SIGNALS (64) keeping newest", () => {
    for (let i = 0; i < 80; i++) {
      _pushSignal({
        type: `sig-${i}`,
        severity: "low",
        element: "div",
        timestamp: i,
      });
    }
    const signals = getMutationSignals();
    expect(signals.length).toBe(64);
    // Oldest should be trimmed, newest kept
    expect(signals[0]!.type).toBe("sig-16");
    expect(signals[63]!.type).toBe("sig-79");
  });
});

// ---------------------------------------------------------------------------
// NRS integration: mutationSignalsActive factor
// ---------------------------------------------------------------------------

describe("NRS mutationSignalsActive factor", () => {
  it("adds +15 when mutationSignalsActive is true", () => {
    const result = computeNRS(baseCds(0), baseNav({ mutationSignalsActive: true }));
    expect(result.nrs).toBe(15);
    expect(result.nrsFactors).toContain("nrs_mutation_signals");
  });

  it("does not add when mutationSignalsActive is false", () => {
    const result = computeNRS(baseCds(0), baseNav({ mutationSignalsActive: false }));
    expect(result.nrs).toBe(0);
    expect(result.nrsFactors).not.toContain("nrs_mutation_signals");
  });

  it("does not add when mutationSignalsActive is undefined", () => {
    const result = computeNRS(baseCds(0), baseNav());
    expect(result.nrsFactors).not.toContain("nrs_mutation_signals");
  });

  it("combines with other factors", () => {
    const result = computeNRS(
      baseCds(20),
      baseNav({ isNewTabOrWindow: true, isCrossSite: true, mutationSignalsActive: true })
    );
    // 20 (CDS) + 20 (new tab) + 20 (cross site) + 15 (mutation) = 75
    expect(result.nrs).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// classifyIframe (needs minimal DOM stubs)
// ---------------------------------------------------------------------------

describe("classifyIframe", () => {
  // Stub for getComputedStyle
  const origGetComputedStyle = globalThis.getComputedStyle;
  const origLocation = globalThis.location;

  function makeIframe(overrides: {
    display?: string;
    width?: number;
    height?: number;
    src?: string;
  }): HTMLIFrameElement {
    const { display = "block", width = 300, height = 200, src = "" } = overrides;

    // Mock getComputedStyle for this test
    (globalThis as any).getComputedStyle = () => ({ display });

    const iframe = {
      tagName: "IFRAME",
      src,
      getAttribute: (name: string) => {
        if (name === "src") return src;
        return null;
      },
      getBoundingClientRect: () => ({
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => {},
      }),
    } as unknown as HTMLIFrameElement;
    return iframe;
  }

  beforeEach(() => {
    // Provide a stable location.origin for cross-origin tests
    Object.defineProperty(globalThis, "location", {
      value: { origin: "https://example.com", href: "https://example.com/page" },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    (globalThis as any).getComputedStyle = origGetComputedStyle;
    Object.defineProperty(globalThis, "location", {
      value: origLocation,
      writable: true,
      configurable: true,
    });
  });

  it("flags display:none iframe as high severity", () => {
    const result = classifyIframe(makeIframe({ display: "none" }));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("high");
    expect(result!.reason).toBe("display:none");
  });

  it("flags tiny iframe as high severity", () => {
    const result = classifyIframe(makeIframe({ width: 1, height: 1 }));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("high");
    expect(result!.reason).toBe("tiny dimensions");
  });

  it("flags cross-origin iframe as medium severity", () => {
    const result = classifyIframe(makeIframe({ src: "https://evil.example.com/frame" }));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("medium");
    expect(result!.reason).toBe("cross-origin src");
  });

  it("returns null for benign same-origin iframe", () => {
    const result = classifyIframe(makeIframe({ src: "https://example.com/widget" }));
    expect(result).toBeNull();
  });

  it("returns null for iframe with about: src", () => {
    const result = classifyIframe(makeIframe({ src: "about:blank" }));
    expect(result).toBeNull();
  });

  it("flags malformed src as medium severity", () => {
    const result = classifyIframe(makeIframe({ src: "http://[invalid" }));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// looksLikeLegitOverlay (needs minimal Element stubs)
// ---------------------------------------------------------------------------

describe("looksLikeLegitOverlay", () => {
  function makeEl(overrides: {
    textContent?: string;
    id?: string;
    className?: string;
    role?: string;
  }): Element {
    const { textContent = "", id = "", className = "", role = "" } = overrides;
    return {
      textContent,
      id,
      className,
      getAttribute: (name: string) => {
        if (name === "role") return role;
        return null;
      },
    } as unknown as Element;
  }

  it("matches cookie-banner id", () => {
    expect(looksLikeLegitOverlay(makeEl({ id: "cookie-banner" }))).toBe(true);
  });

  it("matches consent class", () => {
    expect(looksLikeLegitOverlay(makeEl({ className: "consent-banner overlay" }))).toBe(true);
  });

  it("matches gdpr in text content", () => {
    expect(looksLikeLegitOverlay(makeEl({ textContent: "We use cookies for GDPR compliance" }))).toBe(true);
  });

  it("matches dialog role", () => {
    expect(looksLikeLegitOverlay(makeEl({ role: "dialog" }))).toBe(true);
  });

  it("matches alertdialog role", () => {
    expect(looksLikeLegitOverlay(makeEl({ role: "alertdialog" }))).toBe(true);
  });

  it("returns false for generic overlay", () => {
    expect(looksLikeLegitOverlay(makeEl({ id: "trap-overlay", className: "evil" }))).toBe(false);
  });

  it("matches 'accept cookies' in text", () => {
    expect(looksLikeLegitOverlay(makeEl({ textContent: "Please accept cookies to continue" }))).toBe(true);
  });

  it("skips text check for very long content", () => {
    // textContent > 2000 chars: only checks id/className/role
    const longText = "x".repeat(3000);
    expect(looksLikeLegitOverlay(makeEl({ textContent: longText }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Severity assignment: edge cases (timing threshold)
// ---------------------------------------------------------------------------

describe("timing threshold for post-load signals", () => {
  // classifyAddedNode requires DOM APIs (getComputedStyle, getBoundingClientRect).
  // We stub them minimally to test the timing threshold logic.

  const origGetComputedStyle = globalThis.getComputedStyle;

  function makeOverlayEl(): Node {
    (globalThis as any).getComputedStyle = () => ({
      position: "fixed",
      display: "block",
      visibility: "visible",
      opacity: "1",
    });
    (globalThis as any).innerWidth = 1000;
    (globalThis as any).innerHeight = 800;

    return {
      nodeType: 1, // ELEMENT_NODE
      tagName: "DIV",
      id: "trap",
      className: "overlay",
      getBoundingClientRect: () => ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }),
      getAttribute: () => null,
      textContent: "",
      closest: () => null,
      querySelectorAll: () => ({ length: 0 }),
    } as unknown as Node;
  }

  afterEach(() => {
    (globalThis as any).getComputedStyle = origGetComputedStyle;
    _resetMutationMonitor();
  });

  it("ignores overlay injected within 2-second grace period", () => {
    const loadedAt = 1000;
    const now = 2500; // only 1.5s after load
    const results = classifyAddedNode(makeOverlayEl(), now, loadedAt);
    const overlaySignals = results.filter((s) => s.type === "post_load_overlay");
    expect(overlaySignals).toHaveLength(0);
  });

  it("detects overlay injected after 2-second grace period", () => {
    const loadedAt = 1000;
    const now = 3500; // 2.5s after load
    const results = classifyAddedNode(makeOverlayEl(), now, loadedAt);
    const overlaySignals = results.filter((s) => s.type === "post_load_overlay");
    expect(overlaySignals).toHaveLength(1);
    expect(overlaySignals[0]!.severity).toBe("high");
  });

  it("assigns low severity to legitimate-looking overlay", () => {
    (globalThis as any).getComputedStyle = () => ({
      position: "fixed",
      display: "block",
      visibility: "visible",
      opacity: "1",
    });
    (globalThis as any).innerWidth = 1000;
    (globalThis as any).innerHeight = 800;

    const el = {
      nodeType: 1,
      tagName: "DIV",
      id: "cookie-consent",
      className: "consent-banner",
      getBoundingClientRect: () => ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }),
      getAttribute: (name: string) => {
        if (name === "role") return "dialog";
        return null;
      },
      textContent: "We use cookies to improve your experience. Accept all cookies.",
      closest: () => null,
      querySelectorAll: () => ({ length: 0 }),
    } as unknown as Node;

    const loadedAt = 1000;
    const now = 4000;
    const results = classifyAddedNode(el, now, loadedAt);
    const overlaySignals = results.filter((s) => s.type === "post_load_overlay");
    expect(overlaySignals).toHaveLength(1);
    expect(overlaySignals[0]!.severity).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// Password field injection classification
// ---------------------------------------------------------------------------

describe("password field injection", () => {
  const origGetComputedStyle = globalThis.getComputedStyle;

  afterEach(() => {
    (globalThis as any).getComputedStyle = origGetComputedStyle;
    _resetMutationMonitor();
  });

  it("detects password input added to a form after grace period", () => {
    (globalThis as any).getComputedStyle = () => ({
      position: "static",
      display: "inline",
    });

    const el = {
      nodeType: 1,
      tagName: "INPUT",
      type: "password",
      id: "",
      className: "",
      getBoundingClientRect: () => ({ width: 200, height: 30, top: 0, left: 0, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => {} }),
      getAttribute: () => null,
      textContent: "",
      closest: (selector: string) => {
        if (selector === "form") return {}; // mock: is inside a form
        return null;
      },
      querySelectorAll: () => ({ length: 0 }),
    } as unknown as Node;

    const results = classifyAddedNode(el, 5000, 1000);
    const pwSignals = results.filter((s) => s.type === "password_field_injection");
    expect(pwSignals).toHaveLength(1);
    expect(pwSignals[0]!.severity).toBe("high");
  });

  it("ignores password input not in a form", () => {
    (globalThis as any).getComputedStyle = () => ({
      position: "static",
      display: "inline",
    });

    const el = {
      nodeType: 1,
      tagName: "INPUT",
      type: "password",
      id: "",
      className: "",
      getBoundingClientRect: () => ({ width: 200, height: 30, top: 0, left: 0, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => {} }),
      getAttribute: () => null,
      textContent: "",
      closest: () => null, // not inside a form
      querySelectorAll: () => ({ length: 0 }),
    } as unknown as Node;

    const results = classifyAddedNode(el, 5000, 1000);
    const pwSignals = results.filter((s) => s.type === "password_field_injection");
    expect(pwSignals).toHaveLength(0);
  });

  it("ignores password input added within grace period", () => {
    (globalThis as any).getComputedStyle = () => ({
      position: "static",
      display: "inline",
    });

    const el = {
      nodeType: 1,
      tagName: "INPUT",
      type: "password",
      id: "",
      className: "",
      getBoundingClientRect: () => ({ width: 200, height: 30, top: 0, left: 0, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => {} }),
      getAttribute: () => null,
      textContent: "",
      closest: (selector: string) => {
        if (selector === "form") return {};
        return null;
      },
      querySelectorAll: () => ({ length: 0 }),
    } as unknown as Node;

    const results = classifyAddedNode(el, 2500, 1000);
    const pwSignals = results.filter((s) => s.type === "password_field_injection");
    expect(pwSignals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Non-element nodes are ignored
// ---------------------------------------------------------------------------

describe("non-element node handling", () => {
  it("returns empty array for text nodes", () => {
    const textNode = { nodeType: 3, tagName: undefined } as unknown as Node;
    expect(classifyAddedNode(textNode, 5000, 1000)).toEqual([]);
  });

  it("returns empty array for comment nodes", () => {
    const commentNode = { nodeType: 8, tagName: undefined } as unknown as Node;
    expect(classifyAddedNode(commentNode, 5000, 1000)).toEqual([]);
  });
});

// We need the afterEach import
import { afterEach } from "vitest";
