// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #898: a subframe form exempted as self-target must be re-checked AFTER the
 * page's submit/formdata listeners run. The browser resolves the target
 * navigable only after those events, so a listener can retarget the exempted
 * post to _top after the call-time check. The emulated natives below reproduce
 * that browser ordering (submit, then formdata, then target resolution, with
 * either event cancelable); they are not evidence that Chromium dispatches the
 * same way — the gym/E2E lane owns that.
 */
const SOURCE = "__navsentinel__";
const SESSION = "subframe-retarget";
const messages: Array<Record<string, unknown>> = [];
const peer = new MessageChannel();

interface EmulatedNavigation {
  method: "submit" | "requestSubmit";
  target: string;
  action: string;
}
const navigations: EmulatedNavigation[] = [];

function emulateFormNavigation(form: HTMLFormElement, method: "submit" | "requestSubmit"): void {
  if (method === "requestSubmit") {
    const submitEvent = new Event("submit", { cancelable: true });
    form.dispatchEvent(submitEvent);
    if (submitEvent.defaultPrevented) return;
  }
  const formdataEvent = new Event("formdata", { cancelable: true });
  form.dispatchEvent(formdataEvent);
  if (formdataEvent.defaultPrevented) return;
  // The browser resolves the target navigable only after these events (#898).
  navigations.push({ method, target: form.target, action: form.action });
}

const submit = vi.fn(function (this: HTMLFormElement) {
  emulateFormNavigation(this, "submit");
});
const requestSubmit = vi.fn(function (this: HTMLFormElement) {
  emulateFormNavigation(this, "requestSubmit");
});
const nativeHasInstance = Function.prototype[Symbol.hasInstance];
let priorPongs = 0;
let topDescriptor: PropertyDescriptor | undefined;

async function waitFor(test: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(test()).toBe(true), { timeout: 2000, interval: 5 });
}

async function send(type: string, data: Record<string, unknown> = {}): Promise<void> {
  peer.port1.postMessage({ source: SOURCE, v: 1, session: SESSION, type, ...data });
  const next = ++priorPongs;
  peer.port1.postMessage({ source: SOURCE, v: 1, session: SESSION, type: "ns-ping" });
  await waitFor(() => messages.filter((message) => message.type === "ns-pong").length === next);
}

function form(): HTMLFormElement {
  const element = document.createElement("form");
  element.action = "https://example.test/submit";
  element.method = "post";
  document.body.appendChild(element);
  return element;
}

beforeAll(async () => {
  // Simulate a subframe: the exemption under test requires isSubframe().
  topDescriptor = Object.getOwnPropertyDescriptor(window, "top");
  Object.defineProperty(window, "top", { value: {}, configurable: true });
  Object.defineProperty(MessagePort, Symbol.hasInstance, {
    configurable: true,
    value: (value: unknown) => nativeHasInstance.call(MessagePort, value) ||
      Object.getPrototypeOf(value) === Object.getPrototypeOf(peer.port1),
  });
  HTMLFormElement.prototype.submit = submit;
  HTMLFormElement.prototype.requestSubmit = requestSubmit;
  if (typeof document.execCommand !== "function") {
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
  }
  peer.port1.onmessage = (event: MessageEvent) => messages.push(event.data as Record<string, unknown>);
  peer.port1.start();
  peer.port2.start();
  await import("../extension/src/content/main_guard");
  const init = new MessageEvent("message", {
    data: { source: SOURCE, type: "ns-port-init", v: 1, session: SESSION },
    source: window,
  });
  Object.defineProperty(init, "ports", { value: [peer.port2] });
  window.dispatchEvent(init);
  await waitFor(() => messages.some((message) => message.type === "ns-challenge"));
  peer.port1.postMessage({ source: SOURCE, type: "ns-challenge-response", v: 1, session: SESSION,
    challenge: messages.find((message) => message.type === "ns-challenge")!.challenge });
  await waitFor(() => messages.some((message) => message.type === "ns-bridge-ready"));
});

beforeEach(async () => {
  document.body.replaceChildren();
  navigations.length = 0;
  await send("ns-config", { mode: "smart", debug: false });
  await send("ns-allow", { allowOpen: false, allowRedirect: false });
  submit.mockClear();
  requestSubmit.mockClear();
});

