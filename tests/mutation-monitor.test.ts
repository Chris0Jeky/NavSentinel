// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// The mutation monitor relies on DOM APIs (MutationObserver, getComputedStyle,
// getBoundingClientRect). We test the pure-logic paths directly and use
// lightweight stubs for the DOM-dependent parts.
// Environment: happy-dom provides the required DOM APIs (MutationObserver, document, etc.)

// We import the module functions. Because the module manages internal state
// we reset between tests.
import {
  startMutationMonitor,
  stopMutationMonitor,
  getMutationAlerts,
  getMutationAlertCount,
  _resetMutationState,
  _getShadowObserverCountForTesting,
  _feedMutationRecordsForTesting,
  type MutationAlert,
} from "../extension/src/content/mutation_monitor";

// ---------------------------------------------------------------------------
// Unit tests that work WITHOUT a full DOM
// ---------------------------------------------------------------------------

describe("mutation_monitor module API", () => {
  beforeEach(() => {
    _resetMutationState();
  });

  afterEach(() => {
    _resetMutationState();
  });

  it("exports the expected public API", () => {
    expect(typeof startMutationMonitor).toBe("function");
    expect(typeof stopMutationMonitor).toBe("function");
    expect(typeof getMutationAlerts).toBe("function");
    expect(typeof getMutationAlertCount).toBe("function");
  });

  it("getMutationAlerts returns empty array before start", () => {
    expect(getMutationAlerts()).toEqual([]);
    expect(getMutationAlertCount()).toBe(0);
  });

  it("getMutationAlerts returns a copy, not a reference", () => {
    const a = getMutationAlerts();
    const b = getMutationAlerts();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// DOM-dependent tests (happy-dom provides MutationObserver and DOM APIs)
// ---------------------------------------------------------------------------

describe("mutation_monitor DOM integration", () => {
  beforeEach(() => {
    _resetMutationState();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    _resetMutationState();
    vi.useRealTimers();
  });

  it("starts and stops without error", () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));
    expect(getMutationAlertCount()).toBe(0);
    stopMutationMonitor();
  });

  it("detects password field injection into existing form", async () => {
    const alerts: MutationAlert[] = [];
    const form = document.createElement("form");
    document.body.appendChild(form);

    startMutationMonitor(document, (a) => alerts.push(a));

    // Inject a password field after monitor starts
    const input = document.createElement("input");
    input.type = "password";
    form.appendChild(input);

    // Flush debounce
    vi.advanceTimersByTime(150);

    // MutationObserver callbacks are microtasks; allow them to resolve
    await vi.advanceTimersByTimeAsync(150);

    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0]!.type).toBe("password_injected");

    // Clean up
    form.remove();
    stopMutationMonitor();
  });

  it("detects input type changed to password", async () => {
    const alerts: MutationAlert[] = [];
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    startMutationMonitor(document, (a) => alerts.push(a));

    input.setAttribute("type", "password");

    await vi.advanceTimersByTimeAsync(150);

    const passwordAlerts = alerts.filter((a) => a.type === "password_injected");
    expect(passwordAlerts.length).toBeGreaterThanOrEqual(1);

    input.remove();
    stopMutationMonitor();
  });

  it("detects form action attribute change", async () => {
    const alerts: MutationAlert[] = [];

    // Start monitoring BEFORE adding the form. In happy-dom, querySelectorAll
    // returns different object refs than MutationRecord.target, so the form
    // must first be observed via an attribute mutation to register its baseline.
    startMutationMonitor(document, (a) => alerts.push(a));

    const form = document.createElement("form");
    document.body.appendChild(form);

    // First attribute mutation on "action" registers the form (baseline = "/login")
    form.setAttribute("action", "/login");

    // Flush so the observer processes and records the initial action
    vi.advanceTimersByTime(150);
    await vi.advanceTimersByTimeAsync(150);

    // Second mutation: change to cross-domain URL — this should trigger the alert
    form.setAttribute("action", "https://evil.example.com/steal");

    vi.advanceTimersByTime(150);
    await vi.advanceTimersByTimeAsync(150);

    const actionAlerts = alerts.filter((a) => a.type === "form_action_changed");
    expect(actionAlerts.length).toBeGreaterThanOrEqual(1);
    expect(actionAlerts[0]!.details).toContain("evil.example.com");

    form.remove();
    stopMutationMonitor();
  });

  it("detects cross-domain action change on a pre-existing snapshotted form", async () => {
    const alerts: MutationAlert[] = [];
    const form = document.createElement("form");
    form.setAttribute("action", "/login");
    document.body.appendChild(form);
    const nativeMutationObserver = globalThis.MutationObserver;
    let mutationCallback: MutationCallback = () => {
      throw new Error("MutationObserver callback was not initialized");
    };

    class TestMutationObserver {
      constructor(callback: MutationCallback) {
        mutationCallback = callback;
      }

      observe(): void {}

      disconnect(): void {}
    }

    vi.stubGlobal("MutationObserver", TestMutationObserver);

    const querySelectorAll = document.querySelectorAll.bind(document);
    const querySpy = vi
      .spyOn(document, "querySelectorAll")
      .mockImplementation((selector: string) => {
        if (selector === "form") {
          return [form] as unknown as NodeListOf<Element>;
        }
        return querySelectorAll(selector);
      });

    try {
      startMutationMonitor(document, (a) => alerts.push(a));
      querySpy.mockRestore();

      form.setAttribute("action", "https://evil.example.com/steal");
      mutationCallback?.(
        [
          {
            type: "attributes",
            target: form,
            attributeName: "action",
          } as unknown as MutationRecord,
        ],
        {} as MutationObserver
      );

      vi.advanceTimersByTime(150);
      await vi.advanceTimersByTimeAsync(150);

      const actionAlerts = alerts.filter((a) => a.type === "form_action_changed");
      expect(actionAlerts.length).toBeGreaterThanOrEqual(1);
      expect(actionAlerts[0]!.details).toContain('was "/login"');
    } finally {
      querySpy.mockRestore();
      form.remove();
      stopMutationMonitor();
      vi.stubGlobal("MutationObserver", nativeMutationObserver);
    }
  });

  it("does not alert for form action unchanged", async () => {
    const alerts: MutationAlert[] = [];
    const form = document.createElement("form");
    form.setAttribute("action", "/login");
    document.body.appendChild(form);

    startMutationMonitor(document, (a) => alerts.push(a));

    // Set it to the same value
    form.setAttribute("action", "/login");

    await vi.advanceTimersByTimeAsync(150);

    const actionAlerts = alerts.filter((a) => a.type === "form_action_changed");
    expect(actionAlerts.length).toBe(0);

    form.remove();
    stopMutationMonitor();
  });

  it("detects suspicious hidden iframe injection", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = "https://evil.example.com/exfil";
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.length).toBeGreaterThanOrEqual(1);

    iframe.remove();
    stopMutationMonitor();
  });

  it("ignores legitimate reCAPTCHA iframes", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe");
    iframe.src = "https://www.google.com/recaptcha/api2/anchor";
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.length).toBe(0);

    iframe.remove();
    stopMutationMonitor();
  });

  it("flags a hidden iframe that merely embeds a provider name in its query (hostname-spoof) (#211)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    // The provider name is in the query, not the host — the old unanchored substring
    // allowlist exempted this; the parsed-hostname check must not.
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = "https://evil.example/x?ref=hcaptcha.com";
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.length).toBeGreaterThanOrEqual(1);

    iframe.remove();
    stopMutationMonitor();
  });

  it("flags a hidden iframe whose path embeds a provider name (#211)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = "https://attacker-cdn.example/recaptcha-badge.png";
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.length).toBeGreaterThanOrEqual(1);

    iframe.remove();
    stopMutationMonitor();
  });

  it("still ignores a legitimate provider on a subdomain (suffix-boundary) (#211)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe");
    iframe.src = "https://newassets.hcaptcha.com/captcha/v1/anchor";
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.length).toBe(0);

    iframe.remove();
    stopMutationMonitor();
  });

  it("still ignores a legitimate analytics iframe (#211)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe");
    iframe.src = "https://www.googletagmanager.com/ns.html?id=GTM-XX";
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.length).toBe(0);

    iframe.remove();
    stopMutationMonitor();
  });

  // #211 R1: host-confusion spoofs that the old substring allowlist exempted but the
  // parsed-hostname + suffix-boundary check must flag.
  it.each([
    ["userinfo authority spoof", "https://hcaptcha.com@evil.example/login"],
    ["left-label suffix spoof", "https://hcaptcha.com.evil.example/anchor"],
    ["sibling-domain spoof", "https://evil-hcaptcha.com/x"],
    ["non-widget path on a path-gated host", "https://www.google.com/recaptcha-evil/x"],
    ["youtube non-embed path", "https://www.youtube.com/watch?v=evil"],
    ["youtube /embed prefix-but-not-segment", "https://www.youtube.com/embedxyz"],
    ["provider host with a non-http(s) scheme", "ftp://hcaptcha.com/widget"],
  ])("flags a hidden %s (#211)", async (_label, src) => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = src;
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.length).toBeGreaterThanOrEqual(1);

    iframe.remove();
    stopMutationMonitor();
  });

  it("still exempts a legit provider listed AFTER a path-gated entry it shares a suffix with (continue-fallthrough) (#211 R1)", async () => {
    // apis.google.com matches the "google.com" + /recaptcha entry on host but not
    // path; the loop must `continue` to its own entry, not reject early.
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe");
    iframe.src = "https://apis.google.com/js/api.js";
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.length).toBe(0);

    iframe.remove();
    stopMutationMonitor();
  });

  it.each([
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ])("still ignores a legitimate YouTube embed (%s) (#211 R2)", async (src) => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe");
    iframe.src = src;
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.length).toBe(0);

    iframe.remove();
    stopMutationMonitor();
  });

  it("flags an injected data: iframe by its opaque scheme (D-IFRAME)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    // A data: iframe is its own opaque origin with no hostname, so the
    // cross-domain check can't catch it; the scheme check must.
    const iframe = document.createElement("iframe");
    iframe.src = "data:text/html,<form><input type=password></form>";
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.some((a) => a.details.includes("data-scheme src"))).toBe(true);

    iframe.remove();
    stopMutationMonitor();
  });

  it("flags an injected blob: iframe by its opaque scheme (D-IFRAME)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe");
    iframe.src = "blob:https://evil.example/0e8c2b1a-uuid";
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.some((a) => a.details.includes("blob-scheme src"))).toBe(true);

    iframe.remove();
    stopMutationMonitor();
  });

  it("flags a data: iframe whose scheme is obfuscated with an interior tab (D-IFRAME R2)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    // "da<TAB>ta:" — a browser strips the tab and resolves it as data:, so the
    // scheme check must normalize the same way rather than be evaded.
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", "da\tta:text/html,<form><input type=password></form>");
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.some((a) => a.details.includes("data-scheme src"))).toBe(true);

    iframe.remove();
    stopMutationMonitor();
  });

  it("flags an injected srcdoc iframe (inline HTML, no src) (D-IFRAME R2)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe");
    iframe.setAttribute("srcdoc", "<form action='https://evil.example/steal'><input type=password></form>");
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.some((a) => a.details.includes("srcdoc (inline HTML)"))).toBe(true);

    iframe.remove();
    stopMutationMonitor();
  });

  it("flags a malicious srcdoc paired with a legit src (srcdoc renders over src) (D-IFRAME R2)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    // A legit recaptcha src must not let the malicious inline srcdoc slip past
    // the isLegitIframeSrc early-return.
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", "https://www.google.com/recaptcha/api2/anchor");
    iframe.setAttribute("srcdoc", "<form action='https://evil.example/steal'><input type=password></form>");
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.some((a) => a.details.includes("srcdoc (inline HTML)"))).toBe(true);

    iframe.remove();
    stopMutationMonitor();
  });

  it("flags srcdoc set via a later attribute mutation, not just at insertion (D-IFRAME R2)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe"); // bare iframe, no src/srcdoc yet
    document.body.appendChild(iframe);
    await vi.advanceTimersByTimeAsync(150);

    // Two-step: set srcdoc after insertion. 'srcdoc' must be observed.
    iframe.setAttribute("srcdoc", "<form><input type=password></form>");
    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.some((a) => a.details.includes("srcdoc (inline HTML)"))).toBe(true);

    iframe.remove();
    stopMutationMonitor();
  });

  it("does not raise a data-scheme reason for an interior-space pseudo-scheme (D-IFRAME R2)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    // "da ta:" has an interior space → an invalid scheme the browser treats as a
    // relative URL, so it must NOT be normalized into a data: match (no FP).
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", "da ta:text/html,x");
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.some((a) => a.details.includes("data-scheme src"))).toBe(false);

    iframe.remove();
    stopMutationMonitor();
  });

  it("flags a data: src even when its payload contains a legit-pattern substring (D-IFRAME R3)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    // "recaptcha" embedded in the data: payload must NOT exempt it via the
    // unanchored isLegitIframeSrc substring match — the scheme is resolved first.
    const iframe = document.createElement("iframe");
    iframe.setAttribute(
      "src",
      "data:text/html,<!--recaptcha--><form action='https://evil.example/steal'><input type=password></form>",
    );
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.some((a) => a.details.includes("data-scheme src"))).toBe(true);

    iframe.remove();
    stopMutationMonitor();
  });

  it("flags a blob: src whose host contains a legit-pattern substring (D-IFRAME R3)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", "blob:https://recaptcha.evil.example/0e8c2b1a-uuid");
    document.body.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(150);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.some((a) => a.details.includes("blob-scheme src"))).toBe(true);

    iframe.remove();
    stopMutationMonitor();
  });

  it("caps alerts at 50", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    // Inject 60 password fields rapidly
    const inputs: HTMLInputElement[] = [];
    for (let i = 0; i < 60; i++) {
      const input = document.createElement("input");
      input.type = "password";
      document.body.appendChild(input);
      inputs.push(input);
    }

    await vi.advanceTimersByTimeAsync(150);

    expect(getMutationAlertCount()).toBeLessThanOrEqual(50);

    for (const input of inputs) input.remove();
    stopMutationMonitor();
  });

  it("auto-disconnects after 5 minutes", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    // Advance past the 5-minute auto-disconnect
    vi.advanceTimersByTime(5 * 60 * 1000 + 100);

    // Inject something after disconnect -- should NOT produce alert
    const input = document.createElement("input");
    input.type = "password";
    document.body.appendChild(input);

    await vi.advanceTimersByTimeAsync(150);

    const passwordAlerts = alerts.filter((a) => a.type === "password_injected");
    expect(passwordAlerts.length).toBe(0);

    input.remove();
  });

  it("stopMutationMonitor prevents further alerts", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));
    stopMutationMonitor();

    const input = document.createElement("input");
    input.type = "password";
    document.body.appendChild(input);

    await vi.advanceTimersByTimeAsync(150);

    expect(alerts.length).toBe(0);

    input.remove();
  });
});

