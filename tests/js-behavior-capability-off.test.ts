// @vitest-environment happy-dom
//
// RI-07: with the `jsBehaviorInstrumentation` beta capability off, broad
// JavaScript-behaviour instrumentation must never be INSTALLED — not installed
// and left inert. The build aliases `@navsentinel/js-behavior-monitor` to
// `js_behavior_monitor.disabled.ts`, so these tests assert the no-op variant
// touches no global and no prototype.
//
// Idiom borrowed from tests/js-behavior-monitor-frozen-globals.test.ts: capture
// native identities up front and compare by identity afterwards, so a wrapper
// that merely delegates would still fail.

import { beforeAll, describe, expect, it } from "vitest";

import {
  initJsBehaviorMonitor,
  jsBehaviorInstrumentationEnabled,
} from "../extension/src/content/js_behavior_monitor.disabled";
import {
  jsBehaviorInstrumentationEnabled as enabledVariantFlag,
} from "../extension/src/content/js_behavior_monitor";
import { describeJsBehaviorCapability } from "../extension/src/options/options_model";

const NATIVE_FETCH = window.fetch;
const NATIVE_XHR_OPEN = XMLHttpRequest.prototype.open;
const NATIVE_XHR_SEND = XMLHttpRequest.prototype.send;
const NATIVE_SEND_BEACON = navigator.sendBeacon;
const NATIVE_FORM_SUBMIT = HTMLFormElement.prototype.submit;
const NATIVE_VALUE_DESC = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
const NATIVE_ADD_EVENT_LISTENER = document.addEventListener;

const signals: string[] = [];

describe("RI-07 js-behavior instrumentation capability off", () => {
  beforeAll(() => {
    // Call in the mode the runtime would use if the capability were on, so the
    // test cannot pass merely because `mode` short-circuits the enabled variant.
    for (const mode of ["smart", "strict"] as const) {
      initJsBehaviorMonitor({
        mode,
        debug: true,
        postSignal: (type) => signals.push(type),
      });
    }
  });

  it("reports the capability as disabled", () => {
    expect(jsBehaviorInstrumentationEnabled).toBe(false);
  });

  it("leaves window.fetch untouched", () => {
    expect(window.fetch).toBe(NATIVE_FETCH);
  });

  it("leaves XMLHttpRequest.prototype.open/send untouched", () => {
    expect(XMLHttpRequest.prototype.open).toBe(NATIVE_XHR_OPEN);
    expect(XMLHttpRequest.prototype.send).toBe(NATIVE_XHR_SEND);
  });

  it("leaves navigator.sendBeacon untouched", () => {
    expect(navigator.sendBeacon).toBe(NATIVE_SEND_BEACON);
  });

  it("leaves HTMLFormElement.prototype.submit untouched", () => {
    expect(HTMLFormElement.prototype.submit).toBe(NATIVE_FORM_SUBMIT);
  });

  it("leaves the HTMLInputElement password-value getter untouched", () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    expect(desc?.get).toBe(NATIVE_VALUE_DESC?.get);
    expect(desc?.set).toBe(NATIVE_VALUE_DESC?.set);
  });

  it("registers no document listener and emits no bridge signal", () => {
    expect(document.addEventListener).toBe(NATIVE_ADD_EVENT_LISTENER);
    expect(signals).toEqual([]);
  });

  it("keeps the enabled variant distinguishable from the disabled one", () => {
    // Guards against the two variants drifting into the same value, which would
    // make the capability flag meaningless.
    expect(enabledVariantFlag).toBe(true);
    expect(enabledVariantFlag).not.toBe(jsBehaviorInstrumentationEnabled);
  });

  it("never lets the options UI present the capability as on", () => {
    const display = describeJsBehaviorCapability(jsBehaviorInstrumentationEnabled);
    expect(display.state).toBe("Off");
    expect(display.detail).toMatch(/does not install/i);
  });
});