afterAll(() => {
  peer.port1.close();
  peer.port2.close();
  delete (MessagePort as unknown as Record<symbol, unknown>)[Symbol.hasInstance];
  if (topDescriptor) Object.defineProperty(window, "top", topDescriptor);
});

describe("subframe self-target retarget guard (#898)", () => {
  for (const method of ["submit", "requestSubmit"] as const) {
    it(`cancels a ${method} whose formdata listener retargets to _top`, async () => {
      const element = form();
      element.addEventListener("formdata", () => {
        element.target = "_top";
      });
      const start = messages.length;
      element[method]();
      await send("ns-config", { mode: "smart" });
      // The native ran (events dispatched) but the retargeted navigation did not.
      expect(method === "submit" ? submit : requestSubmit).toHaveBeenCalledTimes(1);
      expect(navigations).toEqual([]);
      const blocked = messages.slice(start).find((message) => message.type === "ns-nav-blocked");
      expect(blocked?.kind).toBe(method === "submit" ? "form_submit" : "form_request_submit");
      expect(blocked?.url).toBe("https://example.test/submit");
    });

    it(`lets an unretargeted subframe ${method} through on the exemption`, async () => {
      const element = form();
      const start = messages.length;
      element[method]();
      await send("ns-config", { mode: "smart" });
      expect(navigations).toEqual([{ method, target: "", action: "https://example.test/submit" }]);
      const records = messages.slice(start);
      expect(records.filter((message) => message.type === "ns-nav-allowed")).toHaveLength(1);
      expect(records.filter((message) => message.type === "ns-nav-blocked")).toHaveLength(0);
    });
  }

  it("cancels a requestSubmit whose submit listener retargets to _top", async () => {
    const element = form();
    element.addEventListener("submit", () => {
      element.target = "_top";
    });
    const start = messages.length;
    element.requestSubmit();
    await send("ns-config", { mode: "smart" });
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(requestSubmit.mock.calls).toEqual([[undefined]]);
    expect(navigations).toEqual([]);
    const blocked = messages.slice(start).find((message) => message.type === "ns-nav-blocked");
    expect(blocked?.kind).toBe("form_request_submit");
    expect(blocked?.url).toBe("https://example.test/submit");
  });

  it("reports the re-resolved action when the retarget also rewrites it", async () => {
    const element = form();
    element.addEventListener("formdata", () => {
      element.target = "_top";
      element.action = "https://evil.test/phish";
    });
    const start = messages.length;
    element.requestSubmit();
    await send("ns-config", { mode: "smart" });
    expect(navigations).toEqual([]);
    const blocked = messages.slice(start).find((message) => message.type === "ns-nav-blocked");
    expect(blocked?.url).toBe("https://evil.test/phish");
    // Approval still offers recourse for the gated submission.
    await send("ns-allow-action", { id: blocked!.id });
    expect(navigations).toEqual([
      { method: "requestSubmit", target: "_top", action: "https://evil.test/phish" },
    ]);
  });

  it("rejects a stale approval when the action changed after the retarget block", async () => {
    const element = form();
    element.addEventListener("formdata", () => {
      element.target = "_top";
    });
    const start = messages.length;
    element.requestSubmit();
    await send("ns-config", { mode: "smart" });
    const blocked = messages.slice(start).find((message) => message.type === "ns-nav-blocked");
    element.action = "https://example.test/changed";
    await send("ns-allow-action", { id: blocked!.id });
    expect(navigations).toEqual([]);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("a canceled submit leaves no stale guard for a later granted submit", async () => {
    const element = form();
    const start = messages.length;
    element.addEventListener("submit", (event) => event.preventDefault(), { once: true });
    element.requestSubmit();
    expect(navigations).toEqual([]);
    expect(messages.slice(start).filter((message) => message.type === "ns-nav-blocked")).toHaveLength(0);
    // formdata never fired, so no guard fired and none may remain: a later
    // granted top-targeted submit on the same form must proceed ungated.
    element.target = "_top";
    await send("ns-allow", { allowOpen: false, allowRedirect: true });
    const grantedStart = messages.length;
    element.requestSubmit();
    await send("ns-config", { mode: "smart" });
    expect(navigations).toEqual([
      { method: "requestSubmit", target: "_top", action: "https://example.test/submit" },
    ]);
    expect(messages.slice(grantedStart).filter((message) => message.type === "ns-nav-blocked")).toHaveLength(0);
  });
});