// ---------------------------------------------------------------------------
// Shadow DOM observation tests
// ---------------------------------------------------------------------------

describe("mutation_monitor shadow DOM observation", () => {
  beforeEach(() => {
    _resetMutationState();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    _resetMutationState();
    vi.useRealTimers();
  });

  it("detects password field injected into an open shadow root", async () => {
    const alerts: MutationAlert[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const sr = host.attachShadow({ mode: "open" });

    startMutationMonitor(document, (a) => alerts.push(a));

    const input = document.createElement("input");
    input.type = "password";
    sr.appendChild(input);

    await vi.advanceTimersByTimeAsync(200);

    const passwordAlerts = alerts.filter((a) => a.type === "password_injected");
    expect(passwordAlerts.length).toBeGreaterThanOrEqual(1);

    host.remove();
    stopMutationMonitor();
  });

  it("detects suspicious iframe injected into shadow root", async () => {
    const alerts: MutationAlert[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const sr = host.attachShadow({ mode: "open" });

    startMutationMonitor(document, (a) => alerts.push(a));

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = "https://evil.example.com/exfil";
    sr.appendChild(iframe);

    await vi.advanceTimersByTimeAsync(200);

    const iframeAlerts = alerts.filter((a) => a.type === "suspicious_iframe");
    expect(iframeAlerts.length).toBeGreaterThanOrEqual(1);

    host.remove();
    stopMutationMonitor();
  });

  it("observes shadow root on element added after monitor starts", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const host = document.createElement("div");
    const sr = host.attachShadow({ mode: "open" });
    document.body.appendChild(host);

    // Wait for the observer to process the host addition
    await vi.advanceTimersByTimeAsync(200);

    const input = document.createElement("input");
    input.type = "password";
    sr.appendChild(input);

    await vi.advanceTimersByTimeAsync(200);

    const passwordAlerts = alerts.filter((a) => a.type === "password_injected");
    expect(passwordAlerts.length).toBeGreaterThanOrEqual(1);

    host.remove();
    stopMutationMonitor();
  });

  it("observes pre-existing shadow root at monitor start", async () => {
    const alerts: MutationAlert[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const sr = host.attachShadow({ mode: "open" });

    startMutationMonitor(document, (a) => alerts.push(a));

    const input = document.createElement("input");
    input.type = "password";
    sr.appendChild(input);

    await vi.advanceTimersByTimeAsync(200);

    const passwordAlerts = alerts.filter((a) => a.type === "password_injected");
    expect(passwordAlerts.length).toBeGreaterThanOrEqual(1);

    host.remove();
    stopMutationMonitor();
  });

  it("does not observe the same shadow root twice", async () => {
    const alerts: MutationAlert[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const sr = host.attachShadow({ mode: "open" });

    startMutationMonitor(document, (a) => alerts.push(a));

    // Force a re-check of the host — should not create duplicate observers
    const wrapper = document.createElement("div");
    wrapper.appendChild(host);
    document.body.appendChild(wrapper);

    await vi.advanceTimersByTimeAsync(200);

    const input = document.createElement("input");
    input.type = "password";
    sr.appendChild(input);

    await vi.advanceTimersByTimeAsync(200);

    // Should still only get one alert, not duplicates from multiple observers
    const passwordAlerts = alerts.filter((a) => a.type === "password_injected");
    expect(passwordAlerts.length).toBe(1);

    wrapper.remove();
    stopMutationMonitor();
  });

  it("cleans up shadow observers on stop", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.attachShadow({ mode: "open" });

    startMutationMonitor(document, () => {});
    stopMutationMonitor();

    // Verify no errors when stopping (observers cleaned up properly)
    expect(getMutationAlertCount()).toBe(0);

    host.remove();
  });

  it("detects injection in nested shadow roots", async () => {
    const alerts: MutationAlert[] = [];
    const outerHost = document.createElement("div");
    document.body.appendChild(outerHost);
    const outerSr = outerHost.attachShadow({ mode: "open" });

    const innerHost = document.createElement("div");
    outerSr.appendChild(innerHost);
    const innerSr = innerHost.attachShadow({ mode: "open" });

    startMutationMonitor(document, (a) => alerts.push(a));

    const input = document.createElement("input");
    input.type = "password";
    innerSr.appendChild(input);

    await vi.advanceTimersByTimeAsync(200);

    const passwordAlerts = alerts.filter((a) => a.type === "password_injected");
    expect(passwordAlerts.length).toBeGreaterThanOrEqual(1);

    outerHost.remove();
    stopMutationMonitor();
  });

  it("skips NavSentinel's own shadow hosts", async () => {
    const alerts: MutationAlert[] = [];
    const host = document.createElement("div");
    host.id = "__navsentinel_toast_host";
    document.body.appendChild(host);
    const sr = host.attachShadow({ mode: "open" });

    startMutationMonitor(document, (a) => alerts.push(a));

    const input = document.createElement("input");
    input.type = "password";
    sr.appendChild(input);

    await vi.advanceTimersByTimeAsync(200);

    // NavSentinel's own shadow root should NOT be observed
    const passwordAlerts = alerts.filter((a) => a.type === "password_injected");
    expect(passwordAlerts.length).toBe(0);

    host.remove();
    stopMutationMonitor();
  });

  it("disconnects shadow observer when host is removed from DOM", async () => {
    const alerts: MutationAlert[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const sr = host.attachShadow({ mode: "open" });

    startMutationMonitor(document, (a) => alerts.push(a));

    // Wait for initial observation
    await vi.advanceTimersByTimeAsync(200);

    // Remove the host from DOM
    host.remove();
    await vi.advanceTimersByTimeAsync(200);

    // Inject into the now-detached shadow root — should NOT produce alert
    const input = document.createElement("input");
    input.type = "password";
    sr.appendChild(input);

    await vi.advanceTimersByTimeAsync(200);

    const passwordAlerts = alerts.filter((a) => a.type === "password_injected");
    expect(passwordAlerts.length).toBe(0);

    stopMutationMonitor();
  });

  it("disconnects NESTED shadow observers when a light-DOM ancestor is removed (#401)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    // wrapper (light DOM) → outer host (shadow root) → inner host (nested shadow root).
    // Removing `wrapper` reaches the outer host via querySelectorAll, but the inner
    // host lives INSIDE the outer shadow root, which that light-DOM walk can't pierce.
    const wrapper = document.createElement("div");
    const outerHost = document.createElement("div");
    const outerSr = outerHost.attachShadow({ mode: "open" });
    const innerHost = document.createElement("div");
    const innerSr = innerHost.attachShadow({ mode: "open" });
    outerSr.appendChild(innerHost);
    wrapper.appendChild(outerHost);
    document.body.appendChild(wrapper);

    await vi.advanceTimersByTimeAsync(200);
    expect(_getShadowObserverCountForTesting()).toBe(2);

    wrapper.remove();
    await vi.advanceTimersByTimeAsync(200);

    // Pre-fix the inner host's observer leaked here (count stayed 1) until the
    // 5-minute AUTO_DISCONNECT_MS timer.
    expect(_getShadowObserverCountForTesting()).toBe(0);

    // And the detached nested root must not fire ghost alerts.
    const input = document.createElement("input");
    input.type = "password";
    innerSr.appendChild(input);
    await vi.advanceTimersByTimeAsync(200);
    expect(alerts.filter((a) => a.type === "password_injected").length).toBe(0);

    stopMutationMonitor();
  });

  it("disconnects deeply nested shadow observers when the outer HOST itself is removed (#401)", async () => {
    startMutationMonitor(document, () => {});

    // Three levels of nesting, outer host directly in the light DOM.
    const outerHost = document.createElement("div");
    const outerSr = outerHost.attachShadow({ mode: "open" });
    const midHost = document.createElement("div");
    const midSr = midHost.attachShadow({ mode: "open" });
    const innerHost = document.createElement("div");
    innerHost.attachShadow({ mode: "open" });
    midSr.appendChild(innerHost);
    outerSr.appendChild(midHost);
    document.body.appendChild(outerHost);

    await vi.advanceTimersByTimeAsync(200);
    expect(_getShadowObserverCountForTesting()).toBe(3);

    outerHost.remove();
    await vi.advanceTimersByTimeAsync(200);

    expect(_getShadowObserverCountForTesting()).toBe(0);

    stopMutationMonitor();
  });

  it("re-observes nested shadow roots when the removed subtree is re-added (#401)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    const wrapper = document.createElement("div");
    const outerHost = document.createElement("div");
    const outerSr = outerHost.attachShadow({ mode: "open" });
    const innerHost = document.createElement("div");
    const innerSr = innerHost.attachShadow({ mode: "open" });
    outerSr.appendChild(innerHost);
    wrapper.appendChild(outerHost);
    document.body.appendChild(wrapper);

    await vi.advanceTimersByTimeAsync(200);
    expect(_getShadowObserverCountForTesting()).toBe(2);

    wrapper.remove();
    await vi.advanceTimersByTimeAsync(200);
    expect(_getShadowObserverCountForTesting()).toBe(0);

    // Re-adding the same subtree must re-register both observers (the WeakSet
    // dedup entry is cleared on disconnect) and detection must work again.
    document.body.appendChild(wrapper);
    await vi.advanceTimersByTimeAsync(200);
    expect(_getShadowObserverCountForTesting()).toBe(2);

    const input = document.createElement("input");
    input.type = "password";
    innerSr.appendChild(input);
    await vi.advanceTimersByTimeAsync(200);
    expect(alerts.filter((a) => a.type === "password_injected").length).toBe(1);

    wrapper.remove();
    stopMutationMonitor();
  });

  it("does not tear down a still-CONNECTED host that appears in a removedNodes record (self-replace evasion, #401 R1)", async () => {
    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (a) => alerts.push(a));

    // outer host (shadow) → inner host (nested shadow), both observed.
    const outerHost = document.createElement("div");
    const outerSr = outerHost.attachShadow({ mode: "open" });
    const innerHost = document.createElement("div");
    const innerSr = innerHost.attachShadow({ mode: "open" });
    outerSr.appendChild(innerHost);
    document.body.appendChild(outerHost);

    await vi.advanceTimersByTimeAsync(200);
    expect(_getShadowObserverCountForTesting()).toBe(2);
    expect(outerHost.isConnected).toBe(true);

    // Real browsers emit a SINGLE MutationRecord with the host in BOTH addedNodes
    // and removedNodes for a self-replace (replaceChild(host, host) /
    // host.replaceWith(host)) per the WHATWG DOM "replace" algorithm — the host
    // never leaves the document. The add-path is processed first (no-op: root
    // already observed), then the remove-path would tear the observer down.
    // happy-dom instead treats self-replace as a plain disconnect, so we feed the
    // spec-accurate record directly. Pre-fix this tore down outerHost's observer AND
    // recursed into innerHost, permanently blinding the whole subtree (count → 0)
    // while the content stayed live. The isConnected guard defeats it.
    const selfReplace = {
      type: "childList",
      target: document.body,
      addedNodes: [outerHost] as unknown as NodeList,
      removedNodes: [outerHost] as unknown as NodeList,
    } as unknown as MutationRecord;
    _feedMutationRecordsForTesting([selfReplace]);
    await vi.advanceTimersByTimeAsync(200);

    expect(_getShadowObserverCountForTesting()).toBe(2);

    // And detection into the still-live nested shadow root must keep working.
    const input = document.createElement("input");
    input.type = "password";
    innerSr.appendChild(input);
    await vi.advanceTimersByTimeAsync(200);
    expect(alerts.filter((a) => a.type === "password_injected").length).toBe(1);

    outerHost.remove();
    stopMutationMonitor();
  });
});
