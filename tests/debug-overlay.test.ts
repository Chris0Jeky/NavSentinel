// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DebugInfoType = import("../extension/src/content/debug_overlay").DebugInfo;
type SetDebugEnabledType = typeof import("../extension/src/content/debug_overlay").setDebugEnabled;
type UpdateDebugOverlayType = typeof import("../extension/src/content/debug_overlay").updateDebugOverlay;

let setDebugEnabled: SetDebugEnabledType;
let updateDebugOverlay: UpdateDebugOverlayType;

async function loadModule(): Promise<void> {
  const mod = await import("../extension/src/content/debug_overlay");
  setDebugEnabled = mod.setDebugEnabled;
  updateDebugOverlay = mod.updateDebugOverlay;
}

function defaultInfo(overrides?: Partial<DebugInfoType>): DebugInfoType {
  return {
    mode: "smart",
    decision: "allow",
    cds: 10,
    reasonCodes: [],
    ctx: {
      viewport: { w: 1280, h: 720 },
      input: "pointer",
      top: { tag: "A", role: "link", rect: { w: 100, h: 30 } },
    },
    ...overrides,
  };
}

describe("debug_overlay", () => {
  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = "";
    document.documentElement
      .querySelectorAll("#__navsentinel_debug_host")
      .forEach((n) => n.remove());
    await loadModule();
  });

  afterEach(() => {
    document.documentElement
      .querySelectorAll("#__navsentinel_debug_host")
      .forEach((n) => n.remove());
    document.body.innerHTML = "";
  });

  function getHost(): HTMLElement | null {
    return document.documentElement.querySelector("#__navsentinel_debug_host");
  }

  function getRoot(): ShadowRoot | null {
    return getHost()?.shadowRoot ?? null;
  }

  function getPanel(): HTMLPreElement | null {
    return (getRoot()?.querySelector(".panel") as HTMLPreElement) ?? null;
  }

  describe("setDebugEnabled", () => {
    it("creates host element when enabled", () => {
      expect(getHost()).toBeNull();
      setDebugEnabled(true);
      expect(getHost()).not.toBeNull();
      expect(getHost()!.id).toBe("__navsentinel_debug_host");
    });

    it("attaches host to document.documentElement", () => {
      setDebugEnabled(true);
      expect(getHost()!.parentElement).toBe(document.documentElement);
    });

    it("creates shadow root in open mode", () => {
      setDebugEnabled(true);
      expect(getRoot()).not.toBeNull();
    });

    it("host has fixed positioning at bottom-left with max z-index", () => {
      setDebugEnabled(true);
      const h = getHost()!;
      expect(h.style.all).toBe("initial");
      expect(h.style.position).toBe("fixed");
      expect(h.style.left).toBe("16px");
      expect(h.style.bottom).toBe("16px");
      expect(h.style.zIndex).toBe("2147483647");
    });

    it("host has pointerEvents none and aria-hidden", () => {
      setDebugEnabled(true);
      const h = getHost()!;
      expect(h.style.pointerEvents).toBe("none");
      expect(h.getAttribute("aria-hidden")).toBe("true");
    });

    it("injects stylesheet into shadow root", () => {
      setDebugEnabled(true);
      const styles = getRoot()!.querySelectorAll("style");
      expect(styles.length).toBe(1);
      expect(styles[0]!.textContent).toContain(".panel");
    });

    it("creates panel with initial placeholder text", () => {
      setDebugEnabled(true);
      const panel = getPanel();
      expect(panel).not.toBeNull();
      expect(panel!.textContent).toBe("NavSentinel debug enabled...");
    });

    it("removes host when disabled", () => {
      setDebugEnabled(true);
      expect(getHost()).not.toBeNull();
      setDebugEnabled(false);
      expect(getHost()).toBeNull();
    });

    it("does nothing when disabled without being enabled first", () => {
      setDebugEnabled(false);
      expect(getHost()).toBeNull();
    });

    it("re-creates host after disable then re-enable", () => {
      setDebugEnabled(true);
      const firstHost = getHost();
      setDebugEnabled(false);
      expect(getHost()).toBeNull();
      setDebugEnabled(true);
      const secondHost = getHost();
      expect(secondHost).not.toBeNull();
      expect(secondHost).not.toBe(firstHost);
    });

    it("is idempotent when called multiple times with true", () => {
      setDebugEnabled(true);
      const firstHost = getHost();
      setDebugEnabled(true);
      expect(getHost()).toBe(firstHost);
    });

    it("is idempotent when called multiple times with false", () => {
      setDebugEnabled(false);
      setDebugEnabled(false);
      expect(getHost()).toBeNull();
    });
  });

  describe("updateDebugOverlay", () => {
    it("does nothing when not enabled", () => {
      updateDebugOverlay(defaultInfo());
      expect(getHost()).toBeNull();
    });

    it("updates panel text when enabled", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo());
      const panel = getPanel()!;
      expect(panel.textContent).toContain("NavSentinel Debug");
    });

    it("displays mode", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo({ mode: "strict" }));
      expect(getPanel()!.textContent).toContain("Mode: strict");
    });

    it("displays decision", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo({ decision: "block" }));
      expect(getPanel()!.textContent).toContain("Decision: block");
    });

    it("displays CDS value", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo({ cds: 42 }));
      expect(getPanel()!.textContent).toContain("CDS: 42");
    });

    it("displays NRS value when present", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo({ nrs: 75 }));
      expect(getPanel()!.textContent).toContain("NRS: 75");
    });

    it("displays NRS as n/a when absent", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo({ nrs: undefined }));
      expect(getPanel()!.textContent).toContain("NRS: n/a");
    });

    it("displays mainGuard value", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo({ mainGuard: "yes" }));
      expect(getPanel()!.textContent).toContain("MainGuard: yes");
    });

    it("displays mainGuard as unknown when absent", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo());
      expect(getPanel()!.textContent).toContain("MainGuard: unknown");
    });

    it("displays CDS reason codes", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({ reasonCodes: ["TINY_ELEMENT", "OPACITY_LOW"] }),
      );
      expect(getPanel()!.textContent).toContain(
        "CDS reasons: TINY_ELEMENT, OPACITY_LOW",
      );
    });

    it("displays 'none' when no CDS reasons", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo({ reasonCodes: [] }));
      expect(getPanel()!.textContent).toContain("CDS reasons: none");
    });

    it("separates NRS factors from CDS reasons", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          reasonCodes: ["TINY_ELEMENT", "nrs_new_domain", "nrs_no_tls"],
        }),
      );
      const text = getPanel()!.textContent!;
      expect(text).toContain("CDS reasons: TINY_ELEMENT");
      expect(text).toContain("NRS factors: nrs_new_domain, nrs_no_tls");
    });

    it("uses explicit nrsFactors over filtered reasonCodes", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          reasonCodes: ["nrs_new_domain"],
          nrsFactors: ["explicit_factor"],
        }),
      );
      const text = getPanel()!.textContent!;
      expect(text).toContain("NRS factors: explicit_factor");
      expect(text).not.toContain("NRS factors: nrs_new_domain");
    });

    it("displays lastNav when present", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          lastNav: {
            kind: "click",
            url: "https://evil.com",
            status: "blocked",
          },
        }),
      );
      expect(getPanel()!.textContent).toContain(
        "LastNav: blocked click https://evil.com",
      );
    });

    it("displays LastNav: none when absent", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo());
      expect(getPanel()!.textContent).toContain("LastNav: none");
    });

    it("displays top element tag and role", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          ctx: {
            viewport: { w: 1280, h: 720 },
            input: "pointer",
            top: { tag: "BUTTON", role: "button", rect: { w: 80, h: 24 } },
          },
        }),
      );
      expect(getPanel()!.textContent).toContain("Top: BUTTON/button (80x24)");
    });

    it("displays top element without role when absent", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          ctx: {
            viewport: { w: 1280, h: 720 },
            input: "pointer",
            top: { tag: "DIV", rect: { w: 200, h: 50 } },
          },
        }),
      );
      expect(getPanel()!.textContent).toContain("Top: DIV (200x50)");
    });

    it("displays top element rect as n/a when no rect", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          ctx: {
            viewport: { w: 1280, h: 720 },
            input: "pointer",
            top: { tag: "SPAN" },
          },
        }),
      );
      expect(getPanel()!.textContent).toContain("Top: SPAN (n/a)");
    });

    it("displays underlying element when present", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          ctx: {
            viewport: { w: 1280, h: 720 },
            input: "pointer",
            top: { tag: "DIV", rect: { w: 100, h: 30 } },
            underlying: {
              tag: "A",
              role: "link",
              rect: { w: 120, h: 20 },
            },
          },
        }),
      );
      expect(getPanel()!.textContent).toContain("Under: A/link (120x20)");
    });

    it("displays Under: none when no underlying element", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo());
      expect(getPanel()!.textContent).toContain("Under: none");
    });

    it("displays retargeted flag", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          ctx: {
            viewport: { w: 1280, h: 720 },
            input: "pointer",
            top: { tag: "A" },
            retargeted: true,
          },
        }),
      );
      expect(getPanel()!.textContent).toContain("Retargeted: yes");
    });

    it("displays retargeted as no when false/absent", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo());
      expect(getPanel()!.textContent).toContain("Retargeted: no");
    });

    it("displays LegitBackdrop flag", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          ctx: {
            viewport: { w: 1280, h: 720 },
            input: "pointer",
            top: { tag: "A" },
            isLegitModalBackdrop: true,
          },
        }),
      );
      expect(getPanel()!.textContent).toContain("LegitBackdrop: yes");
    });

    it("displays ExplicitNewTab flag", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          ctx: {
            viewport: { w: 1280, h: 720 },
            input: "pointer",
            top: { tag: "A" },
            explicitNewTabIntent: true,
          },
        }),
      );
      expect(getPanel()!.textContent).toContain("ExplicitNewTab: yes");
    });

    it("displays mutationAlerts count", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo({ mutationAlerts: 5 }));
      expect(getPanel()!.textContent).toContain("MutationAlerts: 5");
    });

    it("displays mutationAlerts as 0 when absent", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo());
      expect(getPanel()!.textContent).toContain("MutationAlerts: 0");
    });

    it("displays CSP info when present with CSP", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          cspInfo: {
            hasCSP: true,
            score: 80,
            isStrict: true,
            reasons: [],
          },
        }),
      );
      expect(getPanel()!.textContent).toContain(
        "CSP: yes (score=80, strict=true)",
      );
    });

    it("displays CSP info when no CSP present", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          cspInfo: {
            hasCSP: false,
            score: 0,
            isStrict: false,
            reasons: [],
          },
        }),
      );
      expect(getPanel()!.textContent).toContain("CSP: none (score=0)");
    });

    it("displays CSP as n/a when absent", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo());
      expect(getPanel()!.textContent).toContain("CSP: n/a");
    });

    it("displays adaptiveAdj value", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo({ adaptiveAdj: -15 }));
      expect(getPanel()!.textContent).toContain("AdaptiveAdj: -15");
    });

    it("displays adaptiveAdj as 0 when absent", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo());
      expect(getPanel()!.textContent).toContain("AdaptiveAdj: 0");
    });

    it("displays navAnomalyScore value", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo({ navAnomalyScore: 42 }));
      expect(getPanel()!.textContent).toContain("NavAnomaly: 42");
    });

    it("displays navAnomalyScore as 0 when absent", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo());
      expect(getPanel()!.textContent).toContain("NavAnomaly: 0");
    });

    it("rounds rect dimensions to integers", () => {
      setDebugEnabled(true);
      updateDebugOverlay(
        defaultInfo({
          ctx: {
            viewport: { w: 1280, h: 720 },
            input: "pointer",
            top: { tag: "A", rect: { w: 99.7, h: 30.2 } },
          },
        }),
      );
      expect(getPanel()!.textContent).toContain("Top: A (100x30)");
    });

    it("updates content on successive calls", () => {
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo({ decision: "allow" }));
      expect(getPanel()!.textContent).toContain("Decision: allow");
      updateDebugOverlay(defaultInfo({ decision: "block" }));
      expect(getPanel()!.textContent).toContain("Decision: block");
      expect(getPanel()!.textContent).not.toContain("Decision: allow");
    });

    it("creates host lazily on first update if enabled", () => {
      setDebugEnabled(true);
      setDebugEnabled(false);
      setDebugEnabled(true);
      updateDebugOverlay(defaultInfo());
      expect(getHost()).not.toBeNull();
      expect(getPanel()!.textContent).toContain("NavSentinel Debug");
    });
  });
});
